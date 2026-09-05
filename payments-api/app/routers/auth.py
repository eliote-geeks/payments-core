from __future__ import annotations

import uuid
import hmac
from contextlib import closing
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.core.security import create_access_token, sha256_hex, utcnow
from app.db.session import get_conn
from app.services import otp as otp_service
from app.services.pin_security import verify_user_pin
from app.services.users import create_user, get_user_by_email, update_user_profile
from app.services.wallets import ensure_default_wallets

router = APIRouter(prefix="/auth", tags=["auth"])


class OtpStartRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)


class OtpStartResponse(BaseModel):
    challenge_id: str
    dev_code: str | None = None


class OtpVerifyRequest(BaseModel):
    challenge_id: str
    code: str = Field(min_length=4, max_length=12)


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    full_name: str = Field(min_length=2, max_length=120)
    dob: str = Field(min_length=4, max_length=32)
    country: str = Field(min_length=2, max_length=3)
    phone: str | None = Field(default=None, max_length=20)
    device_fingerprint: str | None = Field(default=None, max_length=512)
    challenge_id: str = Field(min_length=8, max_length=80)
    verification_token: str = Field(min_length=32, max_length=256)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    device_fingerprint: str | None = Field(default=None, max_length=512)
    challenge_id: str = Field(min_length=8, max_length=80)
    verification_token: str = Field(min_length=32, max_length=256)


class SessionResumeRequest(BaseModel):
    session_id: str = Field(min_length=8, max_length=80)
    pin: str = Field(min_length=4, max_length=8, pattern="^[0-9]+$")
    device_fingerprint: str | None = Field(default=None, max_length=512)


def _is_blocked(row: dict[str, Any] | None) -> bool:
    return bool(row and (row.get("is_blocked") or row.get("blocked")))


def _public_user(row: dict[str, Any]) -> dict[str, Any]:
    profile = row.get("profile") or {}
    return {
        "id": row["id"],
        "email": row.get("email") or row.get("phone_e164") or "",
        "phone": row.get("phone_e164") or "",
        "fullName": profile.get("fullName") or profile.get("full_name") or "",
        "dob": profile.get("dob") or "",
        "country": profile.get("country") or "",
        "kycLevel": profile.get("kycLevel") or 0,
        "language": profile.get("language") or "fr",
        "hasPin": bool(profile.get("pinHash")),
    }


def _parse_device_name(user_agent: str) -> str:
    ua = user_agent.lower()
    browser = "Navigateur"
    os_name = "Inconnu"
    if "edg/" in ua:
        browser = "Edge"
    elif "chrome/" in ua:
        browser = "Chrome"
    elif "firefox/" in ua:
        browser = "Firefox"
    elif "safari/" in ua:
        browser = "Safari"
    if "iphone" in ua or "ipad" in ua:
        os_name = "iOS"
    elif "android" in ua:
        os_name = "Android"
    elif "windows" in ua:
        os_name = "Windows"
    elif "mac os x" in ua:
        os_name = "Mac"
    elif "linux" in ua:
        os_name = "Linux"
    return f"{browser} sur {os_name}"


def _device_fingerprint_hash(device_fingerprint: str | None) -> str | None:
    clean = (device_fingerprint or "").strip()
    if not clean:
        return None
    return sha256_hex(f"kobo-device:{clean}")


