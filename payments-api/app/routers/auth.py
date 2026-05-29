from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.security import create_access_token
from app.services import otp as otp_service
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


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=254)


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
    }


@router.post("/otp/start", response_model=OtpStartResponse)
async def otp_start(req: OtpStartRequest) -> OtpStartResponse:
    challenge_id, dev_code = otp_service.start_challenge(email=req.email)
    return OtpStartResponse(challenge_id=challenge_id, dev_code=dev_code)


@router.post("/otp/verify")
async def otp_verify(req: OtpVerifyRequest) -> dict[str, Any]:
    try:
        email = otp_service.verify_challenge(challenge_id=req.challenge_id, code=req.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"email": email, "verified": True}


@router.post("/login")
async def login(req: LoginRequest) -> dict[str, Any]:
    existing = get_user_by_email(req.email)
    if not existing:
        return {"needs_register": True}
    ensure_default_wallets(existing["id"])
    token = create_access_token(user_id=existing["id"], phone_e164=existing.get("email") or existing["phone_e164"])
    return {"needs_register": False, "token": token, "user": _public_user(existing)}


@router.post("/register")
async def register(req: RegisterRequest) -> dict[str, Any]:
    email = req.email.lower().strip()
    existing = get_user_by_email(email)
    if existing:
        updated = update_user_profile(
            user_id=existing["id"],
            patch={"fullName": req.full_name, "dob": req.dob, "country": req.country},
        )
        ensure_default_wallets(updated["id"])
        token = create_access_token(user_id=updated["id"], phone_e164=email)
        return {"token": token, "user": _public_user(updated)}

    user_id = f"usr_{uuid.uuid4().hex[:16]}"
    created = create_user(
        user_id=user_id,
        phone_e164=email,
        email=email,
        profile={"fullName": req.full_name, "dob": req.dob, "country": req.country, "kycLevel": 0},
    )
    ensure_default_wallets(created["id"])
    token = create_access_token(user_id=created["id"], phone_e164=email)
    return {"token": token, "user": _public_user(created)}
