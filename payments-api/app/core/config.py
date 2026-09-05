import os
from urllib.parse import urlsplit, urlunsplit


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


class Settings:
    def __init__(self) -> None:
        self.environment = env("ENVIRONMENT", "production").lower()
        self.db_host = env("PAYMENTS_API_DB_HOST", os.getenv("DB_HOST", "payments-api-postgres"))
        self.db_port = int(env("PAYMENTS_API_DB_PORT", os.getenv("DB_PORT", "5432")))
        self.db_name = env("PAYMENTS_API_DB_NAME", os.getenv("DB_NAME", "payments_api"))
        self.db_user = env("PAYMENTS_API_DB_USER", os.getenv("DB_USER", "payments_api"))
        self.db_password = env("PAYMENTS_API_DB_PASSWORD", os.getenv("DB_PASSWORD"))
        self.db_url_override = os.getenv("PAYMENTS_API_DATABASE_URL") or os.getenv("DATABASE_URL") or os.getenv("DB_URL", "")
        self.hyperswitch_base_url = env("HYPERSWITCH_BASE_URL", "http://hyperswitch:8080").rstrip("/")
        self.hyperswitch_api_key = env("HYPERSWITCH_API_KEY", "")
        self.hyperswitch_webhook_secret = env("HYPERSWITCH_WEBHOOK_SECRET", "")
        self.stellar_sep_base_url = env("STELLAR_SEP_BASE_URL", "http://stellar-platform:8080").rstrip("/")
        self.anchor_ref_base_url = env("ANCHOR_REF_BASE_URL", "http://anchor-ref-health").rstrip("/")
        self.fx_api_base_url = env("FX_API_BASE_URL", "https://open.er-api.com/v6/latest").rstrip("/")
        self.quote_ttl_minutes = int(env("QUOTE_TTL_MINUTES", "15"))
        self.request_timeout_seconds = float(env("REQUEST_TIMEOUT_SECONDS", "8"))
        self.cors_origins = env("CORS_ORIGINS", "https://koboonline.com")

        # Auth
        self.jwt_secret = env("JWT_SECRET")
        self.jwt_issuer = env("JWT_ISSUER", "payments-core")
        self.jwt_audience = env("JWT_AUDIENCE", "kobo")
        self.jwt_access_token_minutes = int(env("JWT_ACCESS_TOKEN_MINUTES", "43200"))  # 30 days

        # OTP
        self.otp_ttl_minutes = int(env("OTP_TTL_MINUTES", "10"))
        self.otp_dev_mode = env("OTP_DEV_MODE", "false").lower() in ("1", "true", "yes")
        self.otp_dev_code = env("OTP_DEV_CODE", "123456")
        self.otp_max_attempts = int(env("OTP_MAX_ATTEMPTS", "5"))
        self.otp_max_per_hour = int(env("OTP_MAX_PER_HOUR", "5"))

        # SMTP
        self.smtp_host = env("SMTP_HOST", "smtp.hostinger.com")
        self.smtp_port = int(env("SMTP_PORT", "465"))
        self.smtp_user = env("SMTP_USER", "service@koboonline.com")
        self.smtp_password = env("SMTP_PASSWORD", "")
        self.smtp_from = env("SMTP_FROM", "noreply@koboonline.com")

        # NotchPay
        self.notchpay_public_key = env("NOTCHPAY_PUBLIC_KEY", "")
        self.notchpay_private_key = env("NOTCHPAY_PRIVATE_KEY", "")
        self.notchpay_hash_key = env("NOTCHPAY_HASH_KEY", "")

        # SharePay
        self.sharepay_api_key = env("SHAREPAY_API_KEY", "")
        self.sharepay_webhook_secret = env("SHAREPAY_WEBHOOK_SECRET", "")
        self.stellar_webhook_secret = env("STELLAR_WEBHOOK_SECRET", "")

        # Admin
        self.dev_admin_token = env("DEV_ADMIN_TOKEN", "")
        self.admin_email = env("ADMIN_EMAIL", "service@koboonline.com")
        self.enable_dev_routes = env("ENABLE_DEV_ROUTES", "false").lower() in ("1", "true", "yes")

        # Limites de transaction
        self.p2p_max_single_fcfa = int(env("P2P_MAX_SINGLE_FCFA", "1000000"))   # 1M FCFA par transfert
        self.p2p_max_daily_fcfa = int(env("P2P_MAX_DAILY_FCFA", "3000000"))     # 3M FCFA / jour

        # OpenRouter (chatbot IA)
        self.openrouter_api_key = env("OPENROUTER_API_KEY", "")

        # Blockchain explorers
        self.tronscan_api_key = env("TRONSCAN_API_KEY", "")
        self.email_automation_enabled = env("EMAIL_AUTOMATION_ENABLED", "false").lower() in ("1", "true", "yes")
        self.email_automation_interval_seconds = int(env("EMAIL_AUTOMATION_INTERVAL_SECONDS", "86400"))
        self.email_automation_daily_cap = int(env("EMAIL_AUTOMATION_DAILY_CAP", "50"))

    @property
    def database_url(self) -> str:
        if self.db_url_override:
            raw = self.db_url_override
            if raw.startswith("jdbc:postgresql://"):
                raw = "postgresql://" + raw[len("jdbc:postgresql://") :]
            parts = urlsplit(raw)
            if parts.scheme.startswith("postgresql") and "@" not in parts.netloc and self.db_user:
                auth = self.db_user
                if self.db_password:
                    auth = f"{auth}:{self.db_password}"
                raw = urlunsplit((
                    parts.scheme,
                    f"{auth}@{parts.netloc}",
                    parts.path,
                    parts.query,
                    parts.fragment,
                ))
            return raw
        return (
            f"postgresql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()
