from __future__ import annotations

import base64
import hashlib
import hmac
import uuid
from contextlib import closing
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_user
from app.core.time import utcnow
from app.db.session import get_conn
from app.services.users import get_user, update_user_profile

router = APIRouter(tags=["users"])


def _hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def _verify_pin(pin: str, stored_hash: str) -> bool:
    return hmac.compare_digest(_hash_pin(pin), stored_hash)


def _user_response(row: dict) -> dict:
    profile = row.get("profile") or {}
    return {
        "id": row["id"],
        "phone": row["phone_e164"],
        "fullName": profile.get("fullName") or "",
        "username": profile.get("username") or None,
        "dob": profile.get("dob") or "",
        "country": profile.get("country") or "",
        "language": profile.get("language") or "fr",
        "kycLevel": int(profile.get("kycLevel") or 0),
        "email": profile.get("email") or None,
        "hasPin": bool(profile.get("pinHash")),
        "avatarDataUrl": profile.get("avatarDataUrl") or None,
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


class PinRequest(BaseModel):
    current_pin: str | None = Field(default=None, min_length=4, max_length=8)
    new_pin: str = Field(min_length=4, max_length=8, pattern="^[0-9]+$")


class DeviceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    fingerprint: str | None = Field(default=None, max_length=512)


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


# ── Avatar ────────────────────────────────────────────────────────────────────

@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_user),
) -> dict:
    allowed_types = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=415, detail="Format non supporté (jpeg/png/webp/gif)")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")
    if len(content) > 1 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image trop grande (max 1 Mo)")
    data_url = f"data:{file.content_type};base64,{base64.b64encode(content).decode()}"
    update_user_profile(user_id=user.id, patch={"avatarDataUrl": data_url})
    return {"ok": True, "avatarDataUrl": data_url}


# ── PIN management ────────────────────────────────────────────────────────────

@router.post("/me/pin")
async def set_pin(req: PinRequest, user: AuthUser = Depends(require_user)) -> dict:
    row = get_user(user.id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    profile = row.get("profile") or {}
    existing_hash = profile.get("pinHash")
    if existing_hash:
        if not req.current_pin:
            raise HTTPException(status_code=400, detail="current_pin required to change existing PIN")
        if not _verify_pin(req.current_pin, existing_hash):
            raise HTTPException(status_code=401, detail="Incorrect current PIN")
    update_user_profile(user_id=user.id, patch={"pinHash": _hash_pin(req.new_pin)})
    return {"ok": True}


# ── Trusted devices ───────────────────────────────────────────────────────────

def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.get("/me/devices")
async def list_devices(user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT id, name, ip_address, fingerprint, last_seen_at, created_at FROM trusted_devices WHERE user_id = %s ORDER BY created_at DESC",
            (user.id,),
        )
        rows = cur.fetchall() or []
    return {
        "items": [
            {
                "id": r["id"],
                "name": r["name"],
                "ip_address": r["ip_address"],
                "fingerprint": r["fingerprint"],
                "last_seen_at": r["last_seen_at"].isoformat() if r["last_seen_at"] else None,
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/me/devices")
async def add_device(req: DeviceRequest, request: Request, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    device_id = f"dev_{uuid.uuid4().hex[:14]}"
    now = utcnow()
    ip = _client_ip(request)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO trusted_devices (id, user_id, name, ip_address, fingerprint, last_seen_at, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (device_id, user.id, req.name, ip, req.fingerprint, now, now),
        )
        row = cur.fetchone()
        conn.commit()
    return {
        "id": row["id"],
        "name": row["name"],
        "ip_address": row["ip_address"],
        "fingerprint": row["fingerprint"],
        "last_seen_at": row["last_seen_at"].isoformat(),
        "created_at": row["created_at"].isoformat(),
    }


@router.delete("/me/devices/{device_id}")
async def remove_device(device_id: str, user: AuthUser = Depends(require_user)) -> dict:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM trusted_devices WHERE id = %s AND user_id = %s",
            (device_id, user.id),
        )
        deleted = cur.rowcount
        conn.commit()
    if not deleted:
        raise HTTPException(status_code=404, detail="Device not found")
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
