
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
                PRIMARY KEY (user_id, currency),
                CONSTRAINT wallet_balance_nonnegative CHECK (balance >= 0)
            )
            """
        )
        cur.execute(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'wallet_balance_nonnegative'
                      AND conrelid = 'wallet_accounts'::regclass
                ) THEN
                    ALTER TABLE wallet_accounts
                    ADD CONSTRAINT wallet_balance_nonnegative CHECK (balance >= 0);
                END IF;
            END $$
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
        # Safe evolution: add processing columns to webhook_events
        cur.execute(
            "ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ"
        )
        cur.execute(
            "ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS processing_error TEXT"
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS trusted_devices (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                ip_address TEXT,
                fingerprint TEXT,
                last_seen_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("ALTER TABLE trusted_devices ADD COLUMN IF NOT EXISTS ip_address TEXT")

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



        # Adresses wallet Kobo pour dépôts crypto
        cur.execute("""
            CREATE TABLE IF NOT EXISTS crypto_wallets (
                id TEXT PRIMARY KEY,
                network TEXT NOT NULL UNIQUE,
                address TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                explorer_url_prefix TEXT NOT NULL DEFAULT '',
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Insérer l'adresse TRC20 par défaut si la table est vide
        cur.execute("""
            INSERT INTO crypto_wallets (id, network, address, label, explorer_url_prefix, active)
            VALUES ('cw_trc20_default', 'TRC20', 'TQrZ9wBfXk8H2YpNmLkRsJv4cQxAeBcDfG', 'USDT TRC20', 'https://tronscan.org/#/transaction/', TRUE)
            ON CONFLICT (network) DO NOTHING
        """)

        # Safe evolution: crypto withdrawals table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS crypto_withdrawals (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                amount_xaf NUMERIC(18,2) NOT NULL,
                amount_usdt NUMERIC(18,6) NOT NULL,
                network TEXT NOT NULL DEFAULT 'TRC20',
                destination_address TEXT NOT NULL,
                tx_hash TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                note TEXT NOT NULL DEFAULT '',
                reject_reason TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        # Safe evolution: email columns for OTP-by-email
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email) WHERE email IS NOT NULL")
        cur.execute("ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS email TEXT")
        cur.execute("ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS verification_token_hash TEXT")
        cur.execute("ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS verification_used_at TIMESTAMPTZ")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS payment_authorizations (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                link_id TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_payment_authorizations_lookup "
            "ON payment_authorizations(user_id, link_id, expires_at)"
        )

        # Internal system account for platform fee revenue — must satisfy FK on wallet_accounts/wallet_transactions
        cur.execute(
            """
            INSERT INTO users (id, phone_e164, profile)
            VALUES ('sys_kobo_platform', 'sys_kobo_platform', '{"fullName": "Kobo Platform", "system": true}'::jsonb)
            ON CONFLICT (id) DO NOTHING
            """
        )
        conn.commit()


