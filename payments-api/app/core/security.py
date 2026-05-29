from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


@dataclass(frozen=True)
class AuthUser:
    id: str
    phone_e164: str


def create_access_token(*, user_id: str, phone_e164: str) -> str:
    now = utcnow()
    payload: dict[str, Any] = {
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_access_token_minutes)).timestamp()),
        "sub": user_id,
        "phone": phone_e164,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


bearer = HTTPBearer(auto_error=False)


def require_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> AuthUser:
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing token")
    token = creds.credentials
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = str(payload.get("sub", ""))
    phone = str(payload.get("phone", ""))
    if not user_id or not phone:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    return AuthUser(id=user_id, phone_e164=phone)

