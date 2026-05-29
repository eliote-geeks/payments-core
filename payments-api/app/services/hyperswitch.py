from __future__ import annotations

from decimal import Decimal
from typing import Any

import httpx

from app.core.config import settings

# Minor-unit multipliers per currency (Hyperswitch requires integer amounts)
_MINOR: dict[str, int] = {
    "EUR": 100,
    "USD": 100,
    "GBP": 100,
    "CAD": 100,
    "XAF": 1,
    "USDT": 100,
    "BTC": 100_000_000,
}


def to_minor_units(amount: Decimal, currency: str) -> int:
    return int(amount * _MINOR.get(currency.upper(), 100))


def _headers() -> dict[str, str]:
    return {"api-key": settings.hyperswitch_api_key, "Content-Type": "application/json"}


async def create_payment_intent(
    *,
    amount: Decimal,
    currency: str,
    transfer_id: str,
    description: str = "",
) -> dict[str, Any]:
    payload = {
        "amount": to_minor_units(amount, currency),
        "currency": currency.upper(),
        "capture_method": "automatic",
        "description": description or f"Transfer {transfer_id}",
        "metadata": {"transfer_id": transfer_id},
        "statement_descriptor_name": "Payments Core",
    }
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        resp = await client.post(
            f"{settings.hyperswitch_base_url}/payments",
            json=payload,
            headers=_headers(),
        )
        resp.raise_for_status()
    return resp.json()


async def cancel_payment(payment_id: str, reason: str = "customer_request") -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        resp = await client.post(
            f"{settings.hyperswitch_base_url}/payments/{payment_id}/cancel",
            json={"cancellation_reason": reason},
            headers=_headers(),
        )
        resp.raise_for_status()
    return resp.json()


async def get_payment(payment_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        resp = await client.get(
            f"{settings.hyperswitch_base_url}/payments/{payment_id}",
            headers=_headers(),
        )
        resp.raise_for_status()
    return resp.json()
