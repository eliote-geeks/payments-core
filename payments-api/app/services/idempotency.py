from __future__ import annotations

import json
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.types.json import Json

from app.core.serialization import json_ready
from app.db.session import get_conn


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class CachedResponse:
    status_code: int
    body: dict[str, Any]


def _request_hash(method: str, path: str, body: Any) -> str:
    # stable hash input; ok for MVP idempotency (not for security)
    raw = json.dumps(
        {"m": method.upper(), "p": path, "b": body},
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    # reuse existing helper rather than adding deps
    import hashlib

    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_cached_response(*, key: str, user_id: str, method: str, path: str, body: Any) -> CachedResponse | None:
    req_hash = _request_hash(method, path, body)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT status_code, response_body, request_hash
            FROM idempotency_keys
            WHERE idempotency_key = %s AND user_id = %s
            """,
            (key, user_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    if row["request_hash"] != req_hash:
        return CachedResponse(status_code=409, body={"detail": "Idempotency-Key reused with different request"})
    return CachedResponse(status_code=row["status_code"], body=row["response_body"])


def store_response(*, key: str, user_id: str, method: str, path: str, body: Any, status_code: int, response_body: dict[str, Any]) -> None:
    req_hash = _request_hash(method, path, body)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO idempotency_keys (
              idempotency_key, user_id, request_hash, status_code, response_body, created_at
            ) VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (idempotency_key, user_id)
            DO NOTHING
            """,
            (key, user_id, req_hash, status_code, Json(json_ready(response_body)), utcnow()),
        )
        conn.commit()

