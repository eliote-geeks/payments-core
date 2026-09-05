from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from arq import create_pool
from arq.connections import RedisSettings

from app.core.config import settings


def _redis_settings() -> RedisSettings:
    parsed = urlparse(settings.redis_url)
    return RedisSettings(
        host=parsed.hostname or "localhost",
        port=parsed.port or 6379,
        database=int((parsed.path or "/0").lstrip("/") or "0"),
        password=parsed.password,
    )


async def enqueue_job(name: str, *args: Any, **kwargs: Any) -> str | None:
    if not settings.jobs_enabled:
        return None
    pool = await create_pool(_redis_settings())
    try:
        job = await pool.enqueue_job(name, *args, **kwargs)
        return job.job_id if job else None
    finally:
        await pool.close()
