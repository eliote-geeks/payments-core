from __future__ import annotations

import uuid
from contextlib import closing
from typing import Any

import psycopg
from psycopg.types.json import Json

from app.db.session import get_conn
from app.core.time import utcnow


EMAIL_NOTIFICATION_TYPES = {
    "p2p_sent",
    "p2p_received",
    "deposit_started",
    "deposit_pending",
    "deposit_confirmed",
    "deposit_failed",
    "crypto_deposit_started",
    "crypto_deposit_verified",
    "withdrawal_submitted",
    "withdrawal_processing",
    "withdrawal_pending_approval",
    "withdrawal_completed",
    "withdrawal_failed",
    "withdrawal_rejected",
    "payment_received",
    "payment_failed",
    "intl_transfer_created",
    "intl_transfer_completed",
    "intl_transfer_failed",
}


def create_notification(
    user_id: str,
    notif_type: str,
    title: str,
    body: str,
    metadata: dict | None = None,
) -> str:
    notif_id = f"notif_{uuid.uuid4().hex[:14]}"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notifications (id, user_id, type, title, body, metadata, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (notif_id, user_id, notif_type, title, body, Json(metadata or {}), utcnow()),
        )
        conn.commit()
    if notif_type in EMAIL_NOTIFICATION_TYPES:
        try:
            from app.services.email import notify_user
            notify_user(user_id, title, body, success=notif_type not in {"deposit_failed", "withdrawal_failed", "withdrawal_rejected", "payment_failed", "intl_transfer_failed"})
        except Exception:
            pass
    return notif_id


def list_notifications(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT id, type, title, body, read, metadata, created_at
            FROM notifications
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (user_id, limit),
        )
        rows = cur.fetchall() or []
    return [
        {
            "id": r["id"],
            "type": r["type"],
            "title": r["title"],
            "body": r["body"],
            "read": r["read"],
            "metadata": r["metadata"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]


def count_unread(user_id: str) -> int:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id = %s AND read = FALSE",
            (user_id,),
        )
        return cur.fetchone()[0]


def mark_read(user_id: str, notif_id: str | None = None) -> None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        if notif_id:
            cur.execute(
                "UPDATE notifications SET read = TRUE WHERE id = %s AND user_id = %s",
                (notif_id, user_id),
            )
        else:
            cur.execute(
                "UPDATE notifications SET read = TRUE WHERE user_id = %s",
                (user_id,),
            )
        conn.commit()


def delete_notification(user_id: str, notif_id: str | None = None) -> None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        if notif_id:
            cur.execute(
                "DELETE FROM notifications WHERE id = %s AND user_id = %s",
                (notif_id, user_id),
            )
        else:
            cur.execute("DELETE FROM notifications WHERE user_id = %s", (user_id,))
        conn.commit()
