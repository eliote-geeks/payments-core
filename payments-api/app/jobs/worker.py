from urllib.parse import urlparse

from arq.connections import RedisSettings

from app.core.config import settings
from app.jobs.tasks import process_provider_webhook, reconcile_transfer, send_notification


def build_redis_settings() -> RedisSettings:
    parsed = urlparse(settings.redis_url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        database=int((parsed.path or "/0").lstrip("/") or "0"),
        password=parsed.password,
    )


class WorkerSettings:
    functions = [reconcile_transfer, process_provider_webhook, send_notification]
    redis_settings = build_redis_settings()
    max_jobs = 20
    job_timeout = 60
