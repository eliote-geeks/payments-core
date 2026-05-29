from __future__ import annotations

import uuid
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, Header, HTTPException
from psycopg.types.json import Json

from app.core.config import settings
from app.core.serialization import json_ready
from app.db.session import get_conn
from app.services.wallets import ensure_default_wallets

router = APIRouter(prefix="/dev", tags=["dev"])


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _require_dev_token(token: str | None) -> None:
    if not settings.dev_admin_token:
        raise HTTPException(status_code=404, detail="Not found")
    if not token or token != settings.dev_admin_token:
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/credit")
async def credit(
    payload: dict[str, Any],
    x_dev_token: str | None = Header(default=None, alias="X-Dev-Token"),
) -> dict[str, Any]:
    """
    Dev helper to top-up a user's FCFA wallet so you can test P2P transfers end-to-end.
    Required JSON:
      - phone_e164: "+2376..."
      - amount: number
    """
    _require_dev_token(x_dev_token)

    phone = str(payload.get("phone_e164", "")).strip()
    amount = Decimal(str(payload.get("amount", "0")))
    note = str(payload.get("note", "")).strip()
    if len(phone) < 8:
        raise HTTPException(status_code=400, detail="phone_e164 required")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount must be > 0")

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id, phone_e164 FROM users WHERE phone_e164 = %s", (phone,))
        user = cur.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

    ensure_default_wallets(user["id"])
    tx_id = f"tx_{uuid.uuid4().hex[:16]}"

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA' FOR UPDATE",
            (user["id"],),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="Wallet missing")
        bal = Decimal(str(row["balance"]))
        new_bal = bal + amount
        cur.execute(
            "UPDATE wallet_accounts SET balance = %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
            (new_bal, utcnow(), user["id"]),
        )
        cur.execute(
            """
            INSERT INTO wallet_transactions (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
            VALUES (%s,%s,'credit','deposit','Depot test','DEV',%s,'FCFA','completed',%s,%s)
            """,
            (tx_id, user["id"], amount, Json(json_ready({"note": note})), utcnow()),
        )
        conn.commit()

    return {"ok": True, "phone_e164": user["phone_e164"], "balance_fcfa": float(new_bal)}

