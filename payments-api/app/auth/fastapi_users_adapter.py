from __future__ import annotations

from typing import Any

from fastapi import Depends, Request
from fastapi_users import BaseUserManager, FastAPIUsers, schemas
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy

from app.core.config import settings
from app.core.security import AuthUser, require_user


class FastApiUserRead(schemas.BaseUser[str]):
    phone_e164: str | None = None


class FastApiUserCreate(schemas.BaseUserCreate):
    phone_e164: str


class FastApiUserUpdate(schemas.BaseUserUpdate):
    phone_e164: str | None = None


class BridgeUserManager(BaseUserManager[Any, str]):
    reset_password_token_secret = settings.jwt_secret
    verification_token_secret = settings.jwt_secret

    async def on_after_register(self, user: Any, request: Request | None = None) -> None:
        return None


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(secret=settings.jwt_secret, lifetime_seconds=60 * settings.jwt_access_token_minutes)


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=BearerTransport(tokenUrl="/auth/login"),
    get_strategy=get_jwt_strategy,
)


def current_auth_user(user: AuthUser = Depends(require_user)) -> AuthUser:
    return user


# Router generation is intentionally not mounted yet. The current product flow
# is phone OTP first; this adapter keeps FastAPI Users available for the future
# admin/password flow without changing public API behavior.
fastapi_users: FastAPIUsers[Any, str] | None = None

