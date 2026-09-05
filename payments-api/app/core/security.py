from __future__ import annotations

import hashlib
import hmac
import uuid
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import psycopg
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.db.session import get_conn


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


def create_access_token(*, user_id: str, phone_e164: str, jti: str | None = None) -> str:
    if jti is None:
        jti = uuid.uuid4().hex
    now = utcnow()
    payload: dict[str, Any] = {
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_access_token_minutes)).timestamp()),
        "sub": user_id,
        "phone": phone_e164,
        "jti": jti,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _touch_session(jti: str) -> bool:
    """Update last_seen_at and return False if session is revoked."""
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT revoked, last_seen_at FROM sessions WHERE jti = %s LIMIT 1",
            (jti,),
        )
        row = cur.fetchone()
        if row is None:
            return False
        if row["revoked"]:
            return False
        # Update last_seen only if > 2 minutes since last update
        last = row["last_seen_at"]
        if last is None or (now - last).total_seconds() > 120:
            cur.execute("UPDATE sessions SET last_seen_at = %s WHERE jti = %s", (now, jti))
            conn.commit()
    return True


def _is_user_blocked(user_id: str) -> bool:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT is_blocked, blocked FROM users WHERE id = %s LIMIT 1",
            (user_id,),
        )
        row = cur.fetchone()
    return bool(row and (row.get("is_blocked") or row.get("blocked")))


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
    jti = payload.get("jti")
    if jti and not _touch_session(jti):
        raise HTTPException(status_code=401, detail="Session révoquée")
    if _is_user_blocked(user_id):
        raise HTTPException(status_code=403, detail="account_blocked")
    return AuthUser(id=user_id, phone_e164=phone)
