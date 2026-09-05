
from contextlib import closing

import psycopg
from fastapi import APIRouter

from app.db.session import get_conn

router = APIRouter(tags=["corridors"])


@router.get("/crypto-wallets")
async def public_crypto_wallets() -> dict:
    """Retourne les portefeuilles crypto actifs (adresses de réception publiques)."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT network, address, label FROM crypto_wallets WHERE active = TRUE ORDER BY network"
        )
        rows = cur.fetchall() or []
    return {"wallets": [{"network": r["network"], "address": r["address"], "label": r.get("label") or ""} for r in rows]}


@router.get("/payment-instructions")
async def payment_instructions() -> dict:
    """Retourne les coordonnées de paiement Kobo (banque + crypto) pour le frontend."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT key, value FROM app_settings WHERE key IN ('kobo_bank')")
        settings = {r["key"]: r["value"] for r in (cur.fetchall() or [])}
        cur.execute("SELECT network, address, label FROM crypto_wallets WHERE active = TRUE ORDER BY network")
        wallets = cur.fetchall() or []
    return {
        "bank": settings.get("kobo_bank") or {},
        "crypto_wallets": [{"network": w["network"], "address": w["address"], "label": w.get("label") or ""} for w in wallets],
    }


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
