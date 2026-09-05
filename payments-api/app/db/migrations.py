from contextlib import closing

from app.db.session import get_conn


def init_infra_tables() -> None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                actor_user_id TEXT,
                actor_identifier TEXT,
                action TEXT NOT NULL,
                resource TEXT NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        # Migration : ajouter les colonnes si elles n'existent pas encore
        cur.execute("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_identifier TEXT")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS job_events (
                id TEXT PRIMARY KEY,
                job_name TEXT NOT NULL,
                status TEXT NOT NULL,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        # Migration : ajouter email et role dans admin_sessions pour traçabilité
        cur.execute("ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS email TEXT")
        cur.execute("ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'superadmin'")
        # Table des admin users (multi-admin / rôles)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT 'ops',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(LOWER(email))")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_job_events_status ON job_events(status)")
        # Tables liens de paiement
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS payment_links (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                amount DECIMAL(18,2) NOT NULL,
                currency TEXT NOT NULL DEFAULT 'FCFA',
                description TEXT NOT NULL DEFAULT '',
                creator_name TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                max_uses INT,
                use_count INT NOT NULL DEFAULT 0,
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS payment_link_txs (
                id TEXT PRIMARY KEY,
                link_id TEXT NOT NULL,
                payer_phone TEXT,
                provider TEXT,
                amount DECIMAL(18,2) NOT NULL,
                fee_fcfa DECIMAL(18,2) NOT NULL DEFAULT 0,
                net_fcfa DECIMAL(18,2),
                reference TEXT NOT NULL UNIQUE,
                aggregator_txid TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_payment_links_user ON payment_links(user_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_payment_link_txs_link ON payment_link_txs(link_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_payment_link_txs_ref ON payment_link_txs(reference)")

        # Colonne origin : 'internal' (dashboard Kobo) | 'api' (API publique marchands)
        cur.execute("ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'internal'")
        # gross_amount : montant facturé au payeur (gross-up inclus)
        cur.execute("ALTER TABLE payment_links ADD COLUMN IF NOT EXISTS gross_amount DECIMAL(18,2)")

        # Sécurité OTP : compteur de tentatives infructueuses + colonne email
        cur.execute("ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0")
        cur.execute("ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMPTZ")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_otp_email_created ON otp_challenges(email, created_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_otp_phone_created ON otp_challenges(phone_e164, created_at DESC)")

        conn.commit()

