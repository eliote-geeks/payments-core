
import uuid
from contextlib import closing
from datetime import timedelta
from decimal import Decimal

import psycopg
from fastapi import APIRouter, HTTPException
from psycopg.types.json import Json

from app.core.config import settings
from app.core.serialization import json_ready
from app.core.time import utcnow
from app.db.session import get_conn
from app.models.schemas import QuoteRequest
from app.services.pricing import (
    calculate_quote_amounts,
    get_live_fx_rate,
    get_pricing_rule,
    quantize_money,
)
from app.services.serializers import serialize_quote

router = APIRouter(tags=["quotes"])


@router.post("/quotes")
async def create_quote(request: QuoteRequest) -> dict:
    pricing_rule = get_pricing_rule(request)
    fx_rate, provider, pricing_timestamp = await get_live_fx_rate(
        request.source_currency, request.target_currency
    )
    source_amount = Decimal(str(request.source_amount))
    amounts = calculate_quote_amounts(source_amount, pricing_rule, fx_rate)
    quote_id = f"qt_{uuid.uuid4().hex[:16]}"
    expires_at = utcnow() + timedelta(minutes=settings.quote_ttl_minutes)
    metadata = {
        "pricing_rule": pricing_rule,
        "fee_breakdown": {
            "fixed_fee": float(amounts["fixed_fee"]),
            "variable_fee": float(quantize_money(amounts["variable_fee"])),
            "min_fee": float(amounts["min_fee"]),
        },
    }
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO quotes (
                id, source_currency, target_currency, source_amount, fees_amount, fx_rate,
                target_amount, destination_country, payout_method, pricing_provider,
                pricing_timestamp, expires_at, metadata
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                quote_id,
                request.source_currency,
                request.target_currency,
                source_amount,
                amounts["fees"],
                fx_rate,
                amounts["target_amount"],
                request.destination_country,
                request.payout_method,
                provider,
                pricing_timestamp,
                expires_at,
                Json(json_ready(metadata)),
            ),
        )
        row = cur.fetchone()
        conn.commit()
    return serialize_quote(row)


@router.get("/quotes/{quote_id}")
async def get_quote(quote_id: str) -> dict:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM quotes WHERE id = %s", (quote_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Quote not found")
    return serialize_quote(row)
