from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_user
from app.services.compliance import enforce_compliance
from app.services.idempotency import get_cached_response, store_response
from app.services.wallets import append_transaction, list_transactions, list_wallets

router = APIRouter(tags=["wallet"])


class TransferCreateRequest(BaseModel):
    currency: str = Field(min_length=3, max_length=8)
    amount: Decimal = Field(gt=0)
    to: str = Field(min_length=2, max_length=128)
    note: str | None = Field(default=None, max_length=240)
    pin: str | None = Field(default=None, max_length=12)


class WithdrawCreateRequest(BaseModel):
    provider: str = Field(min_length=2, max_length=32)  # mtn | orange | bank | crypto
    currency: str = Field(min_length=3, max_length=8)
    amount: Decimal = Field(gt=0)
    momo: str | None = Field(default=None, max_length=32)
    iban: str | None = Field(default=None, max_length=64)
    bankName: str | None = Field(default=None, max_length=64)
    cryptoAddr: str | None = Field(default=None, max_length=128)
    network: str | None = Field(default=None, max_length=32)
    pin: str | None = Field(default=None, max_length=12)


@router.get("/me")
async def me(user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    return {"id": user.id, "phone": user.phone_e164}


@router.get("/wallets")
async def wallets(user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    rows = list_wallets(user.id)
    # Keep the frontend shape similar to mock.js
    out = []
    for r in rows:
        metadata = r.get("metadata") or {}
        out.append(
            {
                "currency": r["currency"],
                "balance": float(r["balance"]),
                "address": r.get("address"),
                "network": metadata.get("network"),
            }
        )
    return {"items": out}


@router.get("/transactions")
async def transactions(limit: int = 50, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    rows = list_transactions(user.id, limit=limit)
    items = []
    for r in rows:
        direction = r["direction"]
        items.append(
            {
                "id": r["id"],
                "type": "credit" if direction == "credit" else "debit",
                "category": r["category"],
                "label": r["label"],
                "counterpart": r["counterpart"],
                "amount": float(r["amount"]),
                "currency": r["currency"],
                "date": r["date"].isoformat(),
                "status": r["status"],
            }
        )
    return {"items": items}


@router.post("/transfer")
async def create_transfer(
    req: TransferCreateRequest,
    request: Request,
    user: AuthUser = Depends(require_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    # Ancienne route incohérente : elle écrivait un débit dans le grand livre sans
    # déplacer le solde. Les transferts réels passent par /p2p/transfer.
    raise HTTPException(410, "Cette route est désactivée. Utilisez /p2p/transfer.")


@router.post("/withdraw")
async def create_withdraw(
    req: WithdrawCreateRequest,
    request: Request,
    user: AuthUser = Depends(require_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    # Route désactivée — ne déduisait jamais le solde wallet_accounts (bug critique).
    # Utiliser /fiat-withdrawals/init pour les retraits FCFA.
    raise HTTPException(410, "Cette route est désactivée. Utilisez /fiat-withdrawals/init.")
