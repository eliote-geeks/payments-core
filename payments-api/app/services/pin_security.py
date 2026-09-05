from __future__ import annotations

import hashlib
import hmac
from contextlib import closing
from datetime import timedelta
from typing import Any

import psycopg
from fastapi import HTTPException
from psycopg.types.json import Json

from app.core.time import utcnow
from app.db.session import get_conn
from app.services.audit import record_audit
from app.services.email import notify_user
from app.services.users import get_user

PIN_LOCK_1_SECONDS = 5 * 60
PIN_LOCK_2_SECONDS = 30 * 60
PIN_DAILY_WINDOW_SECONDS = 24 * 60 * 60


def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def _verify_pin(pin: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_pin(pin), stored_hash)


def _parse_ts(value: str | None):
    if not value:
        return None
    try:
        return __import__("datetime").datetime.fromisoformat(str(value))
    except Exception:
        return None


def _load_profile(user_id: str) -> dict[str, Any]:
    row = get_user(user_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return row.get("profile") or {}


def _save_security(user_id: str, profile: dict[str, Any], security: dict[str, Any]) -> None:
    profile = dict(profile or {})
    profile["pinSecurity"] = security
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE users SET profile=%s, updated_at=%s WHERE id=%s",
            (Json(profile), utcnow(), user_id),
        )
        conn.commit()


def _seconds_until(iso_ts: str | None) -> int:
    locked_until = _parse_ts(iso_ts)
    if not locked_until:
        return 0
    return max(0, int((locked_until - utcnow()).total_seconds()))


def _message_for_lock(seconds: int) -> str:
    minutes = max(1, int((seconds + 59) / 60))
    return f"Trop d'essais incorrects. Réessayez dans {minutes} minute{'s' if minutes > 1 else ''} ou réinitialisez votre PIN."


def reset_pin_security(user_id: str, *, reason: str = "success") -> None:
    profile = _load_profile(user_id)
    security = dict(profile.get("pinSecurity") or {})
    security.update({
        "failed_count": 0,
        "daily_failed_count": 0,
        "daily_window_start": None,
        "locked_until": None,
        "last_failed_at": None,
        "last_reset_reason": reason,
        "last_reset_at": utcnow().isoformat(),
    })
    _save_security(user_id, profile, security)


def _revoke_sessions(user_id: str) -> None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE sessions SET revoked=TRUE WHERE user_id=%s AND revoked=FALSE", (user_id,))
        conn.commit()


def _register_failure(user_id: str, profile: dict[str, Any], purpose: str) -> None:
    now = utcnow()
    security = dict(profile.get("pinSecurity") or {})
    window_start = _parse_ts(security.get("daily_window_start"))
    if not window_start or (now - window_start).total_seconds() > PIN_DAILY_WINDOW_SECONDS:
        security["daily_window_start"] = now.isoformat()
        security["daily_failed_count"] = 0

    failed_count = int(security.get("failed_count") or 0) + 1
    daily_failed_count = int(security.get("daily_failed_count") or 0) + 1
    security["failed_count"] = failed_count
    security["daily_failed_count"] = daily_failed_count
    security["last_failed_at"] = now.isoformat()
    security["last_failed_purpose"] = purpose

    if daily_failed_count >= 10:
        security["locked_until"] = (now + timedelta(seconds=PIN_LOCK_2_SECONDS)).isoformat()
        _save_security(user_id, profile, security)
        _revoke_sessions(user_id)
        record_audit(action="pin_daily_limit_sessions_revoked", resource=f"user:{user_id}", actor_user_id=user_id, metadata={"purpose": purpose, "daily_failed_count": daily_failed_count})
        notify_user(
            user_id,
            "Sécurité PIN",
            "Trop d'essais PIN incorrects ont été détectés sur votre compte.<br>Vos sessions ont été révoquées par sécurité. Reconnectez-vous avec l'OTP email puis réinitialisez votre PIN si nécessaire.",
            success=False,
        )
        raise HTTPException(
            status_code=403,
            detail={
                "code": "pin_daily_limit",
                "message": "Trop d'essais incorrects. Vos sessions ont été fermées par sécurité. Reconnectez-vous avec l'OTP email.",
            },
        )

    lock_seconds = 0
    if failed_count >= 5:
        lock_seconds = PIN_LOCK_2_SECONDS
    elif failed_count >= 3:
        lock_seconds = PIN_LOCK_1_SECONDS

    if lock_seconds:
        security["locked_until"] = (now + timedelta(seconds=lock_seconds)).isoformat()
        _save_security(user_id, profile, security)
        if failed_count >= 5:
            notify_user(
                user_id,
                "Essais PIN incorrects",
                "Plusieurs essais PIN incorrects ont été détectés. Votre PIN est temporairement verrouillé pendant 30 minutes.",
                success=False,
            )
        record_audit(action="pin_temporarily_locked", resource=f"user:{user_id}", actor_user_id=user_id, metadata={"purpose": purpose, "failed_count": failed_count, "daily_failed_count": daily_failed_count, "lock_seconds": lock_seconds})
        raise HTTPException(
            status_code=423,
            detail={
                "code": "pin_locked",
                "retry_after_seconds": lock_seconds,
                "message": _message_for_lock(lock_seconds),
            },
        )

    _save_security(user_id, profile, security)
    remaining = max(0, 3 - failed_count)
    raise HTTPException(
        status_code=401,
        detail={
            "code": "pin_incorrect",
            "remaining_before_lock": remaining,
            "message": f"Code PIN incorrect. {remaining} essai{'s' if remaining > 1 else ''} avant verrouillage temporaire.",
        },
    )


def verify_user_pin(user_id: str, pin: str | None, *, purpose: str = "pin") -> None:
    profile = _load_profile(user_id)
    stored_hash = profile.get("pinHash")
    if not stored_hash:
        raise HTTPException(status_code=403, detail="Aucun code PIN défini. Définissez votre PIN dans votre profil.")
    if not pin:
        raise HTTPException(status_code=400, detail="Code PIN requis.")

    security = dict(profile.get("pinSecurity") or {})
    retry_after = _seconds_until(security.get("locked_until"))
    if retry_after > 0:
        raise HTTPException(
            status_code=423,
            detail={
                "code": "pin_locked",
                "retry_after_seconds": retry_after,
                "message": _message_for_lock(retry_after),
            },
        )

    if not _verify_pin(pin, stored_hash):
        _register_failure(user_id, profile, purpose)

    reset_pin_security(user_id, reason=f"pin_ok:{purpose}")
