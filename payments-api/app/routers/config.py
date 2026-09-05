import os


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing required env var: {name}")
    return value


class Settings:
    def __init__(self) -> None:
        self.db_host = env("PAYMENTS_API_DB_HOST", "payments-api-postgres")
        self.db_port = int(env("PAYMENTS_API_DB_PORT", "5432"))
        self.db_name = env("PAYMENTS_API_DB_NAME", "payments_api")
        self.db_user = env("PAYMENTS_API_DB_USER", "payments_api")
        self.db_password = env("PAYMENTS_API_DB_PASSWORD", "change-me")
        self.hyperswitch_base_url = env("HYPERSWITCH_BASE_URL", "http://hyperswitch:8080").rstrip("/")
        self.hyperswitch_api_key = env("HYPERSWITCH_API_KEY", "test_admin")
        self.stellar_sep_base_url = env("STELLAR_SEP_BASE_URL", "http://stellar-platform:8080").rstrip("/")
        self.anchor_ref_base_url = env("ANCHOR_REF_BASE_URL", "http://anchor-ref-health").rstrip("/")
        self.fx_api_base_url = env("FX_API_BASE_URL", "https://open.er-api.com/v6/latest").rstrip("/")
        self.quote_ttl_minutes = int(env("QUOTE_TTL_MINUTES", "15"))
        self.request_timeout_seconds = float(env("REQUEST_TIMEOUT_SECONDS", "8"))
        self.cors_origins = env("CORS_ORIGINS", "*")

        # Auth
        self.jwt_secret = env("JWT_SECRET", "dev-change-me")
        self.jwt_issuer = env("JWT_ISSUER", "payments-core")
        self.jwt_audience = env("JWT_AUDIENCE", "kobo")
        self.jwt_access_token_minutes = int(env("JWT_ACCESS_TOKEN_MINUTES", "43200"))  # 30 days

        # OTP
        self.otp_ttl_minutes = int(env("OTP_TTL_MINUTES", "10"))
        self.otp_dev_mode = env("OTP_DEV_MODE", "true").lower() in ("1", "true", "yes")
        self.otp_dev_code = env("OTP_DEV_CODE", "123456")

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

        # Dev-only admin
        self.dev_admin_token = env("DEV_ADMIN_TOKEN", "")

    @property
    def database_url(self) -> str:
        return (
            f"postgresql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()
