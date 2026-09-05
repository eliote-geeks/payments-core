from __future__ import annotations

import logging
import re
import uuid
from contextlib import closing
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import AuthUser, require_user, sha256_hex
from app.core.time import utcnow
from app.db.session import get_conn
from app.routers.fiat_withdrawals import _verify_user_pin
from app.services import sharepay as sharepay_svc
from app.services.compliance import enforce_compliance
from app.services.email import notify_admin
from app.services.fees import calculate_fee_fcfa, credit_platform_fee, get_min_amount_fcfa
from app.services.notifications import create_notification

log = logging.getLogger("mobile_money_transfers")

router = APIRouter(prefix="/mobile-money-transfers", tags=["mobile-money-transfers"])
admin_router = APIRouter(prefix="/admin/mobile-money-transfers", tags=["admin-mobile-money-transfers"])

PROVIDERS = {"mtn": "MTN Mobile Money", "orange": "Orange Money"}
SUCCESS_STATUSES = {"success", "successful", "completed", "complete", "paid", "approved", "accepted"}
FAILED_STATUSES = {"failed", "failure", "cancelled", "canceled", "rejected", "declined", "expired", "error"}


class MobileMoneyQuoteReq(BaseModel):
    amount: Decimal = Field(..., gt=0)


class MobileMoneyInitReq(BaseModel):
    source_provider: str = Field(..., min_length=3, max_length=12)
    source_phone: str = Field(..., min_length=6, max_length=24)
    payer_name: str | None = Field(default="", max_length=120)
    dest_provider: str = Field(..., min_length=3, max_length=12)
    dest_phone: str = Field(..., min_length=6, max_length=24)
    dest_name: str = Field(..., min_length=2, max_length=120)
    amount: Decimal = Field(..., gt=0)
    pin: str | None = Field(default=None, min_length=4, max_length=8)


class ForceStatusReq(BaseModel):
    status: str = Field(..., min_length=3, max_length=40)
    note: str | None = Field(default="", max_length=500)


def _require_admin_token(token: str | None) -> None:
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if settings.environment != "production" and settings.dev_admin_token and token == settings.dev_admin_token:
        return
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT token FROM admin_sessions WHERE token=%s AND expires_at>%s AND revoked=FALSE LIMIT 1",
            (sha256_hex(token), utcnow()),
        )
        if cur.fetchone():
            return
    raise HTTPException(status_code=401, detail="Unauthorized")


def _provider(provider: str) -> str:
    p = (provider or "").strip().lower()
    if p not in PROVIDERS:
        raise HTTPException(400, "Opérateur invalide. Choisissez MTN ou Orange Money.")
    return p


def _normalize_cm_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("00237"):
        digits = digits[2:]
    if len(digits) == 9 and digits.startswith("6"):
        digits = f"237{digits}"
    if not (digits.startswith("237") and len(digits) == 12 and digits[3] == "6"):
        raise HTTPException(400, "Numéro camerounais invalide. Utilisez un numéro +237 valide.")
    return digits


def _money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _quote(amount: Decimal) -> dict[str, Any]:
    amount = _money(amount)
    min_amount = get_min_amount_fcfa("mobile_money_bridge", 100)
    if amount < min_amount:
        raise HTTPException(400, f"Montant minimum : {int(min_amount)} FCFA")
    fee = _money(calculate_fee_fcfa("mobile_money_bridge", amount))
    total = amount + fee
    return {
        "category": "mobile_money_bridge",
        "amount_fcfa": float(amount),
        "beneficiary_receives_fcfa": float(amount),
        "fee_fcfa": float(fee),
        "payin_total_fcfa": float(total),
        "min_amount_fcfa": float(min_amount),
    }


def _extract_provider_ref(data: dict[str, Any]) -> str:
    return str(
        data.get("reference")
        or data.get("transactionReference")
        or data.get("transaction_reference")
        or data.get("id")
        or ""
    )


def _status_from_payload(payload: dict[str, Any]) -> str:
    raw = payload.get("status") or payload.get("paymentStatus") or payload.get("transferStatus") or ""
    return str(raw).strip().lower()


