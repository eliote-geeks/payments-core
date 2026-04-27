
import uuid
from contextlib import closing
from typing import Any

from fastapi import APIRouter
from psycopg.types.json import Json

from app.db.session import get_conn

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


async def store_webhook(provider: str, payload: dict[str, Any]) -> dict[str, Any]:
    event_type = payload.get("type", "unknown")
    transfer_id = payload.get("transfer_id")
    event_id = f"evt_{uuid.uuid4().hex[:16]}"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO webhook_events (id, provider, event_type, transfer_id, payload)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (event_id, provider, event_type, transfer_id, Json(payload)),
        )
        conn.commit()
    return {
        "status": "accepted",
        "event_id": event_id,
        "provider": provider,
        "event_type": event_type,
        "transfer_id": transfer_id,
    }


@router.post("/hyperswitch")
async def hyperswitch_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    return await store_webhook("hyperswitch", payload)


@router.post("/stellar")
async def stellar_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    return await store_webhook("stellar", payload)
