from __future__ import annotations

import uuid
from contextlib import closing
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_user
from app.core.time import utcnow
from app.db.session import get_conn
from app.services.idempotency import get_cached_response, store_response
from app.services.notchpay import initiate_transfer
from app.services.wallets import append_transaction, list_transactions, list_wallets

router = APIRouter(tags=["wallet"])


class TransferCreateRequest(BaseModel):
    currency: str = Field(min_length=3, max_length=8)
    amount: Decimal = Field(gt=0)
    to: str = Field(min_length=2, max_length=128)
    note: str | None = Field(default=None, max_length=240)
    pin: str | None = Field(default=None, max_length=12)


class WithdrawCreateRequest(BaseModel):
    provider: str = Field(min_length=2, max_length=32)
    currency: str = Field(min_length=3, max_length=8)
    amount: Decimal = Field(gt=0)
    momo: str | None = Field(default=None, max_length=32)
    iban: str | None = Field(default=None, max_length=64)
    bankName: str | None = Field(default=None, max_length=64)
    cryptoAddr: str | None = Field(default=None, max_length=128)
    network: str | None = Field(default=None, max_length=32)
    pin: str | None = Field(default=None, max_length=12)


@router.get("/wallets")
async def wallets(user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    rows = list_wallets(user.id)
    out = []
    for r in rows:
        metadata = r.get("metadata") or {}
        out.append({
            "currency": r["currency"],
            "balance": float(r["balance"]),
            "address": r.get("address"),
            "network": metadata.get("network"),
        })
    return {"items": out}


@router.get("/transactions")
async def transactions(limit: int = 50, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    rows = list_transactions(user.id, limit=limit)
    items = []
    for r in rows:
        direction = r["direction"]
        items.append({
            "id": r["id"],
            "type": "credit" if direction == "credit" else "debit",
            "category": r["category"],
            "label": r["label"],
            "counterpart": r["counterpart"],
            "amount": float(r["amount"]),
            "currency": r["currency"],
            "date": r["date"].isoformat(),
            "status": r["status"],
        })
    return {"items": items}


@router.post("/transfer")
async def create_transfer(
    req: TransferCreateRequest,
    request: Request,
    user: AuthUser = Depends(require_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    body = req.model_dump()
    if idempotency_key:
        cached = get_cached_response(
            key=idempotency_key, user_id=user.id,
            method=request.method, path=str(request.url.path), body=body,
        )
        if cached:
            if cached.status_code != 200:
                raise HTTPException(status_code=cached.status_code, detail=cached.body.get("detail"))
            return cached.body

    tx_id = f"tx_{uuid.uuid4().hex[:16]}"
    row = append_transaction(
        tx_id=tx_id, user_id=user.id, direction="debit", category="transfer",
        label="Transfert", counterpart=req.to, amount=req.amount,
        currency=req.currency, status="completed", metadata={"note": req.note or ""},
    )
    resp = {"ok": True, "transaction_id": row["id"]}
    if idempotency_key:
        store_response(
            key=idempotency_key, user_id=user.id, method=request.method,
            path=str(request.url.path), body=body, status_code=200, response_body=resp,
        )
    return resp


@router.post("/withdraw")
async def create_withdraw(
    req: WithdrawCreateRequest,
    request: Request,
    user: AuthUser = Depends(require_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    body = req.model_dump()
    if idempotency_key:
        cached = get_cached_response(
            key=idempotency_key, user_id=user.id,
            method=request.method, path=str(request.url.path), body=body,
        )
        if cached:
            if cached.status_code != 200:
                raise HTTPException(status_code=cached.status_code, detail=cached.body.get("detail"))
            return cached.body

    provider = req.provider.lower()
    tx_id = f"tx_{uuid.uuid4().hex[:16]}"
    counterpart = req.momo or req.iban or req.cryptoAddr or req.provider

    # ── Mobile Money via NotchPay ──────────────────────────────────────────
    if provider in ("mtn", "orange"):
        if not req.momo:
            raise HTTPException(status_code=400, detail="Numéro Mobile Money requis")
        amount_xaf = int(req.amount)
        if amount_xaf < 500:
            raise HTTPException(status_code=400, detail="Montant minimum 500 FCFA")

        # Vérifier et débiter le solde FCFA
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                "SELECT balance FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA'",
                (user.id,),
            )
            row = cur.fetchone()
            balance = Decimal(str(row["balance"])) if row else Decimal("0")
            if balance < req.amount:
                raise HTTPException(
                    status_code=400,
                    detail=f"Solde insuffisant ({float(balance):.0f} FCFA disponible)",
                )
            cur.execute(
                "UPDATE wallet_accounts SET balance = balance - %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
                (req.amount, utcnow(), user.id),
            )
            conn.commit()

        # Appeler NotchPay
        notchpay_ref = f"kobo_{tx_id}"
        notchpay_data = {}
        notchpay_status = "processing"
        try:
            notchpay_data = await initiate_transfer(
                reference=notchpay_ref,
                amount=amount_xaf,
                phone=req.momo,
                provider=provider,
                description=f"Retrait Kobo {provider.upper()}",
            )
        except Exception as exc:
            # Rembourser immédiatement si NotchPay échoue
            with closing(get_conn()) as conn, conn.cursor() as cur:
                cur.execute(
                    "UPDATE wallet_accounts SET balance = balance + %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
                    (req.amount, utcnow(), user.id),
                )
                conn.commit()
            raise HTTPException(status_code=502, detail=f"Erreur paiement Mobile Money: {exc}")

        # Enregistrer la transaction
        tx_row = append_transaction(
            tx_id=tx_id, user_id=user.id, direction="debit",
            category="withdraw",
            label=f"Retrait {provider.upper()} Mobile Money",
            counterpart=req.momo, amount=req.amount, currency="FCFA",
            status=notchpay_status,
            metadata={
                "provider": provider,
                "notchpay_ref": notchpay_ref,
                "notchpay_transfer_id": notchpay_data.get("transfer", {}).get("id") or notchpay_data.get("id"),
                "phone": req.momo,
            },
        )
        resp = {
            "ok": True,
            "transaction_id": tx_row["id"],
            "status": "processing",
            "message": f"Paiement Mobile Money en cours. Tu recevras une notification {provider.upper()} sous peu.",
        }
        if idempotency_key:
            store_response(
                key=idempotency_key, user_id=user.id, method=request.method,
                path=str(request.url.path), body=body, status_code=200, response_body=resp,
            )
        return resp

    # ── Virement bancaire (manuel) ─────────────────────────────────────────
    if provider == "bank":
        # Débiter immédiatement pour éviter double-dépense
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                "SELECT balance FROM wallet_accounts WHERE user_id = %s AND currency = %s",
                (user.id, req.currency),
            )
            bal_row = cur.fetchone()
            balance = Decimal(str(bal_row["balance"])) if bal_row else Decimal("0")
            if balance < req.amount:
                raise HTTPException(
                    status_code=400,
                    detail=f"Solde insuffisant ({float(balance):.0f} {req.currency} disponible)",
                )
            cur.execute(
                "UPDATE wallet_accounts SET balance = balance - %s, updated_at = %s WHERE user_id = %s AND currency = %s",
                (req.amount, utcnow(), user.id, req.currency),
            )
            conn.commit()

        tx_row = append_transaction(
            tx_id=tx_id, user_id=user.id, direction="debit",
            category="withdraw", label="Virement bancaire",
            counterpart=req.iban or req.bankName or "bank",
            amount=req.amount, currency=req.currency, status="pending",
            metadata=req.model_dump(),
        )
        resp = {
            "ok": True,
            "transaction_id": tx_row["id"],
            "status": "pending",
            "message": "Demande de virement enregistrée. L'équipe Kobo la traitera sous 2-3 jours ouvrés.",
        }
        if idempotency_key:
            store_response(
                key=idempotency_key, user_id=user.id, method=request.method,
                path=str(request.url.path), body=body, status_code=200, response_body=resp,
            )
        return resp

    # ── Autres (fallback) ─────────────────────────────────────────────────
    tx_row = append_transaction(
        tx_id=tx_id, user_id=user.id, direction="debit",
        category="withdraw", label=f"Retrait {req.provider.upper()}",
        counterpart=counterpart, amount=req.amount, currency=req.currency,
        status="pending", metadata=req.model_dump(),
    )
    resp = {"ok": True, "transaction_id": tx_row["id"], "status": "pending"}
    if idempotency_key:
        store_response(
            key=idempotency_key, user_id=user.id, method=request.method,
            path=str(request.url.path), body=body, status_code=200, response_body=resp,
        )
    return resp
