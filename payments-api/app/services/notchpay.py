from __future__ import annotations

import hashlib
import hmac

import httpx

from app.core.config import settings

NOTCHPAY_API = "https://api.notchpay.co"

CHANNEL_MAP = {
    "mtn": "cm.mtn",
    "orange": "cm.orange",
}


async def initiate_transfer(
    *,
    reference: str,
    amount: int,
    phone: str,
    provider: str,
    description: str = "Retrait Kobo",
) -> dict:
    """Initiate a Mobile Money payout via NotchPay. Returns NotchPay response."""
    channel = CHANNEL_MAP.get(provider.lower())
    if not channel:
        raise ValueError(f"Provider non supporté: {provider}")

    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            f"{NOTCHPAY_API}/transfers",
            json={
                "amount": amount,
                "currency": "XAF",
                "channel": channel,
                "beneficiary": {"phone": phone, "name": "Kobo User"},
                "reference": reference,
                "description": description,
            },
            headers={
                "Authorization": settings.notchpay_public_key,
                "X-Grant": settings.notchpay_private_key,
                "Content-Type": "application/json",
            },
        )

    data = resp.json()
    if resp.status_code not in (200, 201, 202):
        msg = (
            data.get("message")
            or data.get("error")
            or f"NotchPay HTTP {resp.status_code}"
        )
        raise RuntimeError(msg)
    return data


def verify_webhook_signature(payload: bytes, signature: str) -> bool:
    """Verify NotchPay webhook HMAC-SHA256 signature."""
    if not settings.notchpay_hash_key:
        return True  # skip verification in dev if key not set
    expected = hmac.new(
        settings.notchpay_hash_key.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
