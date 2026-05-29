from __future__ import annotations

import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import httpx

from app.core.config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ── Commissions (spread appliqué sur le taux marché) ─────────────────────────
# Taux client affiché = taux marché × (1 - spread)
# Ex : EUR/FCFA marché 655.96 → client 646.27 avec spread 1.5 %
SPREAD_PCT: dict[str, float] = {
    "EUR":  0.015,   # 1.5 % — compétitif vs banques (2–4 %), au-dessus de Wave (1 %)
    "USD":  0.015,   # 1.5 %
    "USDT": 0.012,   # 1.2 % — stablecoin = faible volatilité, spread réduit
    "BTC":  0.020,   # 2.0 % — volatilité crypto justifie la marge supérieure
}

DEFAULT_RATES: dict[tuple[str, str], Decimal] = {
    ("EUR", "XAF"): Decimal("655.957"),
    ("USD", "XAF"): Decimal("612.4"),
}

# Cache TTL pour calculer la variation de taux
# À expiration, on compare l'ancien taux au nouveau → change %
SNAPSHOT_TTL = 300  # 5 minutes

_snapshot: dict[str, tuple[float, float]] = {}  # base → (client_rate, timestamp)


async def _fetch_fx(base: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        r = await client.get(f"{settings.fx_api_base_url}/{base}")
        r.raise_for_status()
        return r.json()


async def _get_fiat_rate(base: str, quote: str) -> Decimal:
    try:
        data = await _fetch_fx(base)
        v = data.get("rates", {}).get(quote)
        if v is None:
            raise ValueError("rate not found")
        return Decimal(str(v))
    except Exception:
        return DEFAULT_RATES.get((base, quote), Decimal("1"))


async def _fetch_btc_usd() -> Decimal:
    """Fetch live BTC/USD from CoinGecko free tier."""
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": "bitcoin", "vs_currencies": "usd"},
            )
            r.raise_for_status()
            return Decimal(str(r.json()["bitcoin"]["usd"]))
    except Exception:
        return Decimal("68000")


def _apply_spread(market_rate: float, base: str) -> float:
    spread = SPREAD_PCT.get(base, 0.015)
    return round(market_rate * (1.0 - spread), 6)


def _compute_change(base: str, current: float) -> float:
    """Compare current client rate to snapshot; refresh snapshot when TTL expires."""
    now = time.time()
    if base in _snapshot:
        prev_rate, ts = _snapshot[base]
        if now - ts >= SNAPSHOT_TTL:
            _snapshot[base] = (current, now)
            if prev_rate > 0:
                return round((current - prev_rate) / prev_rate * 100, 2)
        elif prev_rate > 0:
            return round((current - prev_rate) / prev_rate * 100, 2)
    else:
        _snapshot[base] = (current, now)
    return 0.0


async def list_rates() -> list[dict[str, Any]]:
    eur_xaf  = await _get_fiat_rate("EUR", "XAF")
    usd_xaf  = await _get_fiat_rate("USD", "XAF")
    btc_usd  = await _fetch_btc_usd()
    btc_xaf  = btc_usd * usd_xaf
    usdt_xaf = usd_xaf  # USDT ≈ USD

    market: dict[str, float] = {
        "EUR":  float(eur_xaf),
        "USD":  float(usd_xaf),
        "BTC":  float(btc_xaf),
        "USDT": float(usdt_xaf),
    }

    items = []
    for base, label in [
        ("EUR",  "EUR/FCFA"),
        ("USD",  "USD/FCFA"),
        ("BTC",  "BTC/FCFA"),
        ("USDT", "USDT/FCFA"),
    ]:
        client_rate = _apply_spread(market[base], base)
        change      = _compute_change(base, client_rate)
        items.append({
            "pair":        label,
            "rate":        client_rate,
            "market_rate": round(market[base], 4),
            "spread_pct":  SPREAD_PCT.get(base, 0.015) * 100,
            "change":      change,
        })

    return items
