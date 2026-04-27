
from contextlib import closing

from app.db.session import get_conn


def init_db() -> None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS pricing_rules (
                id BIGSERIAL PRIMARY KEY,
                source_currency TEXT NOT NULL,
                target_currency TEXT NOT NULL,
                destination_country TEXT NOT NULL,
                payout_method TEXT NOT NULL,
                fixed_fee NUMERIC(18, 6) NOT NULL,
                variable_fee_bps INTEGER NOT NULL,
                min_fee NUMERIC(18, 6) NOT NULL,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (source_currency, target_currency, destination_country, payout_method)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS quotes (
                id TEXT PRIMARY KEY,
                source_currency TEXT NOT NULL,
                target_currency TEXT NOT NULL,
                source_amount NUMERIC(18, 6) NOT NULL,
                fees_amount NUMERIC(18, 6) NOT NULL,
                fx_rate NUMERIC(18, 10) NOT NULL,
                target_amount NUMERIC(18, 6) NOT NULL,
                destination_country TEXT NOT NULL,
                payout_method TEXT NOT NULL,
                pricing_provider TEXT NOT NULL,
                pricing_timestamp TIMESTAMPTZ NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS transfers (
                id TEXT PRIMARY KEY,
                quote_id TEXT NOT NULL REFERENCES quotes(id),
                source_currency TEXT NOT NULL,
                target_currency TEXT NOT NULL,
                source_amount NUMERIC(18, 6) NOT NULL,
                target_amount NUMERIC(18, 6) NOT NULL,
                fees_amount NUMERIC(18, 6) NOT NULL,
                sender JSONB NOT NULL,
                recipient JSONB NOT NULL,
                funding_method TEXT NOT NULL,
                payment_status TEXT NOT NULL,
                settlement_status TEXT NOT NULL,
                status TEXT NOT NULL,
                orchestration JSONB NOT NULL DEFAULT '[]'::jsonb,
                dependencies JSONB NOT NULL DEFAULT '{}'::jsonb,
                funding_reference TEXT,
                settlement_reference TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS webhook_events (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                event_type TEXT NOT NULL,
                transfer_id TEXT,
                payload JSONB NOT NULL,
                received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            INSERT INTO pricing_rules (
                source_currency, target_currency, destination_country, payout_method,
                fixed_fee, variable_fee_bps, min_fee, active
            ) VALUES
                ('EUR', 'XAF', 'CM', 'mobile_money', 1.20, 120, 2.50, TRUE),
                ('USD', 'XAF', 'CM', 'mobile_money', 1.50, 145, 2.90, TRUE),
                ('GBP', 'XAF', 'CM', 'mobile_money', 1.70, 150, 3.20, TRUE),
                ('CAD', 'XAF', 'CM', 'mobile_money', 1.60, 145, 3.00, TRUE),
                ('EUR', 'XAF', 'CM', 'bank', 1.80, 95, 3.20, TRUE),
                ('USD', 'XAF', 'CM', 'bank', 2.10, 115, 3.60, TRUE),
                ('XAF', 'EUR', 'FR', 'bank', 1500, 140, 2500, TRUE),
                ('XAF', 'USD', 'US', 'bank', 1500, 160, 2500, TRUE)
            ON CONFLICT (source_currency, target_currency, destination_country, payout_method)
            DO NOTHING
            """
        )
        conn.commit()
