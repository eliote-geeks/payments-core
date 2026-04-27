from contextlib import closing
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import psycopg
from app.core.config import settings
from app.core.time import utcnow
from app.db.session import get_conn
from app.models.schemas import QuoteRequest
from app.services.dependencies import fetch_json
from fastapi import HTTPException


def quantize_money(value: Decimal, digits: str = "0.01") -> Decimal:
    return value.quantize(Decimal(digits), rounding=ROUND_HALF_UP)


async def get_live_fx_rate(
    source_currency: str, target_currency: str
) -> tuple[Decimal, str, datetime]:
    provider = "open.er-api.com"
    timestamp = utcnow()
    try:
        data = await fetch_json(f"{settings.fx_api_base_url}/{source_currency}")
        rates = data.get("rates", {})
        rate_value = rates.get(target_currency)
        if rate_value is None:
            raise ValueError(f"No FX rate from {source_currency} to {target_currency}")
        provider = data.get("provider", provider)
        update_utc = data.get("time_last_update_utc")
        if update_utc:
            try:
                timestamp = datetime.strptime(update_utc, "%a, %d %b %Y %H:%M:%S %z")
            except ValueError:
                timestamp = utcnow()
        return Decimal(str(rate_value)), provider, timestamp
    except Exception:
        fallback_rates = {
            ("EUR", "XAF"): Decimal("655.957"),
            ("USD", "XAF"): Decimal("566.598367"),
            ("GBP", "XAF"): Decimal("760.00"),
            ("CAD", "XAF"): Decimal("415.00"),
            ("XAF", "EUR"): Decimal("0.00152449"),
            ("XAF", "USD"): Decimal("0.00176492"),
        }
        fallback_key = (source_currency, target_currency)
        if fallback_key not in fallback_rates:
            raise
        return fallback_rates[fallback_key], f"{provider}:fallback", utcnow()


def get_pricing_rule(request: QuoteRequest) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT source_currency, target_currency, destination_country, payout_method,
                   fixed_fee, variable_fee_bps, min_fee
            FROM pricing_rules
            WHERE source_currency = %s
              AND target_currency = %s
              AND destination_country = %s
              AND payout_method = %s
              AND active = TRUE
            """,
            (
                request.source_currency,
                request.target_currency,
                request.destination_country,
                request.payout_method,
            ),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(
            status_code=404,
            detail="No pricing rule found for this corridor and payout method",
        )
    return row


def calculate_quote_amounts(
    source_amount: Decimal, pricing_rule: dict[str, Any], fx_rate: Decimal
) -> dict[str, Decimal]:
    fixed_fee = Decimal(str(pricing_rule["fixed_fee"]))
    variable_fee = (source_amount * Decimal(pricing_rule["variable_fee_bps"])) / Decimal("10000")
    min_fee = Decimal(str(pricing_rule["min_fee"]))
    fees = quantize_money(max(min_fee, fixed_fee + variable_fee))
    target_amount = quantize_money((source_amount - fees) * fx_rate, "0.000001")
    if target_amount <= 0:
        raise HTTPException(status_code=400, detail="Amount is too small after fees")
    return {
        "fixed_fee": fixed_fee,
        "variable_fee": variable_fee,
        "min_fee": min_fee,
        "fees": fees,
        "target_amount": target_amount,
    }
