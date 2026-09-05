from __future__ import annotations

import uuid
from contextlib import closing
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from app.db.session import get_conn

# Identifiant système du compte de revenus Kobo (pas un vrai user, juste un wallet interne)
KOBO_PLATFORM_ACCOUNT = "sys_kobo_platform"

_DEFAULTS: dict[str, Any] = {
    "p2p_transfer":             {"type": "percent", "rate": 1.5,     "min_fcfa": 100, "min_amount_fcfa": 100},
    "mobile_money_withdrawal":  {"type": "percent", "rate": 1.5,     "min_fcfa": 100, "min_amount_fcfa": 500},
    "mobile_money_bridge":      {"type": "percent", "rate": 0.0,     "min_fcfa": 0, "min_amount_fcfa": 100},
    "bank_withdrawal_eur":      {"type": "flat",    "amount": 5,     "currency": "EUR", "min_amount_fcfa": 500},
    "bank_withdrawal_usd":      {"type": "flat",    "amount": 5,     "currency": "USD", "min_amount_fcfa": 500},
    "bank_withdrawal_fcfa":     {"type": "percent", "rate": 2.0,     "min_fcfa": 500, "min_amount_fcfa": 500},
    "fiat_deposit":             {"type": "percent", "rate": 0.0,     "min_fcfa": 0, "min_amount_fcfa": 100},
    "mobile_money_deposit":     {"type": "percent", "rate": 0.0,     "min_fcfa": 0, "min_amount_fcfa": 100},
    "crypto_deposit_usdt":      {"type": "percent", "rate": 0.0,     "min_fcfa": 0, "min_amount_fcfa": 100},
    "crypto_deposit_btc":       {"type": "percent", "rate": 0.0,     "min_fcfa": 0, "min_amount_fcfa": 100},
    "crypto_withdrawal_usdt":   {"type": "flat",    "amount": 1,     "currency": "USDT", "min_amount_fcfa": 100},
    "crypto_withdrawal_btc":    {"type": "flat",    "amount": 0.00005,"currency": "BTC", "min_amount_fcfa": 100},
    "intl_transfer_spread":     {"type": "percent", "rate": 2.5,     "min_fcfa": 0, "min_amount_fcfa": 100},
    "api_payment":              {"type": "percent", "rate": 5.0,     "min_fcfa": 0, "min_amount_fcfa": 100},
    "payment_link":             {"type": "percent", "rate": 1.5,     "min_fcfa": 0, "min_amount_fcfa": 100},
}


def _load_stored() -> dict[str, Any]:
    try:
        import psycopg
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT value FROM app_settings WHERE key = 'fees' LIMIT 1")
            row = cur.fetchone()
        return row["value"] if row else {}
    except Exception:
        return {}


def get_fee_config(category: str) -> dict[str, Any]:
    """Retourne la config de frais active (DB > défaut) pour une catégorie."""
    stored = _load_stored()
    cfg = {**_DEFAULTS.get(category, {})}
    if category in stored:
        cfg.update(stored[category])
    return cfg


def get_min_amount_fcfa(category: str, default: Decimal | int | str = 0) -> Decimal:
    """
    Retourne le montant minimum de transaction configuré.

    `min_fcfa` est historiquement le frais minimum. Le montant minimum
    transactionnel doit être stocké dans `min_amount_fcfa` ou
    `min_transaction_fcfa`. Si l'ancien dashboard a enregistré
    `min_fcfa` en pensant configurer le montant minimum, on l'accepte en
    fallback pour éviter que la config admin soit ignorée.
    """
    cfg = get_fee_config(category)
    for key in ("min_amount_fcfa", "min_transaction_fcfa"):
        if key in cfg:
            return Decimal(str(cfg.get(key) or 0))
    if "min_fcfa" in cfg:
        return Decimal(str(cfg.get("min_fcfa") or 0))
    return Decimal(str(default))


def calculate_fee_fcfa(category: str, amount_fcfa: Decimal) -> Decimal:
    """
    Calcule les frais en FCFA pour une opération.
    Les frais flat en devise étrangère (EUR/USD/BTC/USDT) sont ignorés ici
    car ces opérations gèrent leur propre conversion — retourne 0.
    """
    cfg = get_fee_config(category)
    if not cfg:
        return Decimal("0")

    fee_type = cfg.get("type", "percent")

    if fee_type == "percent":
        rate = Decimal(str(cfg.get("rate", 0)))
        if rate == 0:
            return Decimal("0")
        min_fcfa = Decimal(str(cfg.get("min_fcfa", 0)))
        fee = (amount_fcfa * rate / Decimal("100")).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
        return max(fee, min_fcfa)

    # flat en devise étrangère — géré par les routers concernés
    return Decimal("0")


def credit_platform_fee(fee_fcfa: Decimal, source: str, ref: str) -> None:
    """Crédite les frais sur le compte interne Kobo. Ne lève jamais d'exception."""
    if fee_fcfa <= 0:
        return
    try:
        import psycopg
        from psycopg.types.json import Json
        from app.core.time import utcnow

        now = utcnow()
        tx_id = f"fee_{uuid.uuid4().hex[:16]}"
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                """INSERT INTO wallet_accounts (user_id, currency, balance, updated_at)
                   VALUES (%s, 'FCFA', %s, %s)
                   ON CONFLICT (user_id, currency)
                   DO UPDATE SET balance = wallet_accounts.balance + EXCLUDED.balance,
                                 updated_at = EXCLUDED.updated_at""",
                (KOBO_PLATFORM_ACCOUNT, fee_fcfa, now),
            )
            cur.execute(
                """INSERT INTO wallet_transactions
                   (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
                   VALUES (%s, %s, 'credit', 'platform_fee', %s, 'Kobo Platform', %s, 'FCFA', 'completed', %s, %s)""",
                (tx_id, KOBO_PLATFORM_ACCOUNT,
                 f"Frais {source}",
                 fee_fcfa,
                 Json({"source": source, "ref": ref}),
                 now),
            )
            conn.commit()
    except Exception:
        pass  # ne jamais bloquer la transaction principale


def calculate_fee_flat(category: str) -> tuple[Decimal, str]:
    """
    Retourne (montant_flat, devise) pour les frais fixes en devises.
    Utilisé pour les retraits bancaires EUR/USD et les retraits crypto.
    """
    cfg = get_fee_config(category)
    if cfg.get("type") == "flat":
        return Decimal(str(cfg.get("amount", 0))), cfg.get("currency", "FCFA")
    return Decimal("0"), "FCFA"
