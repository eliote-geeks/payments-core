from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from contextlib import closing
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, Body
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_user, sha256_hex
from app.core.time import utcnow
from app.db.session import get_conn
from app.services.audit import record_audit
from app.services.email import notify_user
from app.services import otp as otp_service
from app.services.pin_security import hash_pin, reset_pin_security, verify_user_pin
from app.services.users import get_user, update_user_profile

router = APIRouter(tags=["users"])


def _hash_pin(pin: str) -> str:
    return hash_pin(pin)


def _verify_pin(pin: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_pin(pin), stored_hash)


def _user_response(row: dict) -> dict:
    profile = row.get("profile") or {}
    login_id = row.get("phone_e164") or row.get("email") or ""
    return {
        "id": row["id"],
        "loginId": login_id,           # read-only login identifier (phone or email)
        "phone": login_id,             # kept for backward compat
        "profilePhone": profile.get("phone") or "",   # editable phone in profile
        "fullName": profile.get("fullName") or "",
        "username": profile.get("username") or None,
        "dob": profile.get("dob") or "",
        "country": profile.get("country") or "",
        "language": profile.get("language") or "fr",
        "kycLevel": int(profile.get("kycLevel") or 0),
        "email": profile.get("email") or None,
        "hasPin": bool(profile.get("pinHash")),
        "avatarDataUrl": profile.get("avatarDataUrl") or None,
        "recoveryPhone": profile.get("recoveryPhone") or row.get("recovery_phone") or None,
    }


