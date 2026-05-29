
from contextlib import closing

from app.db.session import get_conn


def init_db() -> None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                phone_e164 TEXT NOT NULL UNIQUE,
                profile JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS otp_challenges (
                id TEXT PRIMARY KEY,
                phone_e164 TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                consumed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS wallet_accounts (
                user_id TEXT NOT NULL REFERENCES users(id),
                currency TEXT NOT NULL,
                balance NUMERIC(18, 6) NOT NULL DEFAULT 0,
                address TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (user_id, currency)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                direction TEXT NOT NULL,
                category TEXT NOT NULL,
                label TEXT NOT NULL,
                counterpart TEXT NOT NULL,
                amount NUMERIC(18, 6) NOT NULL,
                currency TEXT NOT NULL,
                status TEXT NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS idempotency_keys (
                idempotency_key TEXT NOT NULL,
                user_id TEXT NOT NULL REFERENCES users(id),
                request_hash TEXT NOT NULL,
                status_code INTEGER NOT NULL,
                response_body JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (idempotency_key, user_id)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS kyc_profiles (
                user_id TEXT PRIMARY KEY REFERENCES users(id),
                level INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'unverified',
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS kyc_documents (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                doc_key TEXT NOT NULL,
                status TEXT NOT NULL,
                reason TEXT,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                file_name TEXT,
                content_type TEXT,
                content BYTEA,
                size_bytes INTEGER,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (user_id, doc_key)
            )
            """
        )
        # Safe schema evolution for existing clusters.
        cur.execute("ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS file_name TEXT")
        cur.execute("ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS content_type TEXT")
        cur.execute("ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS content BYTEA")
        cur.execute("ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS size_bytes INTEGER")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS support_tickets (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                subject TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'open',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS support_messages (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                from_role TEXT NOT NULL,
                author_name TEXT,
                body TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS support_faq (
                key TEXT PRIMARY KEY,
                q_fr TEXT NOT NULL,
                a_fr TEXT NOT NULL,
                q_en TEXT NOT NULL,
                a_en TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger_entries (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                currency TEXT NOT NULL,
                amount NUMERIC(18, 6) NOT NULL,
                sender_user_id TEXT REFERENCES users(id),
                recipient_user_id TEXT REFERENCES users(id),
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS p2p_transfers (
                id TEXT PRIMARY KEY,
                ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
                sender_user_id TEXT NOT NULL REFERENCES users(id),
                recipient_user_id TEXT NOT NULL REFERENCES users(id),
                amount NUMERIC(18, 6) NOT NULL,
                currency TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )

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
