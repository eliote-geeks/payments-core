from __future__ import annotations

import hashlib
import secrets
import uuid
from contextlib import closing
from typing import Any

import psycopg

from app.db.session import get_conn
from app.core.time import utcnow


def _hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def generate_api_key(user_id: str, name: str, is_test: bool = False) -> dict[str, str]:
    """Crée une clé API, retourne la clé en clair UNE SEULE FOIS."""
    prefix = "kb_test_" if is_test else "kb_live_"
    raw_key = prefix + secrets.token_hex(24)
    key_id = f"ak_{uuid.uuid4().hex[:16]}"
    key_hash = _hash_key(raw_key)
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO api_keys (id, user_id, name, key_hash, is_test, active, created_at)
               VALUES (%s, %s, %s, %s, %s, TRUE, %s)""",
            (key_id, user_id, name, key_hash, is_test, now),
        )
        conn.commit()
    return {"id": key_id, "key": raw_key, "name": name, "is_test": is_test}


def resolve_api_key(raw_key: str) -> dict[str, Any] | None:
    """Valide une clé et retourne les infos du marchand. Met à jour last_used_at."""
    key_hash = _hash_key(raw_key)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT ak.id, ak.user_id, ak.name, ak.is_test, ak.active,
                      u.email, u.phone_e164, u.profile
               FROM api_keys ak
               JOIN users u ON u.id = ak.user_id
               WHERE ak.key_hash = %s LIMIT 1""",
            (key_hash,),
        )
        row = cur.fetchone()
    if not row or not row["active"]:
        return None
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE api_keys SET last_used_at=%s WHERE id=%s", (utcnow(), row["id"]))
        conn.commit()
    profile = row.get("profile") or {}
    return {
        "key_id":  row["id"],
        "user_id": row["user_id"],
        "name":    row["name"],
        "is_test": row["is_test"],
        "email":   row.get("email"),
        "merchant_name": profile.get("fullName") or profile.get("full_name") or row.get("phone_e164") or "Marchand Kobo",
    }


def list_api_keys(user_id: str) -> list[dict]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT id, name, is_test, active, last_used_at, created_at
               FROM api_keys WHERE user_id=%s ORDER BY created_at DESC""",
            (user_id,),
        )
        rows = cur.fetchall()
    return [
        {
            "id":           r["id"],
            "name":         r["name"],
            "is_test":      r["is_test"],
            "active":       r["active"],
            "last_used_at": r["last_used_at"].isoformat() if r["last_used_at"] else None,
            "created_at":   r["created_at"].isoformat(),
        }
        for r in rows
    ]


def revoke_api_key(key_id: str, user_id: str) -> bool:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE api_keys SET active=FALSE WHERE id=%s AND user_id=%s",
            (key_id, user_id),
        )
        affected = cur.rowcount
        conn.commit()
    return affected > 0
