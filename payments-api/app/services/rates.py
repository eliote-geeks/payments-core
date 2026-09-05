from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import httpx

from app.core.config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


DEFAULT_RATES: dict[tuple[str, str], Decimal] = {
    ("EUR", "XAF"): Decimal("655.957"),
    ("USD", "XAF"): Decimal("612.4"),
}


async def fetch_fx_rates(base: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        r = await client.get(f"{settings.fx_api_base_url}/{base}")
        r.raise_for_status()
        return r.json()


async def get_rate(pair: tuple[str, str]) -> Decimal:
    base, quote = pair
    try:
        data = await fetch_fx_rates(base)
        rates = data.get("rates", {})
        v = rates.get(quote)
        if v is None:
            raise ValueError("missing")
        return Decimal(str(v))
    except Exception:
        if pair in DEFAULT_RATES:
            return DEFAULT_RATES[pair]
        raise


async def list_rates() -> list[dict[str, Any]]:
    # MVP: only the pairs the UI shows today.
    eur_xaf = await get_rate(("EUR", "XAF"))
    usd_xaf = await get_rate(("USD", "XAF"))
    # crypto is placeholder for now; will be replaced by market data source.
    btc_xaf = Decimal("42150000")
    usdt_xaf = usd_xaf
    return [
        {"pair": "EUR/FCFA", "rate": float(eur_xaf), "change": 0.0},
        {"pair": "USD/FCFA", "rate": float(usd_xaf), "change": 0.0},
        {"pair": "BTC/FCFA", "rate": float(btc_xaf), "change": 0.0},
        {"pair": "USDT/FCFA", "rate": float(usdt_xaf), "change": 0.0},
    ]

