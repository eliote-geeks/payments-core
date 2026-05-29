from __future__ import annotations

import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Json

from app.core.serialization import json_ready
from app.db.session import get_conn


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


KYC_LIMITS: dict[int, dict[str, int]] = {
    0: {"dailyFCFA": 50_000, "monthlyFCFA": 200_000},
    1: {"dailyFCFA": 500_000, "monthlyFCFA": 2_000_000},
    2: {"dailyFCFA": 2_000_000, "monthlyFCFA": 10_000_000},
    3: {"dailyFCFA": 10_000_000, "monthlyFCFA": 50_000_000},
}


DEFAULT_DOCS = [
    # Default state: user hasn't submitted anything yet.
    {"key": "idFront", "status": "missing"},
    {"key": "idBack", "status": "missing"},
    {"key": "selfie", "status": "missing"},
    {"key": "address", "status": "missing"},
]


def ensure_kyc_profile(user_id: str) -> None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO kyc_profiles (user_id, level, status, metadata, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO NOTHING
            """,
            (user_id, 0, "unverified", Json(json_ready({})), utcnow(), utcnow()),
        )
        for d in DEFAULT_DOCS:
            cur.execute(
                """
                INSERT INTO kyc_documents (id, user_id, doc_key, status, reason, metadata, created_at, updated_at)
                VALUES (%s,%s,%s,%s,NULL,%s,%s,%s)
                ON CONFLICT (user_id, doc_key) DO NOTHING
                """,
                (
                    f"kyc_{uuid.uuid4().hex[:16]}",
                    user_id,
                    d["key"],
                    d["status"],
                    Json(json_ready({})),
                    utcnow(),
                    utcnow(),
                ),
            )
        conn.commit()


def get_kyc(user_id: str) -> dict[str, Any]:
    ensure_kyc_profile(user_id)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM kyc_profiles WHERE user_id = %s", (user_id,))
        profile = cur.fetchone()
        cur.execute(
            """
            SELECT
              doc_key AS key,
              CASE
                WHEN status = 'pending' AND file_name IS NULL AND content IS NULL THEN 'missing'
                ELSE status
              END AS status,
              (file_name IS NOT NULL OR content IS NOT NULL) AS has_file,
              file_name,
              reason
            FROM kyc_documents
            WHERE user_id = %s
            ORDER BY doc_key
            """,
            (user_id,),
        )
        docs = cur.fetchall() or []
    return {"profile": profile, "documents": docs}


def set_document_pending(user_id: str, doc_key: str) -> None:
    ensure_kyc_profile(user_id)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE kyc_documents
            SET status = 'pending', reason = NULL, updated_at = %s
            WHERE user_id = %s AND doc_key = %s
            """,
            (utcnow(), user_id, doc_key),
        )
        conn.commit()


def store_document_upload(
    *,
    user_id: str,
    doc_key: str,
    file_name: str,
    content_type: str,
    content: bytes,
) -> None:
    ensure_kyc_profile(user_id)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE kyc_documents
            SET status = 'pending',
                reason = NULL,
                file_name = %s,
                content_type = %s,
                content = %s,
                size_bytes = %s,
                updated_at = %s
            WHERE user_id = %s AND doc_key = %s
            """,
            (file_name[:255], content_type[:255], content, len(content), utcnow(), user_id, doc_key),
        )
        # If the user has submitted all required docs, move them to "in_review"
        # and unlock level 1 limits.
        cur.execute(
            """
            WITH doc_state AS (
              SELECT
                bool_and(content IS NOT NULL OR file_name IS NOT NULL) AS all_present,
                bool_or(content IS NOT NULL OR file_name IS NOT NULL) AS any_present
              FROM kyc_documents
              WHERE user_id = %s
                AND doc_key IN ('idFront','idBack','selfie','address')
            )
            UPDATE kyc_profiles
            SET
              status = CASE
                WHEN (SELECT all_present FROM doc_state) THEN 'ready_to_submit'
                WHEN (SELECT any_present FROM doc_state) THEN 'collecting'
                ELSE 'unverified'
              END,
              updated_at = %s
            WHERE user_id = %s
            """,
            (user_id, utcnow(), user_id),
        )
        conn.commit()


def reset_kyc(user_id: str) -> None:
    """Clear all uploaded docs and reset verification workflow (dev/admin convenience)."""
    ensure_kyc_profile(user_id)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE kyc_documents
            SET status = 'missing',
                reason = NULL,
                file_name = NULL,
                content_type = NULL,
                content = NULL,
                size_bytes = NULL,
                updated_at = %s
            WHERE user_id = %s
              AND doc_key IN ('idFront','idBack','selfie','address')
            """,
            (utcnow(), user_id),
        )
        cur.execute(
            """
            UPDATE kyc_profiles
            SET level = 0,
                status = 'unverified',
                updated_at = %s
            WHERE user_id = %s
            """,
            (utcnow(), user_id),
        )
        conn.commit()


def _sum_transactions_since(user_id: str, since: datetime) -> Decimal:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(amount), 0)
            FROM wallet_transactions
            WHERE user_id = %s
              AND currency = 'FCFA'
              AND created_at >= %s
            """,
            (user_id, since),
        )
        v = cur.fetchone()[0]
    return Decimal(str(v))


def limits_for(user_id: str, level: int) -> dict[str, Any]:
    limits = KYC_LIMITS.get(level, KYC_LIMITS[0])
    day_used = _sum_transactions_since(user_id, utcnow() - timedelta(days=1))
    month_used = _sum_transactions_since(user_id, utcnow() - timedelta(days=30))
    return {
        "level": level,
        "dailyFCFA": limits["dailyFCFA"],
        "monthlyFCFA": limits["monthlyFCFA"],
        "dailyUsedFCFA": float(day_used),
        "monthlyUsedFCFA": float(month_used),
        "dailyRemainingFCFA": max(0.0, limits["dailyFCFA"] - float(day_used)),
        "monthlyRemainingFCFA": max(0.0, limits["monthlyFCFA"] - float(month_used)),
    }
