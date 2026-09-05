from __future__ import annotations

import uuid
from contextlib import closing
from typing import Any

from psycopg.types.json import Json

from app.db.session import get_conn


def record_audit(
    *,
    action: str,
    resource: str,
    actor_user_id: str | None = None,
    actor_identifier: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    event_id = f"aud_{uuid.uuid4().hex[:16]}"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO audit_logs (id, actor_user_id, actor_identifier, action, resource, metadata)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (event_id, actor_user_id, actor_identifier, action, resource, Json(metadata or {})),
        )
        conn.commit()
    return event_id