def _client_ip(request: Request) -> str:
    # CF-Connecting-IP : header Cloudflare, ne peut pas être forgé côté client
    cf_ip = request.headers.get("CF-Connecting-IP", "").strip()
    if cf_ip:
        return cf_ip
    # X-Real-IP : positionné par l'ingress k8s interne
    real_ip = request.headers.get("X-Real-IP", "").strip()
    if real_ip:
        return real_ip
    # X-Forwarded-For : premier élément seulement (les suivants peuvent être forgés)
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _create_session(user_id: str, jti: str, request: Request, device_fingerprint: str | None = None) -> str:
    session_id = f"ses_{uuid.uuid4().hex[:16]}"
    ua = request.headers.get("User-Agent", "")
    device_name = _parse_device_name(ua)
    ip = _client_ip(request)
    fp_hash = _device_fingerprint_hash(device_fingerprint)
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sessions (
                id, user_id, jti, device_name, ip_address,
                device_fingerprint_hash, created_at, last_seen_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (jti) DO NOTHING
            """,
            (session_id, user_id, jti, device_name, ip, fp_hash, now, now),
        )
        conn.commit()
    return session_id


def _get_user_by_id(user_id: str) -> dict[str, Any] | None:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM users WHERE id=%s LIMIT 1", (user_id,))
        row = cur.fetchone()
    return dict(row) if row else None


@router.post("/otp/start", response_model=OtpStartResponse)
async def otp_start(req: OtpStartRequest) -> OtpStartResponse:
    try:
        challenge_id, dev_code = otp_service.start_challenge(email=req.email)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=503, detail="otp_delivery_unavailable")
    return OtpStartResponse(challenge_id=challenge_id, dev_code=dev_code)


@router.post("/otp/verify")
async def otp_verify(req: OtpVerifyRequest) -> dict[str, Any]:
    try:
        email, verification_token = otp_service.verify_challenge(challenge_id=req.challenge_id, code=req.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"email": email, "verified": True, "verification_token": verification_token}


@router.post("/login")
async def login(req: LoginRequest, request: Request) -> dict[str, Any]:
    email = req.email.lower().strip()
    existing = get_user_by_email(email)
    if not existing:
        return {"needs_register": True}
    if _is_blocked(existing):
        raise HTTPException(status_code=403, detail="account_blocked")
    try:
        otp_service.consume_verification(
            challenge_id=req.challenge_id,
            verification_token=req.verification_token,
            email=email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    ensure_default_wallets(existing["id"])
    jti = uuid.uuid4().hex
    phone_e164 = existing.get("email") or existing["phone_e164"]
    token = create_access_token(user_id=existing["id"], phone_e164=phone_e164, jti=jti)
    session_id = _create_session(existing["id"], jti, request, req.device_fingerprint)
    return {"needs_register": False, "token": token, "session_id": session_id, "user": _public_user(existing)}


@router.post("/session/resume")
async def resume_session(req: SessionResumeRequest, request: Request) -> dict[str, Any]:
    """
    Reprend une session reconnue sur le même navigateur avec le PIN.
    Si la session a été révoquée ou n'existe pas, l'utilisateur doit refaire OTP/login.
    """
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT id, user_id, jti, revoked, device_fingerprint_hash
            FROM sessions
            WHERE id=%s
            LIMIT 1
            """,
            (req.session_id,),
        )
        session = cur.fetchone()
    if not session or session["revoked"]:
        raise HTTPException(status_code=401, detail="session_not_recognized")

    user = _get_user_by_id(session["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="session_not_recognized")
    if _is_blocked(user):
        raise HTTPException(status_code=403, detail="account_blocked")

    req_fp_hash = _device_fingerprint_hash(req.device_fingerprint)
    stored_fp_hash = session.get("device_fingerprint_hash")
    if stored_fp_hash and (not req_fp_hash or not hmac.compare_digest(stored_fp_hash, req_fp_hash)):
        raise HTTPException(status_code=401, detail="device_not_recognized")

    verify_user_pin(user["id"], req.pin, purpose="session_resume")

    ip = _client_ip(request)
    ua = request.headers.get("User-Agent", "")
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE sessions
            SET last_seen_at=%s,
                ip_address=%s,
                device_name=%s,
                device_fingerprint_hash=COALESCE(device_fingerprint_hash, %s)
            WHERE id=%s AND revoked=FALSE
            """,
            (now, ip, _parse_device_name(ua), req_fp_hash, req.session_id),
        )
        conn.commit()

    token = create_access_token(
        user_id=user["id"],
        phone_e164=user.get("email") or user.get("phone_e164") or "",
        jti=session["jti"],
    )
    return {"token": token, "session_id": req.session_id, "user": _public_user(user)}


class RecoverRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    recovery_code: str = Field(min_length=12, max_length=20)  # KOBO-XXXX-XXXX
    device_fingerprint: str | None = Field(default=None, max_length=512)


@router.post("/recover")
async def recover_account(req: RecoverRequest, request: Request) -> dict[str, Any]:
    email = req.email.lower().strip()
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=400, detail="Email ou code incorrect")
    if _is_blocked(user):
        raise HTTPException(status_code=403, detail="account_blocked")

    code_hash = sha256_hex(req.recovery_code.upper())
    now = utcnow()

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            UPDATE recovery_codes
            SET used_at = %s
            WHERE user_id = %s AND code_hash = %s AND used_at IS NULL
            RETURNING id
            """,
            (now, user["id"], code_hash),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="Email ou code incorrect")
        conn.commit()

    ensure_default_wallets(user["id"])
    jti = uuid.uuid4().hex
    phone_e164 = user.get("email") or user.get("phone_e164", "")
    token = create_access_token(user_id=user["id"], phone_e164=phone_e164, jti=jti)
    session_id = _create_session(user["id"], jti, request, req.device_fingerprint)
    return {"token": token, "session_id": session_id, "user": _public_user(user)}


@router.post("/register")
async def register(req: RegisterRequest, request: Request) -> dict[str, Any]:
    email = req.email.lower().strip()
    try:
        otp_service.consume_verification(
            challenge_id=req.challenge_id,
            verification_token=req.verification_token,
            email=email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    jti = uuid.uuid4().hex
    existing = get_user_by_email(email)
    profile_patch = {"fullName": req.full_name, "dob": req.dob, "country": req.country}
    if req.phone:
        profile_patch["phoneNumber"] = req.phone.strip()

    if existing:
        if _is_blocked(existing):
            raise HTTPException(status_code=403, detail="account_blocked")
        updated = update_user_profile(user_id=existing["id"], patch=profile_patch)
        ensure_default_wallets(updated["id"])
        token = create_access_token(user_id=updated["id"], phone_e164=email, jti=jti)
        session_id = _create_session(updated["id"], jti, request, req.device_fingerprint)
        return {"token": token, "session_id": session_id, "user": _public_user(updated)}

    user_id = f"usr_{uuid.uuid4().hex[:16]}"
    created = create_user(
        user_id=user_id,
        phone_e164=email,
        email=email,
        profile={**profile_patch, "kycLevel": 0},
    )
    ensure_default_wallets(created["id"])
    token = create_access_token(user_id=created["id"], phone_e164=email, jti=jti)
    session_id = _create_session(created["id"], jti, request, req.device_fingerprint)
    return {"token": token, "session_id": session_id, "user": _public_user(created)}
