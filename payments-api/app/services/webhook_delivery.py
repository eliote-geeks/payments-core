from __future__ import annotations

import hashlib
import ipaddress
import hmac
import json
import logging
import uuid
import socket
from contextlib import closing
from datetime import timedelta
from typing import Any
from urllib.parse import urlparse

import httpx
import psycopg
from psycopg.types.json import Json

from app.core.time import utcnow
from app.db.session import get_conn

log = logging.getLogger("webhook_delivery")




def _validate_public_webhook_url(url: str) -> str:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("https", "http") or not parsed.hostname:
        raise ValueError("URL webhook invalide")
    if parsed.username or parsed.password:
        raise ValueError("URL webhook avec identifiants interdite")
    if parsed.scheme != "https":
        raise ValueError("Le webhook doit utiliser HTTPS")
    hostname = parsed.hostname
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise ValueError("Hôte webhook introuvable") from exc
    for addr in addresses:
        ip = ipaddress.ip_address(addr)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise ValueError("URL webhook vers une adresse interne interdite")
    return parsed.geturl()

def _sign_payload(secret: str, payload_bytes: bytes) -> str:
    return hmac.new(secret.encode(), payload_bytes, hashlib.sha256).hexdigest()


def register_webhook(user_id: str, url: str, events: list[str] | None = None) -> dict:
    url = _validate_public_webhook_url(url)
    ep_id = f"whe_{uuid.uuid4().hex[:16]}"
    secret = f"whs_{uuid.uuid4().hex}"
    ev = events or ["payment.success", "payment.failed"]
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO webhook_endpoints (id, user_id, url, secret, events, active, created_at)
               VALUES (%s, %s, %s, %s, %s, TRUE, %s)
               ON CONFLICT DO NOTHING""",
            (ep_id, user_id, url, secret, Json(ev), utcnow()),
        )
        conn.commit()
    return {"id": ep_id, "url": url, "secret": secret, "events": ev}


def get_webhook(user_id: str) -> dict | None:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT id, url, secret, events, active, created_at FROM webhook_endpoints WHERE user_id=%s AND active=TRUE ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return {
        "id":         row["id"],
        "url":        row["url"],
        "secret":     row["secret"],
        "events":     row["events"],
        "active":     row["active"],
        "created_at": row["created_at"].isoformat(),
    }


def delete_webhook(endpoint_id: str, user_id: str) -> bool:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE webhook_endpoints SET active=FALSE WHERE id=%s AND user_id=%s",
            (endpoint_id, user_id),
        )
        affected = cur.rowcount
        conn.commit()
    return affected > 0


async def dispatch(user_id: str, event_type: str, payload: dict[str, Any]) -> None:
    """Envoie le webhook au marchand. Appelé en tâche background."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT id, url, secret, events FROM webhook_endpoints WHERE user_id=%s AND active=TRUE ORDER BY created_at DESC LIMIT 1",
            (user_id,),
        )
        ep = cur.fetchone()
    if not ep:
        return

    subscribed = ep.get("events") or []
    if subscribed and event_type not in subscribed:
        return

    delivery_id = f"whd_{uuid.uuid4().hex[:16]}"
    full_payload = {"event": event_type, "data": payload, "delivery_id": delivery_id}
    body_bytes = json.dumps(full_payload, ensure_ascii=False).encode()
    signature = _sign_payload(ep["secret"], body_bytes)

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO webhook_deliveries (id, endpoint_id, event_type, payload, status, attempts, created_at)
               VALUES (%s, %s, %s, %s, 'pending', 0, %s)""",
            (delivery_id, ep["id"], event_type, Json(full_payload), utcnow()),
        )
        conn.commit()

    await _attempt_delivery(delivery_id, ep["id"], ep["url"], ep["secret"], body_bytes, signature)


async def _attempt_delivery(delivery_id: str, endpoint_id: str, url: str, secret: str, body: bytes, signature: str) -> None:
    now = utcnow()
    try:
        url = _validate_public_webhook_url(url)
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                url,
                content=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Kobo-Signature": signature,
                    "X-Kobo-Delivery": delivery_id,
                },
            )
        status = "delivered" if resp.status_code < 300 else "failed"
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE webhook_deliveries SET status=%s, response_code=%s, attempts=attempts+1 WHERE id=%s",
                (status, resp.status_code, delivery_id),
            )
            conn.commit()
        log.info("Webhook %s → %s HTTP %s", delivery_id, url, resp.status_code)
    except Exception as exc:
        log.warning("Webhook delivery failed %s: %s", delivery_id, exc)
        next_retry = now + timedelta(minutes=5)
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE webhook_deliveries SET status='failed', attempts=attempts+1, next_retry_at=%s WHERE id=%s",
                (next_retry, delivery_id),
            )
            conn.commit()
