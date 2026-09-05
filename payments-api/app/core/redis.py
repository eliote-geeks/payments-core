from __future__ import annotations

from redis.asyncio import Redis

from app.core.config import settings


def redis_client() -> Redis:
    return Redis.from_url(settings.redis_url, decode_responses=True)

