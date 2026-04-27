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
        self.stellar_sep_base_url = env("STELLAR_SEP_BASE_URL", "http://stellar-platform:8080").rstrip("/")
        self.anchor_ref_base_url = env("ANCHOR_REF_BASE_URL", "http://anchor-ref-health").rstrip("/")
        self.fx_api_base_url = env("FX_API_BASE_URL", "https://open.er-api.com/v6/latest").rstrip("/")
        self.quote_ttl_minutes = int(env("QUOTE_TTL_MINUTES", "15"))
        self.request_timeout_seconds = float(env("REQUEST_TIMEOUT_SECONDS", "8"))

    @property
    def database_url(self) -> str:
        return (
            f"postgresql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


settings = Settings()