def _is_username_taken(username: str, exclude_user_id: str) -> bool:
    """Check if username is already used by another user."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM users WHERE profile->>'username' = %s AND id != %s LIMIT 1",
            (username, exclude_user_id),
        )
        return cur.fetchone() is not None


class MePatchRequest(BaseModel):
    fullName: str | None = Field(default=None, min_length=2, max_length=120)
    username: str | None = Field(default=None, min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_]+$")
    dob: str | None = Field(default=None, min_length=4, max_length=32)
    country: str | None = Field(default=None, min_length=2, max_length=3)
    language: str | None = Field(default=None, min_length=2, max_length=8)
    email: str | None = Field(default=None, max_length=254)
    phone: str | None = Field(default=None, max_length=30)  # profile contact phone (not login)
    recoveryPhone: str | None = Field(default=None, max_length=30)


class PinRequest(BaseModel):
    current_pin: str | None = Field(default=None, min_length=4, max_length=8)
    new_pin: str = Field(min_length=4, max_length=8, pattern="^[0-9]+$")


class PinVerifyRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=8, pattern="^[0-9]+$")


class PinResetStartResponse(BaseModel):
    challenge_id: str
    masked_email: str
    dev_code: str | None = None


class PinResetConfirmRequest(BaseModel):
    challenge_id: str
    code: str = Field(min_length=4, max_length=12)
    new_pin: str = Field(min_length=4, max_length=8, pattern="^[0-9]+$")


def _masked_email(email: str) -> str:
    if "@" not in email:
        return email
    name, domain = email.split("@", 1)
    if len(name) <= 2:
        masked = name[:1] + "*"
    else:
        masked = name[:2] + "*" * min(6, max(2, len(name) - 2))
    return f"{masked}@{domain}"


def _login_email(row: dict[str, Any]) -> str:
    email = row.get("email") or row.get("phone_e164") or ""
    if "@" not in email:
        profile = row.get("profile") or {}
        email = profile.get("email") or ""
    return str(email).strip().lower()


@router.get("/me")
async def me(user: AuthUser = Depends(require_user)) -> dict:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_response(row)


@router.patch("/me")
async def patch_me(req: MePatchRequest, user: AuthUser = Depends(require_user)) -> dict:
    patch = {k: v for k, v in req.model_dump().items() if v is not None}
    if not patch:
        row = get_user(user.id)
        return _user_response(row)
    if "username" in patch and _is_username_taken(patch["username"], user.id):
        raise HTTPException(status_code=409, detail="Ce nom d'utilisateur est déjà pris")
    updated = update_user_profile(user_id=user.id, patch=patch)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_response(updated)


@router.get("/me/username-check")
async def check_username(
    username: str = Query(min_length=3, max_length=32),
    user: AuthUser = Depends(require_user),
) -> dict:
    uname = username.lower().strip()
    import re
    if not re.match(r"^[a-z0-9_]{3,32}$", uname):
        return {"available": False, "reason": "invalide"}
    return {"available": not _is_username_taken(uname, user.id)}


# ── Avatar ────────────────────────────────────────────────────────────────────

@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_user),
) -> dict:
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(content) > 1 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image trop grande (max 1 Mo)")
    if content.startswith(b"\xff\xd8\xff"):
        content_type = "image/jpeg"
    elif content.startswith(b"\x89PNG\r\n\x1a\n"):
        content_type = "image/png"
    elif len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        content_type = "image/webp"
    else:
        raise HTTPException(status_code=415, detail="Format non supporté (JPEG, PNG ou WebP)")
    data_url = f"data:{content_type};base64,{base64.b64encode(content).decode()}"
    update_user_profile(user_id=user.id, patch={"avatarDataUrl": data_url})
    return {"ok": True, "avatarDataUrl": data_url}


# ── Security challenge (silent OTP for sensitive profile changes) ─────────────

@router.post("/me/security-challenge")
async def request_security_challenge(user: AuthUser = Depends(require_user)) -> dict:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    login_id = row.get("phone_e164") or row.get("email") or ""
    challenge_id, _ = otp_service.start_challenge(email=login_id)
    return {"challenge_id": challenge_id}


class ChallengeVerifyRequest(BaseModel):
    challenge_id: str
    code: str


@router.post("/me/security-challenge/verify")
async def verify_security_challenge(
    req: ChallengeVerifyRequest,
    user: AuthUser = Depends(require_user),
) -> dict:
    try:
        otp_service.verify_challenge(challenge_id=req.challenge_id, code=req.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"ok": True}


# ── PIN management ────────────────────────────────────────────────────────────

@router.post("/me/pin")
async def set_pin(req: PinRequest, user: AuthUser = Depends(require_user)) -> dict:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    profile = row.get("profile") or {}
    existing_hash = profile.get("pinHash")
    if existing_hash:
        verify_user_pin(user.id, req.current_pin, purpose="pin_change")
    update_user_profile(user_id=user.id, patch={"pinHash": hash_pin(req.new_pin)})
    reset_pin_security(user.id, reason="pin_changed")
    return {"ok": True}


@router.post("/me/pin/verify")
async def verify_pin(req: PinVerifyRequest, user: AuthUser = Depends(require_user)) -> dict:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    profile = row.get("profile") or {}
    existing_hash = profile.get("pinHash")
    if not existing_hash:
        raise HTTPException(status_code=403, detail="PIN non défini")
    verify_user_pin(user.id, req.pin, purpose="session_unlock")
    return {"ok": True}


@router.post("/me/pin/reset/start", response_model=PinResetStartResponse)
async def start_pin_reset(user: AuthUser = Depends(require_user)) -> PinResetStartResponse:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    email = _login_email(row)
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Aucun email de sécurité disponible pour ce compte")
    try:
        challenge_id, dev_code = otp_service.start_challenge(email=email)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    record_audit(
        action="pin_reset_start",
        resource=f"user:{user.id}",
        actor_user_id=user.id,
        actor_identifier=email,
        metadata={"email": _masked_email(email)},
    )
    return PinResetStartResponse(challenge_id=challenge_id, masked_email=_masked_email(email), dev_code=dev_code)


@router.post("/me/pin/reset/confirm")
async def confirm_pin_reset(req: PinResetConfirmRequest, user: AuthUser = Depends(require_user)) -> dict:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    email = _login_email(row)
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Aucun email de sécurité disponible pour ce compte")
    try:
        verified_email, _verification_token = otp_service.verify_challenge(
            challenge_id=req.challenge_id,
            code=req.code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if str(verified_email).strip().lower() != email:
        record_audit(
            action="pin_reset_email_mismatch",
            resource=f"user:{user.id}",
            actor_user_id=user.id,
            actor_identifier=email,
            metadata={"verified_email": str(verified_email)},
        )
        raise HTTPException(status_code=403, detail="Ce code ne correspond pas à votre compte")

    update_user_profile(user_id=user.id, patch={"pinHash": hash_pin(req.new_pin)})
    reset_pin_security(user.id, reason="pin_reset")
    record_audit(
        action="pin_reset_confirm",
        resource=f"user:{user.id}",
        actor_user_id=user.id,
        actor_identifier=email,
        metadata={"email": _masked_email(email)},
    )
    notify_user(
        user.id,
        "PIN réinitialisé",
        "Votre code PIN Kobo a été réinitialisé avec succès.<br>Si vous n'êtes pas à l'origine de cette action, contactez immédiatement le support Kobo.",
        success=True,
    )
    return {"ok": True}


# ── Sessions actives ──────────────────────────────────────────────────────────

@router.get("/me/sessions")
async def list_sessions(user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT id, device_name, ip_address, created_at, last_seen_at
            FROM sessions
            WHERE user_id = %s AND revoked = FALSE
            ORDER BY last_seen_at DESC
            """,
            (user.id,),
        )
        rows = cur.fetchall() or []
    return {
        "items": [
            {
                "id": r["id"],
                "device_name": r["device_name"],
                "ip_address": r["ip_address"],
                "created_at": r["created_at"].isoformat(),
                "last_seen_at": r["last_seen_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.delete("/me/sessions/{session_id}")
async def revoke_session(session_id: str, user: AuthUser = Depends(require_user)) -> dict:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE sessions SET revoked = TRUE WHERE id = %s AND user_id = %s",
            (session_id, user.id),
        )
        updated = cur.rowcount
        conn.commit()
    if not updated:
        raise HTTPException(status_code=404, detail="Session introuvable")
    return {"ok": True}


# ── Contacts / Favorites ──────────────────────────────────────────────────────

class ContactRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=4, max_length=20)


@router.get("/me/contacts")
async def list_contacts(user: AuthUser = Depends(require_user)) -> dict:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    contacts = (row.get("profile") or {}).get("contacts") or []
    return {"items": contacts}


@router.post("/me/contacts")
async def add_contact(req: ContactRequest, user: AuthUser = Depends(require_user)) -> dict:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    profile = row.get("profile") or {}
    contacts = list(profile.get("contacts") or [])
    if len(contacts) >= 50:
        raise HTTPException(status_code=400, detail="Maximum 50 contacts reached")
    contact_id = f"c_{uuid.uuid4().hex[:12]}"
    contact = {"id": contact_id, "name": req.name, "phone": req.phone}
    contacts.append(contact)
    update_user_profile(user_id=user.id, patch={"contacts": contacts})
    return contact


@router.delete("/me/contacts/{contact_id}")
async def remove_contact(contact_id: str, user: AuthUser = Depends(require_user)) -> dict:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    profile = row.get("profile") or {}
    contacts = [c for c in (profile.get("contacts") or []) if c.get("id") != contact_id]
    update_user_profile(user_id=user.id, patch={"contacts": contacts})
    return {"ok": True}


# ── Recovery codes ────────────────────────────────────────────────────────────

def _gen_recovery_code() -> str:
    import secrets
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    part1 = "".join(secrets.choice(chars) for _ in range(4))
    part2 = "".join(secrets.choice(chars) for _ in range(4))
    return f"KOBO-{part1}-{part2}"


@router.get("/me/recovery-codes/status")
async def recovery_codes_status(user: AuthUser = Depends(require_user)) -> dict:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT COUNT(*) as cnt FROM recovery_codes WHERE user_id = %s AND used_at IS NULL",
            (user.id,),
        )
        row = cur.fetchone()
    count = row["cnt"] if row else 0
    return {"has_codes": count > 0, "count": int(count)}


@router.post("/me/recovery-codes/generate")
async def generate_recovery_codes(user: AuthUser = Depends(require_user)) -> dict:
    codes = [_gen_recovery_code() for _ in range(5)]
    with closing(get_conn()) as conn, conn.cursor() as cur:
        # Invalidate old codes
        cur.execute("DELETE FROM recovery_codes WHERE user_id = %s", (user.id,))
        # Insert new hashed codes
        for code in codes:
            cur.execute(
                "INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (%s, %s, %s, %s)",
                (f"rc_{uuid.uuid4().hex[:16]}", user.id, sha256_hex(code), utcnow()),
            )
        conn.commit()
    return {
        "codes": codes,
        "warning": "Sauvegardez ces codes maintenant. Ils ne seront plus affichés.",
    }
