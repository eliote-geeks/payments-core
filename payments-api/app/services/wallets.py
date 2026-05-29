from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Json

from app.core.serialization import json_ready
from app.db.session import get_conn


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


DEFAULT_WALLETS: list[dict[str, Any]] = [
    {"currency": "FCFA", "balance": Decimal("0"), "address": None, "metadata": {}},
    {"currency": "EUR", "balance": Decimal("0"), "address": None, "metadata": {}},
    {"currency": "USD", "balance": Decimal("0"), "address": None, "metadata": {}},
    {"currency": "USDT", "balance": Decimal("0"), "address": "TQrZ9wBfXk8H2YpNmLkRsJv4cQxAeBcDfG", "metadata": {"network": "TRC20"}},
    {"currency": "BTC", "balance": Decimal("0"), "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh", "metadata": {"network": "Bitcoin"}},
]


def ensure_default_wallets(user_id: str) -> None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        for w in DEFAULT_WALLETS:
            cur.execute(
                """
                INSERT INTO wallet_accounts (user_id, currency, balance, address, metadata, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_id, currency) DO NOTHING
                """,
                (
                    user_id,
                    w["currency"],
                    w["balance"],
                    w["address"],
                    Json(json_ready(w.get("metadata", {}))),
                    utcnow(),
                    utcnow(),
                ),
            )
        conn.commit()


def list_wallets(user_id: str) -> list[dict[str, Any]]:
    ensure_default_wallets(user_id)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT currency, balance, address, metadata
            FROM wallet_accounts
            WHERE user_id = %s
            ORDER BY currency
            """,
            (user_id,),
        )
        rows = cur.fetchall()
    return rows or []


def append_transaction(
    *,
    tx_id: str,
    user_id: str,
    direction: str,
    category: str,
    label: str,
    counterpart: str,
    amount: Decimal,
    currency: str,
    status: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta = metadata or {}
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO wallet_transactions (
              id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                tx_id,
                user_id,
                direction,
                category,
                label,
                counterpart,
                amount,
                currency,
                status,
                Json(json_ready(meta)),
                utcnow(),
            ),
        )
        row = cur.fetchone()
        conn.commit()
    return row


def list_transactions(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT id, direction, category, label, counterpart, amount, currency, created_at AS date, status
            FROM wallet_transactions
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (user_id, limit),
        )
        return cur.fetchall() or []

