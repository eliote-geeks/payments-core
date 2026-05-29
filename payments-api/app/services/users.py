from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.types.json import Json

from app.db.session import get_conn


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def get_user_by_phone(phone_e164: str) -> dict[str, Any] | None:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM users WHERE phone_e164 = %s", (phone_e164,))
        return cur.fetchone()


def get_user_by_email(email: str) -> dict[str, Any] | None:
    email = email.lower().strip()
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM users WHERE email = %s OR phone_e164 = %s",
            (email, email),
        )
        return cur.fetchone()


def get_user(user_id: str) -> dict[str, Any] | None:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        return cur.fetchone()


def create_user(*, user_id: str, phone_e164: str, email: str | None = None, profile: dict[str, Any]) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO users (id, phone_e164, email, profile, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (user_id, phone_e164, email, Json(profile), utcnow(), utcnow()),
        )
        row = cur.fetchone()
        conn.commit()
    return row


def update_user_profile(*, user_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT profile FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        if not row:
            raise ValueError("User not found")
        current = row["profile"] or {}
        current.update(patch)
        cur.execute(
            """
            UPDATE users
            SET profile = %s, updated_at = %s
            WHERE id = %s
            RETURNING *
            """,
            (Json(current), utcnow(), user_id),
        )
        out = cur.fetchone()
        conn.commit()
    return out