def _serialize(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "user_email": row.get("user_email") or "",
        "source_provider": row["source_provider"],
        "source_phone": row["source_phone"],
        "payer_name": row.get("payer_name") or "",
        "dest_provider": row["dest_provider"],
        "dest_phone": row["dest_phone"],
        "dest_name": row["dest_name"],
        "amount_fcfa": float(row["amount_fcfa"]),
        "fee_fcfa": float(row["fee_fcfa"]),
        "payin_total_fcfa": float(row["payin_total_fcfa"]),
        "payout_amount_fcfa": float(row["payout_amount_fcfa"]),
        "payin_reference": row.get("payin_reference"),
        "payin_provider_reference": row.get("payin_provider_reference"),
        "payout_reference": row.get("payout_reference"),
        "payout_provider_reference": row.get("payout_provider_reference"),
        "status": row["status"],
        "note": row.get("note") or "",
        "failure_reason": row.get("failure_reason") or "",
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


def _get_transfer(transfer_id: str) -> dict[str, Any] | None:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT mmt.*, u.profile->>'email' AS user_email
            FROM mobile_money_transfers mmt
            LEFT JOIN users u ON u.id = mmt.user_id
            WHERE mmt.id=%s
            LIMIT 1
            """,
            (transfer_id,),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def _find_by_reference(reference: str) -> dict[str, Any] | None:
    if not reference:
        return None
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT * FROM mobile_money_transfers
            WHERE payin_reference=%s OR payin_provider_reference=%s
               OR payout_reference=%s OR payout_provider_reference=%s
            LIMIT 1
            """,
            (reference, reference, reference, reference),
        )
        row = cur.fetchone()
    return dict(row) if row else None


async def _trigger_payout(row: dict[str, Any]) -> dict[str, Any]:
    if row["status"] in ("payout_processing", "completed"):
        return row
    try:
        data = await sharepay_svc.create_transfer(
            reference=row["payout_reference"],
            amount=int(Decimal(str(row["payout_amount_fcfa"]))),
            provider=row["dest_provider"],
            phone=row["dest_phone"],
            name=row["dest_name"],
            description=f"Transfert Kobo Mobile Money {row['payout_reference']}",
        )
        provider_ref = _extract_provider_ref(data)
        now = utcnow()
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                """
                UPDATE mobile_money_transfers
                SET status='payout_processing', payout_provider_reference=%s, note=%s, updated_at=%s
                WHERE id=%s
                RETURNING *
                """,
                (provider_ref, "Paiement source confirmé. Envoi bénéficiaire en cours.", now, row["id"]),
            )
            updated = dict(cur.fetchone())
            conn.commit()
        create_notification(
            user_id=row["user_id"],
            notif_type="mobile_money_transfer_processing",
            title="Transfert Mobile Money en cours",
            body=f"Votre transfert de {int(Decimal(str(row['amount_fcfa']))):,} FCFA est confirmé. L'envoi au bénéficiaire est en cours.".replace(",", " "),
            metadata={"transfer_id": row["id"], "provider_reference": provider_ref},
        )
        return updated
    except Exception as exc:
        now = utcnow()
        reason = f"Envoi bénéficiaire échoué : {exc}"
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                """
                UPDATE mobile_money_transfers
                SET status='payout_failed', failure_reason=%s, note=%s, updated_at=%s
                WHERE id=%s
                RETURNING *
                """,
                (reason, "Paiement source encaissé, envoi bénéficiaire non confirmé.", now, row["id"]),
            )
            updated = dict(cur.fetchone())
            conn.commit()
        notify_admin(
            subject="Transfert Mobile Money direct à régulariser",
            body=(
                f"Le pay-in est confirmé mais le payout a échoué.\n"
                f"ID: {row['id']}\nMontant: {row['amount_fcfa']} FCFA\n"
                f"Bénéficiaire: {row['dest_name']} {row['dest_phone']}\nErreur: {exc}"
            ),
        )
        create_notification(
            user_id=row["user_id"],
            notif_type="mobile_money_transfer_review",
            title="Transfert à vérifier",
            body="Le paiement a été reçu, mais l'envoi au bénéficiaire doit être vérifié par l'équipe Kobo.",
            metadata={"transfer_id": row["id"]},
        )
        return updated


