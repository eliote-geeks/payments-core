from __future__ import annotations

import uuid
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Json

from app.core.serialization import json_ready
from app.db.session import get_conn
from app.services.wallets import ensure_default_wallets


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_user_by_phone(phone_e164: str) -> dict[str, Any] | None:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id, phone_e164, profile FROM users WHERE phone_e164 = %s", (phone_e164,))
        return cur.fetchone()


def lookup_user(*, phone_e164: str) -> dict[str, Any] | None:
    row = _get_user_by_phone(phone_e164)
    if not row:
        return None
    profile = row.get("profile") or {}
    return {"id": row["id"], "phone": row["phone_e164"], "fullName": profile.get("fullName") or ""}


def p2p_transfer_fcfa(
    *,
    sender_user_id: str,
    sender_phone: str,
    recipient_phone_e164: str,
    amount_fcfa: Decimal,
    note: str = "",
) -> dict[str, Any]:
    if amount_fcfa <= 0:
        raise ValueError("amount must be > 0")
    if recipient_phone_e164 == sender_phone:
        raise ValueError("cannot send to self")

    recipient = _get_user_by_phone(recipient_phone_e164)
    if not recipient:
        raise ValueError("recipient not found")

    ensure_default_wallets(sender_user_id)
    ensure_default_wallets(recipient["id"])

    transfer_id = f"p2p_{uuid.uuid4().hex[:16]}"
    ledger_id = f"led_{uuid.uuid4().hex[:16]}"
    now = utcnow()

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        # lock both wallet rows to ensure atomic update
        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA' FOR UPDATE",
            (sender_user_id,),
        )
        sender_wallet = cur.fetchone()
        if not sender_wallet:
            raise ValueError("sender wallet missing")
        sender_balance = Decimal(str(sender_wallet["balance"]))
        if sender_balance < amount_fcfa:
            raise ValueError("insufficient balance")

        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA' FOR UPDATE",
            (recipient["id"],),
        )
        recipient_wallet = cur.fetchone()
        if not recipient_wallet:
            raise ValueError("recipient wallet missing")
        recipient_balance = Decimal(str(recipient_wallet["balance"]))

        # balances
        cur.execute(
            "UPDATE wallet_accounts SET balance = %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
            (sender_balance - amount_fcfa, now, sender_user_id),
        )
        cur.execute(
            "UPDATE wallet_accounts SET balance = %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
            (recipient_balance + amount_fcfa, now, recipient["id"]),
        )

        # ledger
        cur.execute(
            """
            INSERT INTO ledger_entries (id, kind, currency, amount, sender_user_id, recipient_user_id, metadata, created_at)
            VALUES (%s,'p2p','FCFA',%s,%s,%s,%s,%s)
            """,
            (
                ledger_id,
                amount_fcfa,
                sender_user_id,
                recipient["id"],
                Json(json_ready({"note": note, "recipient_phone": recipient_phone_e164})),
                now,
            ),
        )

        # p2p transfer record
        cur.execute(
            """
            INSERT INTO p2p_transfers (id, ledger_entry_id, sender_user_id, recipient_user_id, amount, currency, status, created_at)
            VALUES (%s,%s,%s,%s,%s,'FCFA','completed',%s)
            """,
            (transfer_id, ledger_id, sender_user_id, recipient["id"], amount_fcfa, now),
        )

        # transactions mirror for UI history
        sender_tx = f"tx_{uuid.uuid4().hex[:16]}"
        recipient_tx = f"tx_{uuid.uuid4().hex[:16]}"
        cur.execute(
            """
            INSERT INTO wallet_transactions (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
            VALUES (%s,%s,'debit','p2p','Envoi',%s,%s,'FCFA','completed',%s,%s)
            """,
            (
                sender_tx,
                sender_user_id,
                recipient_phone_e164,
                amount_fcfa,
                Json(json_ready({"p2p_id": transfer_id, "note": note})),
                now,
            ),
        )
        cur.execute(
            """
            INSERT INTO wallet_transactions (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
            VALUES (%s,%s,'credit','p2p','Recu',%s,%s,'FCFA','completed',%s,%s)
            """,
            (
                recipient_tx,
                recipient["id"],
                sender_phone,
                amount_fcfa,
                Json(json_ready({"p2p_id": transfer_id, "note": note})),
                now,
            ),
        )

        conn.commit()

    return {
        "id": transfer_id,
        "status": "completed",
        "currency": "FCFA",
        "amount": float(amount_fcfa),
        "recipient": {"id": recipient["id"], "phone": recipient["phone_e164"]},
    }

