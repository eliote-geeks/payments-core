from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_user
from app.services.email import notify_admin
from app.services.kyc import get_kyc, limits_for, reset_kyc, set_document_pending, store_document_upload
from app.services.users import get_user, update_user_profile

router = APIRouter(prefix="/kyc", tags=["kyc"])


def _detect_document_type(content: bytes) -> tuple[str, str] | None:
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp", ".webp"
    if content.startswith(b"%PDF-"):
        return "application/pdf", ".pdf"
    return None


class KycUploadRequest(BaseModel):
    doc_key: str = Field(min_length=2, max_length=32)


@router.get("/status")
async def status(user: AuthUser = Depends(require_user)) -> dict:
    data = get_kyc(user.id)
    profile = data["profile"]
    raw_level = int(profile["level"]) if profile else 0
    raw_status = profile["status"] if profile else "unverified"
    # Do not "approve" levels just because docs were uploaded. Levels increase only
    # when the KYC is actually approved by backoffice.
    level = raw_level if raw_status == "approved" else 0
    # keep user profile in sync for the UI banner
    try:
        update_user_profile(user_id=user.id, patch={"kycLevel": level})
    except Exception:
        pass
    return {
        "level": level,
        "status": raw_status,
        "limits": limits_for(user.id, level),
        "documents": data["documents"],
    }


@router.post("/documents/upload")
async def upload(req: KycUploadRequest, user: AuthUser = Depends(require_user)) -> dict:
    allowed = {"idFront", "idBack", "selfie", "address"}
    if req.doc_key not in allowed:
        raise HTTPException(status_code=400, detail="Unknown doc")
    set_document_pending(user.id, req.doc_key)
    return {"ok": True}


@router.post("/documents/upload-file")
async def upload_file(
    doc_key: str = Form(...),
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_user),
) -> dict:
    allowed = {"idFront", "idBack", "selfie", "address"}
    if doc_key not in allowed:
        raise HTTPException(status_code=400, detail="Unknown doc")
    # Hard limit to keep DB safe (MinIO later).
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large")
    detected = _detect_document_type(content)
    if detected is None:
        raise HTTPException(status_code=415, detail="Format non supporté (JPEG, PNG, WebP ou PDF)")
    content_type, extension = detected
    store_document_upload(
        user_id=user.id,
        doc_key=doc_key,
        file_name=f"{doc_key}{extension}",
        content_type=content_type,
        content=content,
    )
    return {"ok": True}


@router.post("/reset")
async def reset(user: AuthUser = Depends(require_user)) -> dict:
    reset_kyc(user.id)
    try:
        update_user_profile(user_id=user.id, patch={"kycLevel": 0})
    except Exception:
        pass
    return {"ok": True}


@router.post("/submit")
async def submit(user: AuthUser = Depends(require_user)) -> dict:
    data = get_kyc(user.id)
    profile = data["profile"]
    status = profile["status"] if profile else "unverified"
    if status not in ("ready_to_submit", "rejected"):
        # Only allow submit when all docs are present (ready_to_submit),
        # or allow resubmit after rejection.
        raise HTTPException(status_code=400, detail=f"Not ready to submit (status={status})")
    # Move to in_review. Backoffice can later set approved/rejected.
    from app.db.session import get_conn
    from contextlib import closing
    from app.services.kyc import utcnow

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE kyc_profiles SET status = 'in_review', updated_at = %s WHERE user_id = %s",
            (utcnow(), user.id),
        )
        conn.commit()

    user_row = get_user(user.id)
    user_email = (user_row or {}).get("email") or user.id
    notify_admin(
        "📋 Nouveau dossier KYC soumis",
        f"<b>Utilisateur :</b> {user_email}<br>"
        f"<b>ID :</b> {user.id}<br>"
        f"<b>Action :</b> Dossier KYC soumis et en attente de validation.<br><br>"
        f"Rendez-vous sur le panel admin pour valider ou rejeter le dossier.",
    )
    return {"ok": True}