def _mark_completed(row: dict[str, Any], provider_payload: dict[str, Any] | None = None) -> bool:
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            UPDATE mobile_money_transfers
            SET status='completed', note=%s, updated_at=%s
            WHERE id=%s AND status <> 'completed'
            RETURNING *
            """,
            ("Transfert Mobile Money direct complété.", now, row["id"]),
        )
        updated = cur.fetchone()
        conn.commit()
    if not updated:
        return False
    credit_platform_fee(Decimal(str(row["fee_fcfa"])), "mobile_money_bridge", row["id"])
    create_notification(
        user_id=row["user_id"],
        notif_type="mobile_money_transfer_completed",
        title="Transfert Mobile Money envoyé",
        body=f"{int(Decimal(str(row['amount_fcfa']))):,} FCFA ont été envoyés au bénéficiaire.".replace(",", " "),
        metadata={"transfer_id": row["id"], "provider": provider_payload or {}},
    )
    return True


def _mark_failed(row: dict[str, Any], status: str, phase: str) -> bool:
    now = utcnow()
    target = "payin_failed" if phase == "payin" else "payout_failed"
    note = "Paiement source non abouti." if phase == "payin" else "Envoi bénéficiaire non abouti."
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE mobile_money_transfers
            SET status=%s, failure_reason=%s, note=%s, updated_at=%s
            WHERE id=%s AND status NOT IN ('completed','refunded')
            """,
            (target, status, note, now, row["id"]),
        )
        changed = cur.rowcount > 0
        conn.commit()
    if changed:
        create_notification(
            user_id=row["user_id"],
            notif_type="mobile_money_transfer_failed",
            title="Transfert Mobile Money non abouti",
            body="Le transfert n'a pas été confirmé. Aucun bénéficiaire n'a été payé automatiquement.",
            metadata={"transfer_id": row["id"], "phase": phase, "status": status},
        )
    return changed


