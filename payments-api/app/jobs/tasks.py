from __future__ import annotations

from typing import Any


async def reconcile_transfer(ctx: dict[str, Any], transfer_id: str) -> dict[str, str]:
    return {"status": "queued", "transfer_id": transfer_id}


async def process_provider_webhook(ctx: dict[str, Any], event_id: str) -> dict[str, str]:
    return {"status": "queued", "event_id": event_id}


async def send_notification(ctx: dict[str, Any], user_id: str, message: str) -> dict[str, str]:
    return {"status": "queued", "user_id": user_id, "message": message}