def init_fiat_deposits_schema() -> None:
    """Migration pour les dépôts fiat (mobile money + virement bancaire)."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS fiat_deposits (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                currency TEXT NOT NULL,
                amount NUMERIC(18,2) NOT NULL,
                method TEXT NOT NULL,           -- 'mobile_money' | 'bank_transfer'
                provider TEXT,                  -- 'mtn' | 'orange' | NULL (bank)
                phone TEXT,                     -- for mobile money
                reference TEXT,                 -- NotchPay reference or bank ref
                status TEXT NOT NULL DEFAULT 'pending',
                notchpay_txid TEXT,
                note TEXT NOT NULL DEFAULT '',
                reject_reason TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS fiat_deposits_ref_idx ON fiat_deposits(reference) WHERE reference IS NOT NULL")
        cur.execute("CREATE INDEX IF NOT EXISTS fiat_deposits_user_idx ON fiat_deposits(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS fiat_deposits_status_idx ON fiat_deposits(status)")
        # Safe evolution: add sender_iban for bank transfer identity verification
        cur.execute("ALTER TABLE fiat_deposits ADD COLUMN IF NOT EXISTS sender_iban TEXT")
        cur.execute("ALTER TABLE fiat_deposits ADD COLUMN IF NOT EXISTS sender_name TEXT")
        cur.execute("ALTER TABLE fiat_deposits ADD COLUMN IF NOT EXISTS fee NUMERIC(18,2) NOT NULL DEFAULT 0")

        # app_settings table (for IBAN etc.)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)

        # Fiat withdrawals (EUR/USD/FCFA via virement ou mobile money)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS fiat_withdrawals (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                currency TEXT NOT NULL,
                amount NUMERIC(18,2) NOT NULL,
                method TEXT NOT NULL DEFAULT 'bank_transfer',
                recipient_iban TEXT,
                recipient_name TEXT NOT NULL,
                recipient_phone TEXT,
                provider TEXT,
                reference TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                reject_reason TEXT,
                note TEXT NOT NULL DEFAULT '',
                kyc_level_at_request INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS fiat_withdrawals_user_idx ON fiat_withdrawals(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS fiat_withdrawals_status_idx ON fiat_withdrawals(status)")
        cur.execute("ALTER TABLE fiat_withdrawals ADD COLUMN IF NOT EXISTS fee_fcfa NUMERIC(18,2) NOT NULL DEFAULT 0")
        cur.execute("ALTER TABLE fiat_withdrawals ADD COLUMN IF NOT EXISTS total_debit NUMERIC(18,2) NOT NULL DEFAULT 0")
        cur.execute("ALTER TABLE fiat_withdrawals ADD COLUMN IF NOT EXISTS notchpay_txid TEXT")

        # Historique des retraits admin sur le compte de revenus de la plateforme
        cur.execute("""
            CREATE TABLE IF NOT EXISTS platform_withdrawals (
                id TEXT PRIMARY KEY,
                amount NUMERIC(18,2) NOT NULL,
                method TEXT NOT NULL,
                destination TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'completed',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.commit()


def init_crypto_schema() -> None:
    """Migration pour les dépôts crypto manuels."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            '''
            CREATE TABLE IF NOT EXISTS crypto_deposits (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                amount_xaf NUMERIC(18,2) NOT NULL,
                amount_usdt NUMERIC(18,6) NOT NULL,
                network TEXT NOT NULL DEFAULT \'TRC20\',
                wallet_address TEXT NOT NULL,
                tx_hash TEXT,
                status TEXT NOT NULL DEFAULT \'pending\',
                note TEXT NOT NULL DEFAULT \'\',
                reject_reason TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            '''
        )
        cur.execute(
            'CREATE UNIQUE INDEX IF NOT EXISTS crypto_deposits_tx_hash_idx ON crypto_deposits(tx_hash) WHERE tx_hash IS NOT NULL'
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS crypto_chain_events (
                id TEXT PRIMARY KEY,
                network TEXT NOT NULL DEFAULT 'TRC20',
                contract_address TEXT NOT NULL DEFAULT '',
                tx_hash TEXT NOT NULL UNIQUE,
                from_address TEXT NOT NULL DEFAULT '',
                to_address TEXT NOT NULL DEFAULT '',
                amount_usdt NUMERIC(18,6) NOT NULL DEFAULT 0,
                block_ts_ms BIGINT NOT NULL DEFAULT 0,
                confirmations INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'detected',
                match_type TEXT NOT NULL DEFAULT '',
                matched_table TEXT NOT NULL DEFAULT '',
                matched_id TEXT NOT NULL DEFAULT '',
                reason TEXT NOT NULL DEFAULT '',
                raw JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS crypto_chain_events_status_idx ON crypto_chain_events(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS crypto_chain_events_to_idx ON crypto_chain_events(to_address)")
        cur.execute("CREATE INDEX IF NOT EXISTS crypto_chain_events_created_idx ON crypto_chain_events(created_at DESC)")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS crypto_scan_runs (
                id TEXT PRIMARY KEY,
                network TEXT NOT NULL DEFAULT 'TRC20',
                wallet_address TEXT NOT NULL,
                status TEXT NOT NULL,
                checked INTEGER NOT NULL DEFAULT 0,
                matched INTEGER NOT NULL DEFAULT 0,
                credited INTEGER NOT NULL DEFAULT 0,
                failed INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS crypto_scan_runs_wallet_created_idx ON crypto_scan_runs(wallet_address, created_at DESC)")

        # Admin sessions (OTP-based admin auth)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_sessions (
                token TEXT PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                revoked BOOLEAN NOT NULL DEFAULT FALSE
            )
            """
        )

        # Block flag on users
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE")

        # Sessions (active login sessions — replaces trusted_devices)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                jti TEXT UNIQUE NOT NULL,
                device_name TEXT,
                ip_address TEXT,
                device_fingerprint_hash TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                revoked BOOLEAN NOT NULL DEFAULT FALSE
            )
            """
        )
        cur.execute("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_fingerprint_hash TEXT")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_jti ON sessions(jti)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_device_fingerprint ON sessions(device_fingerprint_hash)")

        # Notifications
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                read BOOLEAN NOT NULL DEFAULT FALSE,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)")

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS fraud_events (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                recipient_id TEXT,
                amount NUMERIC NOT NULL,
                risk_score INTEGER NOT NULL,
                action TEXT NOT NULL,
                rules_triggered TEXT[] NOT NULL DEFAULT '{}',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_fraud_events_user_id ON fraud_events(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_fraud_events_created_at ON fraud_events(created_at DESC)")

        # Add blocked column to users if not exists
        cur.execute(
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE"
        )

        # Add verification columns to crypto_deposits
        cur.execute(
            "ALTER TABLE crypto_deposits ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT NULL"
        )
        cur.execute(
            "ALTER TABLE crypto_deposits ADD COLUMN IF NOT EXISTS verification_confirmations INTEGER DEFAULT NULL"
        )

        # Recovery codes for account recovery without email access
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS recovery_codes (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                code_hash TEXT NOT NULL,
                used_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id)")

        # Admin sessions
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT")
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_phone TEXT")
        cur.execute("ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS email TEXT")

        # Fraud cron scan results
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS fraud_scan_results (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                scan_run_id TEXT NOT NULL,
                risk_score INTEGER NOT NULL,
                action TEXT NOT NULL,          -- 'flag' | 'review' | 'auto_block'
                signals JSONB NOT NULL DEFAULT '[]',
                auto_blocked BOOLEAN NOT NULL DEFAULT FALSE,
                reviewed BOOLEAN NOT NULL DEFAULT FALSE,
                reviewer_note TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_fraud_scan_user ON fraud_scan_results(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_fraud_scan_run ON fraud_scan_results(scan_run_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_fraud_scan_created ON fraud_scan_results(created_at DESC)")

        # under_review flag on users
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS under_review BOOLEAN NOT NULL DEFAULT FALSE")

        # ── API publique marchands ─────────────────────────────────────────────
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS api_keys (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name        TEXT NOT NULL,
                key_hash    TEXT NOT NULL UNIQUE,
                is_test     BOOLEAN NOT NULL DEFAULT FALSE,
                active      BOOLEAN NOT NULL DEFAULT TRUE,
                last_used_at TIMESTAMPTZ,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)")

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS webhook_endpoints (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                url         TEXT NOT NULL,
                secret      TEXT NOT NULL,
                events      JSONB NOT NULL DEFAULT '["payment.success","payment.failed"]',
                active      BOOLEAN NOT NULL DEFAULT TRUE,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_webhook_ep_user ON webhook_endpoints(user_id)")

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS webhook_deliveries (
                id           TEXT PRIMARY KEY,
                endpoint_id  TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
                event_type   TEXT NOT NULL,
                payload      JSONB NOT NULL,
                status       TEXT NOT NULL DEFAULT 'pending',
                response_code INTEGER,
                attempts     INTEGER NOT NULL DEFAULT 0,
                next_retry_at TIMESTAMPTZ,
                created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_wh_del_endpoint ON webhook_deliveries(endpoint_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_wh_del_status   ON webhook_deliveries(status)")

        conn.commit()


def init_mobile_money_transfers_schema() -> None:
    """Migration pour les transferts directs MTN/Orange vers MTN/Orange."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS mobile_money_transfers (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id),
                source_provider TEXT NOT NULL,
                source_phone TEXT NOT NULL,
                payer_name TEXT NOT NULL DEFAULT '',
                dest_provider TEXT NOT NULL,
                dest_phone TEXT NOT NULL,
                dest_name TEXT NOT NULL,
                amount_fcfa NUMERIC(18,2) NOT NULL,
                fee_fcfa NUMERIC(18,2) NOT NULL DEFAULT 0,
                payin_total_fcfa NUMERIC(18,2) NOT NULL,
                payout_amount_fcfa NUMERIC(18,2) NOT NULL,
                payin_reference TEXT UNIQUE,
                payin_provider_reference TEXT,
                payout_reference TEXT UNIQUE,
                payout_provider_reference TEXT,
                status TEXT NOT NULL DEFAULT 'created',
                note TEXT NOT NULL DEFAULT '',
                failure_reason TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS mobile_money_transfers_user_idx ON mobile_money_transfers(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS mobile_money_transfers_status_idx ON mobile_money_transfers(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS mobile_money_transfers_created_idx ON mobile_money_transfers(created_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS mobile_money_transfers_payin_provider_idx ON mobile_money_transfers(payin_provider_reference)")
        cur.execute("CREATE INDEX IF NOT EXISTS mobile_money_transfers_payout_provider_idx ON mobile_money_transfers(payout_provider_reference)")
        conn.commit()


def init_email_marketing_schema() -> None:
    """Tables for compliant lifecycle and marketing emails."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS email_preferences (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                marketing_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
                lifecycle_opt_out BOOLEAN NOT NULL DEFAULT FALSE,
                unsubscribe_token TEXT UNIQUE,
                unsubscribed_at TIMESTAMPTZ,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS email_preferences_unsub_idx ON email_preferences(unsubscribe_token) WHERE unsubscribe_token IS NOT NULL")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS email_campaigns (
                id TEXT PRIMARY KEY,
                campaign_key TEXT NOT NULL,
                subject TEXT NOT NULL,
                segment TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'created',
                total_targeted INTEGER NOT NULL DEFAULT 0,
                total_sent INTEGER NOT NULL DEFAULT 0,
                total_failed INTEGER NOT NULL DEFAULT 0,
                created_by TEXT NOT NULL DEFAULT 'system',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                started_at TIMESTAMPTZ,
                completed_at TIMESTAMPTZ
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS email_campaigns_created_idx ON email_campaigns(created_at DESC)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS email_campaign_deliveries (
                id TEXT PRIMARY KEY,
                campaign_id TEXT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
                user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                email TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                error TEXT,
                sent_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS email_deliveries_campaign_idx ON email_campaign_deliveries(campaign_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS email_deliveries_user_idx ON email_campaign_deliveries(user_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS email_automation_state (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                campaign_key TEXT NOT NULL,
                last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (user_id, campaign_key)
            )
        """)
        conn.commit()
