from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from contextlib import closing

import psycopg

from app.core.config import settings
from app.core.security import AuthUser, require_user
from app.core.time import utcnow
from app.db.session import get_conn
from app.services.fees import calculate_fee_fcfa, get_min_amount_fcfa
from app.services.fraud import check_p2p_transfer
from app.services.idempotency import get_cached_response, store_response
from app.services.ledger import lookup_user, p2p_transfer_fcfa
from app.services.notifications import create_notification
from app.services.compliance import enforce_compliance
from app.services.pin_security import verify_user_pin


def _check_p2p_limits(user_id: str, amount: Decimal) -> None:
    """Vérifie les limites par transaction et journalières."""
    max_single = Decimal(str(settings.p2p_max_single_fcfa))
    if amount > max_single:
        raise HTTPException(
            status_code=400,
            detail=f"Montant maximum par transfert : {int(max_single):,} FCFA".replace(",", " "),
        )
    max_daily = Decimal(str(settings.p2p_max_daily_fcfa))
    since = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT COALESCE(SUM(amount), 0) AS total
               FROM wallet_transactions
               WHERE user_id = %s AND direction = 'debit' AND category = 'p2p'
                 AND created_at >= %s""",
            (user_id, since),
        )
        row = cur.fetchone()
    daily_total = Decimal(str(row["total"])) if row else Decimal("0")
    if daily_total + amount > max_daily:
        remaining = max(Decimal("0"), max_daily - daily_total)
        raise HTTPException(
            status_code=400,
            detail=f"Plafond journalier atteint. Disponible aujourd'hui : {float(remaining):,.0f} FCFA".replace(",", " "),
        )

router = APIRouter(prefix="/p2p", tags=["p2p"])


@router.get("/fee-preview")
async def fee_preview(amount: Decimal = Query(gt=0)) -> dict[str, Any]:
    """Retourne les frais P2P calculés pour un montant donné (config admin en temps réel)."""
    fee = calculate_fee_fcfa("p2p_transfer", amount)
    return {"fee_fcfa": float(fee), "total_fcfa": float(amount + fee)}


class P2PTransferRequest(BaseModel):
    to_identifier: str = Field(min_length=2, max_length=128)
    amount: Decimal = Field(gt=0)
    note: str | None = Field(default=None, max_length=240)
    pin: str | None = Field(default=None, max_length=12)  # reserved for later


@router.get("/lookup")
async def lookup(identifier: str = Query(min_length=2, max_length=128), user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    found = lookup_user(identifier=identifier)
    return {"found": bool(found), "user": found}


@router.post("/transfer")
async def transfer(
    req: P2PTransferRequest,
    request: Request,
    user: AuthUser = Depends(require_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    body = req.model_dump()
    if idempotency_key:
        cached = get_cached_response(
            key=idempotency_key,
            user_id=user.id,
            method=request.method,
            path=str(request.url.path),
            body=body,
        )
        if cached:
            if cached.status_code != 200:
                raise HTTPException(status_code=cached.status_code, detail=cached.body.get("detail"))
            return cached.body

    # ── Basic validations ─────────────────────────────────────────────────────
    verify_user_pin(user.id, req.pin, purpose="p2p_transfer")
    min_amount = get_min_amount_fcfa("p2p_transfer", 100)
    if req.amount < min_amount:
        raise HTTPException(status_code=400, detail=f"Montant minimum : {int(min_amount)} FCFA")
    _check_p2p_limits(user.id, req.amount)
    enforce_compliance(user_id=user.id, amount_fcfa=req.amount, flow="p2p", allow_manual_review=False)

    # ── Lookup recipient ──────────────────────────────────────────────────────
    recipient_row = lookup_user(identifier=req.to_identifier)
    if not recipient_row:
        raise HTTPException(status_code=404, detail="Destinataire introuvable")
    recipient_id = recipient_row.get("id", "")

    if recipient_id == user.id:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas vous envoyer de l'argent à vous-même")

    # ── Anti-fraud check ──────────────────────────────────────────────────────
    fraud = check_p2p_transfer(user.id, recipient_id, req.amount)
    if fraud.action == "block":
        if "sender_blocked" in fraud.rules_triggered:
            detail = (
                "Votre compte est temporairement bloqué. Vous ne pouvez pas envoyer "
                "d'argent pour le moment. Contactez le support si vous pensez qu'il s'agit d'une erreur."
            )
        elif "recipient_blocked" in fraud.rules_triggered:
            detail = (
                "Ce destinataire ne peut pas recevoir d'argent pour le moment. "
                "Essayez un autre compte ou demandez-lui de contacter le support."
            )
        else:
            detail = (
                "Nous n'avons pas pu envoyer ce transfert pour des raisons de sécurité. "
                "Aucun montant n'a été débité."
            )
        raise HTTPException(status_code=403, detail=detail)

    try:
        out = p2p_transfer_fcfa(
            sender_user_id=user.id,
            sender_phone=user.phone_e164,
            to_identifier=req.to_identifier,
            amount_fcfa=req.amount,
            note=req.note or "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        recipient_id = (out.get("recipient") or {}).get("id")
        create_notification(
            user.id,
            "p2p_sent",
            "Transfert envoyé",
            f"Votre transfert de {float(req.amount):,.0f} FCFA a été envoyé.",
            {"amount": float(req.amount), "to": req.to_identifier},
        )
        if recipient_id:
            create_notification(
                recipient_id,
                "p2p_received",
                "Paiement reçu 💸",
                f"Vous avez reçu {float(req.amount):,.0f} FCFA de {user.phone_e164}.",
                {"amount": float(req.amount), "from": user.phone_e164},
            )
    except Exception:
        pass
    resp = {
        "ok": True,
        "transfer": out,
        "fraud_warning": fraud.rules_triggered if fraud.action == "warn" else None,
    }
    if idempotency_key:
        store_response(
            key=idempotency_key,
            user_id=user.id,
            method=request.method,
            path=str(request.url.path),
            body=body,
            status_code=200,
            response_body=resp,
        )
    return resp
