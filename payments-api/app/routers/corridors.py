
from contextlib import closing

import psycopg
from fastapi import APIRouter

from app.db.session import get_conn

router = APIRouter(tags=["corridors"])


@router.get("/corridors")
async def corridors() -> dict:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT source_currency, target_currency, destination_country, payout_method,
                   fixed_fee, variable_fee_bps, min_fee
            FROM pricing_rules
            WHERE active = TRUE
            ORDER BY source_currency, target_currency, destination_country, payout_method
            """
        )
        rows = cur.fetchall()
    return {"corridors": rows}
