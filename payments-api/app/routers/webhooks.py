
import base64
import hashlib
import hmac
import json
import uuid
from contextlib import closing
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from psycopg.types.json import Json

from app.db.session import get_conn
from app.core.config import settings
from app.services.jobs import enqueue_job

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


async def store_webhook(provider: str, payload: dict[str, Any]) -> dict[str, Any]:
    event_type = payload.get("type", "unknown")
    transfer_id = payload.get("transfer_id")
    provider_event_id = str(payload.get("event_id") or payload.get("id") or "").strip()
    event_id = (
        "evt_" + hashlib.sha256(f"{provider}:{provider_event_id}".encode()).hexdigest()[:16]
        if provider_event_id
        else f"evt_{uuid.uuid4().hex[:16]}"
    )
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO webhook_events (id, provider, event_type, transfer_id, payload)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (event_id, provider, event_type, transfer_id, Json(payload)),
        )
        inserted = cur.rowcount == 1
        conn.commit()
    if not inserted:
        return {"status": "duplicate", "event_id": event_id, "provider": provider}
    await enqueue_job("process_provider_webhook", event_id)
    if transfer_id:
        await enqueue_job("reconcile_transfer", transfer_id)
    return {
        "status": "accepted",
        "event_id": event_id,
        "provider": provider,
        "event_type": event_type,
        "transfer_id": transfer_id,
    }


def _valid_hyperswitch_signature(body: bytes, signature: str) -> bool:
    secret = settings.hyperswitch_webhook_secret
    if not secret or not signature:
        return False
    digest = hmac.new(secret.encode(), body, hashlib.sha512).digest()
    candidates = {digest.hex(), base64.b64encode(digest).decode()}
    supplied = signature.strip().removeprefix("sha512=")
    return any(hmac.compare_digest(supplied, candidate) for candidate in candidates)


@router.post("/hyperswitch")
async def hyperswitch_webhook(request: Request) -> dict[str, Any]:
    body = await request.body()
    signature = request.headers.get("x-webhook-signature-512", "")
    if not _valid_hyperswitch_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")
    return await store_webhook("hyperswitch", payload)


@router.post("/stellar")
async def stellar_webhook(request: Request, payload: dict[str, Any]) -> dict[str, Any]:
    supplied = request.headers.get("x-webhook-secret", "")
    if not settings.stellar_webhook_secret or not hmac.compare_digest(
        supplied,
        settings.stellar_webhook_secret,
    ):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    return await store_webhook("stellar", payload)