@router.post("/quote")
async def quote_mobile_money_transfer(req: MobileMoneyQuoteReq, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    enforce_compliance(user_id=user.id, amount_fcfa=req.amount, flow="fiat", allow_manual_review=False)
    return _quote(req.amount)


@router.post("/init")
async def init_mobile_money_transfer(req: MobileMoneyInitReq, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    _verify_user_pin(user.id, req.pin)
    source_provider = _provider(req.source_provider)
    dest_provider = _provider(req.dest_provider)
    source_phone = _normalize_cm_phone(req.source_phone)
    dest_phone = _normalize_cm_phone(req.dest_phone)
    q = _quote(req.amount)
    enforce_compliance(user_id=user.id, amount_fcfa=Decimal(str(q["payin_total_fcfa"])), flow="fiat", allow_manual_review=False)

    transfer_id = f"mmt_{uuid.uuid4().hex[:16]}"
    payin_ref = f"MMB-IN-{uuid.uuid4().hex[:12].upper()}"
    payout_ref = f"MMB-OUT-{uuid.uuid4().hex[:12].upper()}"
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO mobile_money_transfers
            (id, user_id, source_provider, source_phone, payer_name, dest_provider, dest_phone, dest_name,
             amount_fcfa, fee_fcfa, payin_total_fcfa, payout_amount_fcfa, payin_reference, payout_reference,
             status, note, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending_payin',%s,%s,%s)
            """,
            (
                transfer_id,
                user.id,
                source_provider,
                source_phone,
                (req.payer_name or "").strip(),
                dest_provider,
                dest_phone,
                req.dest_name.strip(),
                Decimal(str(q["amount_fcfa"])),
                Decimal(str(q["fee_fcfa"])),
                Decimal(str(q["payin_total_fcfa"])),
                Decimal(str(q["beneficiary_receives_fcfa"])),
                payin_ref,
                payout_ref,
                "Demande créée. En attente de validation du paiement source.",
                now,
                now,
            ),
        )
        conn.commit()

    try:
        data = await sharepay_svc.create_charge(
            reference=payin_ref,
            amount=int(Decimal(str(q["payin_total_fcfa"]))),
            provider=source_provider,
            phone=source_phone,
            payer_name=(req.payer_name or "").strip(),
        )
        provider_ref = _extract_provider_ref(data)
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE mobile_money_transfers
                SET status='payin_processing', payin_provider_reference=%s, note=%s, updated_at=%s
                WHERE id=%s
                """,
                (provider_ref, "Demande envoyée. Validez le paiement sur le téléphone source.", utcnow(), transfer_id),
            )
            conn.commit()
    except Exception as exc:
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE mobile_money_transfers SET status='payin_failed', failure_reason=%s, updated_at=%s WHERE id=%s",
                (str(exc), utcnow(), transfer_id),
            )
            conn.commit()
        raise HTTPException(502, "Impossible de lancer le paiement Mobile Money. Aucun transfert n'a été envoyé.")

    create_notification(
        user_id=user.id,
        notif_type="mobile_money_transfer_started",
        title="Validation Mobile Money requise",
        body="Validez la demande sur le téléphone source. Kobo enverra ensuite le montant au bénéficiaire.",
        metadata={"transfer_id": transfer_id, "payin_reference": payin_ref},
    )
    return {
        "transfer_id": transfer_id,
        "reference": payin_ref,
        "status": "payin_processing",
        "message": "Validez la demande sur le téléphone source. L'envoi au bénéficiaire démarre dès confirmation.",
        **q,
    }


@router.get("/{transfer_id}")
async def get_mobile_money_transfer(transfer_id: str, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    row = _get_transfer(transfer_id)
    if not row or row["user_id"] != user.id:
        raise HTTPException(404, "Transfert introuvable")
    return _serialize(row)


async def handle_sharepay_webhook(event_type: str, data: dict[str, Any], sp_reference: str, merchant_reference: str = "") -> dict[str, Any]:
    ref = merchant_reference or sp_reference
    row = _find_by_reference(ref) or _find_by_reference(sp_reference)
    if not row:
        return {"status": "not_found"}
    status = _status_from_payload(data)
    if event_type.startswith("payment."):
        if event_type == "payment.success" or status in SUCCESS_STATUSES:
            updated = await _trigger_payout(row)
            return {"status": updated["status"], "transfer_id": updated["id"]}
        if event_type in ("payment.failed", "payment.cancelled") or status in FAILED_STATUSES:
            _mark_failed(row, status or event_type, "payin")
            return {"status": "payin_failed", "transfer_id": row["id"]}
    if event_type.startswith(("payout.", "transfer.")):
        if "success" in event_type or "completed" in event_type or status in SUCCESS_STATUSES:
            _mark_completed(row, data)
            return {"status": "completed", "transfer_id": row["id"]}
        if "failed" in event_type or "cancel" in event_type or "reject" in event_type or status in FAILED_STATUSES:
            _mark_failed(row, status or event_type, "payout")
            notify_admin(
                subject="Transfert Mobile Money direct non abouti",
                body=f"Le payout du transfert {row['id']} n'est pas confirmé. Statut: {status or event_type}",
            )
            return {"status": "payout_failed", "transfer_id": row["id"]}
    return {"status": "ignored", "transfer_id": row["id"]}


async def reconcile_mobile_money_transfers(limit: int = 50) -> dict[str, int]:
    result = {"mm_checked": 0, "mm_payins_completed": 0, "mm_payouts_completed": 0, "mm_failed": 0}
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT * FROM mobile_money_transfers
            WHERE status IN ('pending_payin','payin_processing','payout_processing')
              AND created_at >= now() - interval '7 days'
            ORDER BY created_at ASC
            LIMIT %s
            """,
            (limit,),
        )
        rows = [dict(r) for r in cur.fetchall()]

    for row in rows:
        result["mm_checked"] += 1
        try:
            if row["status"] in ("pending_payin", "payin_processing"):
                ref = row.get("payin_provider_reference") or row.get("payin_reference")
                if not ref:
                    continue
                payload = await sharepay_svc.get_payment_status(ref)
                status = _status_from_payload(payload)
                if status in SUCCESS_STATUSES:
                    updated = await _trigger_payout(row)
                    result["mm_payins_completed"] += 1
                    row = updated
                elif status in FAILED_STATUSES:
                    if _mark_failed(row, status, "payin"):
                        result["mm_failed"] += 1
            if row["status"] == "payout_processing":
                ref = row.get("payout_provider_reference") or row.get("payout_reference")
                if not ref:
                    continue
                payload = await sharepay_svc.get_payout_status(ref)
                status = _status_from_payload(payload)
                if status in SUCCESS_STATUSES:
                    if _mark_completed(row, payload):
                        result["mm_payouts_completed"] += 1
                elif status in FAILED_STATUSES:
                    if _mark_failed(row, status, "payout"):
                        result["mm_failed"] += 1
        except Exception as exc:
            log.warning("Mobile money transfer reconciliation failed id=%s: %s", row.get("id"), exc)
    return result


@admin_router.get("")
async def admin_list_mobile_money_transfers(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    status: str | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin_token(x_admin_token)
    where = ""
    params: list[Any] = []
    if status:
        where = "WHERE mmt.status=%s"
        params.append(status)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(f"SELECT COUNT(*) AS cnt FROM mobile_money_transfers mmt {where}", params)
        total = int(cur.fetchone()["cnt"])
        cur.execute(
            f"""
            SELECT mmt.*, u.profile->>'email' AS user_email
            FROM mobile_money_transfers mmt
            LEFT JOIN users u ON u.id = mmt.user_id
            {where}
            ORDER BY mmt.created_at DESC
            LIMIT %s OFFSET %s
            """,
            params + [limit, offset],
        )
        rows = [dict(r) for r in cur.fetchall()]
    return {"items": [_serialize(r) for r in rows], "total": total}


@admin_router.post("/{transfer_id}/retry-payout")
async def admin_retry_mobile_money_payout(
    transfer_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin_token(x_admin_token)
    row = _get_transfer(transfer_id)
    if not row:
        raise HTTPException(404, "Transfert introuvable")
    if row["status"] not in ("payout_failed", "payin_confirmed", "payout_processing"):
        raise HTTPException(400, "Le payout ne peut pas être relancé dans ce statut.")
    updated = await _trigger_payout(row)
    return _serialize(updated)


@admin_router.post("/{transfer_id}/mark-refunded")
async def admin_mark_mobile_money_refunded(
    transfer_id: str,
    body: ForceStatusReq | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin_token(x_admin_token)
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            UPDATE mobile_money_transfers
            SET status='refunded', note=%s, updated_at=%s
            WHERE id=%s
            RETURNING *
            """,
            ((body.note if body else "") or "Remboursement manuel confirmé par admin.", now, transfer_id),
        )
        row = cur.fetchone()
        conn.commit()
    if not row:
        raise HTTPException(404, "Transfert introuvable")
    return _serialize(dict(row))


@admin_router.patch("/{transfer_id}/force-status")
async def admin_force_mobile_money_status(
    transfer_id: str,
    body: ForceStatusReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin_token(x_admin_token)
    allowed = {"payin_processing", "payin_failed", "payout_processing", "payout_failed", "completed", "refunded", "manual_review"}
    if body.status not in allowed:
        raise HTTPException(400, "Statut non autorisé")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            UPDATE mobile_money_transfers
            SET status=%s, note=%s, updated_at=%s
            WHERE id=%s
            RETURNING *
            """,
            (body.status, body.note or "Statut modifié par admin.", utcnow(), transfer_id),
        )
        row = cur.fetchone()
        conn.commit()
    if not row:
        raise HTTPException(404, "Transfert introuvable")
    return _serialize(dict(row))
