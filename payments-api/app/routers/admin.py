from __future__ import annotations

import csv
import io
import uuid
from contextlib import closing
from datetime import timedelta
from decimal import Decimal, ROUND_CEILING
from typing import Any

import psycopg
import jwt
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import sha256_hex
from app.core.time import utcnow
from app.db.session import get_conn
from app.services import otp as otp_service
from app.services.audit import record_audit
from app.services.blockchain_verify import verify_tx
from app.services.crypto_reconciliation import reconcile_crypto_deposits
from app.services.email import notify_user
from app.services.notifications import create_notification
from app.services.serializers import serialize_transfer
from app.services.fees import calculate_fee_fcfa
from app.routers.fiat_withdrawals import trigger_approved_payout, trigger_payout_retry

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(token: str | None, allowed_roles: set[str] | None = None) -> str:
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    # Backwards-compat: hardcoded dev token
    if settings.environment != "production" and settings.dev_admin_token and token == settings.dev_admin_token:
        role = "superadmin"
        if allowed_roles and role not in allowed_roles:
            raise HTTPException(status_code=403, detail="Permission administrateur insuffisante")
        return role
    # OTP-issued admin session token
    token_hash = sha256_hex(token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT role FROM admin_sessions WHERE token = %s AND expires_at > %s AND revoked = FALSE LIMIT 1",
            (token_hash, utcnow()),
        )
        session = cur.fetchone()
        if session:
            role = session.get("role") or "ops"
            if allowed_roles and role not in allowed_roles:
                raise HTTPException(status_code=403, detail="Permission administrateur insuffisante")
            return role
    raise HTTPException(status_code=401, detail="Unauthorized")


def _get_actor_email(token: str | None) -> str:
    """Retourne l'email de l'admin associé au token, ou 'dev_admin' pour le token de dev."""
    if not token:
        return "unknown"
    if settings.environment != "production" and settings.dev_admin_token and token == settings.dev_admin_token:
        return "dev_admin"
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT email FROM admin_sessions WHERE token=%s LIMIT 1",
            (sha256_hex(token),),
        )
        row = cur.fetchone()
    return (row["email"] or "unknown") if row else "unknown"


def _header(token: str | None = Header(default=None, alias="X-Admin-Token")) -> str | None:
    return token


def _kyc_document_token(user_id: str, doc_key: str) -> str:
    now = utcnow()
    return jwt.encode(
        {
            "iss": settings.jwt_issuer,
            "aud": "kobo-kyc-document",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "sub": user_id,
            "doc": doc_key,
        },
        settings.jwt_secret,
        algorithm="HS256",
    )


def _verify_kyc_document_token(token: str, user_id: str, doc_key: str) -> None:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=["HS256"],
            audience="kobo-kyc-document",
            issuer=settings.jwt_issuer,
        )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Lien de document invalide ou expiré")
    if payload.get("sub") != user_id or payload.get("doc") != doc_key:
        raise HTTPException(status_code=403, detail="Ce lien ne correspond pas au document demandé")


# ── Users ────────────────────────────────────────────────────────────────────


@router.get("/users")
async def list_users(
    limit: int = 100,
    offset: int = 0,
    search: str | None = None,
    kyc_level: int | None = None,
    is_blocked: bool | None = None,
    country: str | None = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)

    allowed_sort = {"created_at", "last_active", "balance_fcfa", "phone_e164"}
    if sort_by not in allowed_sort:
        sort_by = "created_at"
    order = "ASC" if sort_order == "asc" else "DESC"

    where_parts = []
    params: list = []

    if search:
        like = f"%{search.lower()}%"
        where_parts.append(
            "(LOWER(u.phone_e164) LIKE %s OR LOWER(u.profile->>'fullName') LIKE %s "
            "OR LOWER(u.profile->>'email') LIKE %s OR u.id LIKE %s)"
        )
        params += [like, like, like, like]
    if is_blocked is not None:
        if is_blocked:
            where_parts.append("(u.is_blocked = TRUE OR u.blocked = TRUE)")
        else:
            where_parts.append("(u.is_blocked = FALSE OR u.is_blocked IS NULL) AND (u.blocked = FALSE OR u.blocked IS NULL)")
    if country:
        where_parts.append("LOWER(u.profile->>'country') = %s")
        params.append(country.lower())
    if kyc_level is not None:
        where_parts.append("COALESCE(kp.level, 0) = %s")
        params.append(kyc_level)

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    sort_col = {
        "created_at":   "u.created_at",
        "last_active":  "last_active",
        "balance_fcfa": "balance_fcfa",
        "phone_e164":   "u.phone_e164",
    }[sort_by]

    query = f"""
        SELECT
            u.id,
            u.phone_e164,
            u.profile,
            u.is_blocked,
            u.blocked                  AS auto_blocked,
            u.created_at,
            COALESCE(kp.level, 0)      AS kyc_level,
            kp.status                  AS kyc_status,
            COALESCE(wa.balance, 0)    AS balance_fcfa,
            MAX(s.last_seen_at)        AS last_active,
            COUNT(*) OVER ()           AS total_count
        FROM users u
        LEFT JOIN kyc_profiles kp      ON kp.user_id = u.id
        LEFT JOIN wallet_accounts wa   ON wa.user_id = u.id AND wa.currency = 'FCFA'
        LEFT JOIN sessions s           ON s.user_id = u.id AND s.revoked = FALSE
        {where_sql}
        GROUP BY u.id, u.phone_e164, u.profile, u.is_blocked, u.blocked, u.created_at,
                 kp.level, kp.status, wa.balance
        ORDER BY {sort_col} {order} NULLS LAST
        LIMIT %s OFFSET %s
    """
    params += [limit, offset]

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(query, params)
        rows = cur.fetchall() or []
        cur.execute(
            """
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE COALESCE(u.is_blocked, FALSE) OR COALESCE(u.blocked, FALSE)) AS blocked,
                COUNT(*) FILTER (WHERE NOT (COALESCE(u.is_blocked, FALSE) OR COALESCE(u.blocked, FALSE))) AS active,
                COUNT(*) FILTER (WHERE COALESCE(kp.level, 0) >= 1) AS kyc_validated
            FROM users u
            LEFT JOIN kyc_profiles kp ON kp.user_id = u.id
            """
        )
        stats = cur.fetchone() or {}

    total = int(rows[0]["total_count"]) if rows else 0
    profile_cache: dict = {}

    def _p(r):
        uid = r["id"]
        if uid not in profile_cache:
            profile_cache[uid] = r["profile"] or {}
        return profile_cache[uid]

    return {
        "total": total,
        "count": len(rows),
        "stats": {
            "total": int(stats.get("total") or 0),
            "active": int(stats.get("active") or 0),
            "blocked": int(stats.get("blocked") or 0),
            "kyc_validated": int(stats.get("kyc_validated") or 0),
        },
        "items": [
            {
                "id": r["id"],
                "phone_e164": r["phone_e164"],
                "email": _p(r).get("email") or "",
                "fullName": _p(r).get("fullName") or "",
                "username": _p(r).get("username") or "",
                "country": _p(r).get("country") or "",
                "profile": r["profile"],
                "is_blocked": bool(r["is_blocked"] or r["auto_blocked"]),
                "auto_blocked": bool(r["auto_blocked"]),
                "kyc_level": r["kyc_level"],
                "kyc_status": r["kyc_status"] or "",
                "balance_fcfa": float(r["balance_fcfa"]),
                "last_active": r["last_active"].isoformat() if r["last_active"] else None,
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
    }


# ── KYC ──────────────────────────────────────────────────────────────────────


@router.get("/kyc")
async def list_kyc(
    status: str | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """List KYC profiles optionally filtered by status (in_review, approved, rejected…)."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if status:
            cur.execute(
                """
                SELECT kp.user_id, kp.level, kp.status, kp.updated_at,
                       u.phone_e164, u.profile->>'fullName' AS full_name,
                       (SELECT COUNT(*) FROM kyc_documents d WHERE d.user_id = kp.user_id) AS doc_count
                FROM kyc_profiles kp
                JOIN users u ON u.id = kp.user_id
                WHERE kp.status = %s
                ORDER BY kp.updated_at DESC
                """,
                (status,),
            )
        else:
            cur.execute(
                """
                SELECT kp.user_id, kp.level, kp.status, kp.updated_at,
                       u.phone_e164, u.profile->>'fullName' AS full_name,
                       (SELECT COUNT(*) FROM kyc_documents d WHERE d.user_id = kp.user_id) AS doc_count
                FROM kyc_profiles kp
                JOIN users u ON u.id = kp.user_id
                ORDER BY kp.updated_at DESC
                """
            )
        rows = cur.fetchall() or []
    return {
        "count": len(rows),
        "items": [
            {
                "user_id": r["user_id"],
                "phone_e164": r["phone_e164"],
                "full_name": r.get("full_name") or "",
                "level": r["level"],
                "status": r["status"],
                "updated_at": r["updated_at"].isoformat(),
                "doc_count": int(r.get("doc_count") or 0),
            }
            for r in rows
        ],
    }


class KycDecisionRequest(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    level: int = Field(default=1, ge=0, le=3)
    reason: str | None = None


@router.post("/kyc/{user_id}/decide")
async def decide_kyc(
    user_id: str,
    body: KycDecisionRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Approve or reject a KYC profile. On approval, sets the user's KYC level."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT user_id, status FROM kyc_profiles WHERE user_id = %s", (user_id,))
        profile = cur.fetchone()
        if not profile:
            raise HTTPException(status_code=404, detail="KYC profile not found")

        new_level = body.level if body.decision == "approved" else 0
        cur.execute(
            """
            UPDATE kyc_profiles
            SET status = %s, level = %s, updated_at = %s
            WHERE user_id = %s
            """,
            (body.decision, new_level, utcnow(), user_id),
        )
        if body.decision == "rejected" and body.reason:
            cur.execute(
                """
                UPDATE kyc_documents
                SET reason = %s, updated_at = %s
                WHERE user_id = %s AND status = 'pending'
                """,
                (body.reason, utcnow(), user_id),
            )
        # Sync kycLevel into user profile JSON
        cur.execute(
            """
            UPDATE users
            SET profile = jsonb_set(profile, '{kycLevel}', %s::jsonb), updated_at = %s
            WHERE id = %s
            """,
            (str(new_level), utcnow(), user_id),
        )
        conn.commit()

    try:
        if body.decision == "approved":
            create_notification(
                user_id,
                "kyc_approved",
                "Vérification approuvée",
                f"Votre vérification d'identité a été approuvée. Niveau KYC : {new_level}.",
                {"level": new_level},
            )
            notify_user(
                user_id,
                "Vérification d'identité approuvée",
                f"Bonne nouvelle ! Votre vérification d'identité (KYC) a été <b>approuvée</b> au niveau {new_level}.<br><br>"
                f"Vous pouvez maintenant utiliser toutes les fonctionnalités de Kobo : retraits, virements internationaux, etc.",
                success=True,
            )
        else:
            create_notification(
                user_id,
                "kyc_rejected",
                "Vérification rejetée",
                f"Votre vérification d'identité a été rejetée.{(' Motif : ' + body.reason) if body.reason else ''} Veuillez soumettre à nouveau vos documents.",
                {},
            )
            notify_user(
                user_id,
                "Vérification d'identité refusée",
                f"Votre dossier de vérification d'identité (KYC) a été <b>refusé</b>."
                f"{('<br><br><b>Motif :</b> ' + body.reason) if body.reason else ''}<br><br>"
                f"Veuillez soumettre à nouveau vos documents dans l'application (Plus > Vérification d'identité).",
                success=False,
            )
    except Exception:
        pass
    record_audit(
        action=f"kyc_{body.decision}",
        resource=f"user:{user_id}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"level": new_level, "reason": body.reason or ""},
    )
    return {"ok": True, "user_id": user_id, "decision": body.decision, "level": new_level}


@router.get("/kyc/{user_id}/documents")
async def get_kyc_documents(
    user_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """List all KYC documents for a user (without binary content)."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT doc_key, status, file_name, content_type, size_bytes, reason, updated_at
            FROM kyc_documents
            WHERE user_id = %s
            ORDER BY doc_key
            """,
            (user_id,),
        )
        rows = cur.fetchall() or []
    return {
        "user_id": user_id,
        "documents": [
            {
                "doc_key": r["doc_key"],
                "status": r["status"],
                "file_name": r["file_name"],
                "content_type": r["content_type"],
                "size_bytes": r["size_bytes"],
                "reason": r["reason"],
                "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
                "view_token": _kyc_document_token(user_id, r["doc_key"]),
            }
            for r in rows
        ],
    }


@router.get("/kyc/{user_id}/documents/{doc_key}/view")
async def view_kyc_document(
    user_id: str,
    doc_key: str,
    view_token: str,
) -> Any:
    """Retourne un document via un lien dédié, limité au document et valable cinq minutes."""
    from fastapi.responses import Response as FastAPIResponse
    _verify_kyc_document_token(view_token, user_id, doc_key)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT content, content_type, file_name FROM kyc_documents WHERE user_id = %s AND doc_key = %s",
            (user_id, doc_key),
        )
        row = cur.fetchone()
    if not row or not row["content"]:
        raise HTTPException(status_code=404, detail="Document non trouvé")
    content_type = row["content_type"] or "application/octet-stream"
    disposition = "inline" if content_type.startswith("image/") else "attachment"
    return FastAPIResponse(
        content=bytes(row["content"]),
        media_type=content_type,
        headers={
            "Content-Disposition": f"{disposition}; filename=\"{doc_key}\"",
            "Cache-Control": "no-store, private",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


# ── Transfers ─────────────────────────────────────────────────────────────────


@router.get("/p2p-transfers")
async def list_p2p_transfers(
    status: str | None = None,
    limit: int = 200,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    limit = max(1, min(limit, 1000))
    params: list[Any] = []
    where = ""
    if status:
        where = "WHERE p.status = %s"
        params.append(status)
    params.append(limit)

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            f"""
            SELECT p.id, p.sender_user_id, p.recipient_user_id, p.amount, p.currency, p.status, p.created_at,
                   su.phone_e164 AS sender_phone, su.email AS sender_email, su.profile AS sender_profile,
                   ru.phone_e164 AS recipient_phone, ru.email AS recipient_email, ru.profile AS recipient_profile
            FROM p2p_transfers p
            LEFT JOIN users su ON su.id = p.sender_user_id
            LEFT JOIN users ru ON ru.id = p.recipient_user_id
            {where}
            ORDER BY p.created_at DESC
            LIMIT %s
            """,
            params,
        )
        rows = cur.fetchall() or []

    def user_label(row: dict[str, Any], prefix: str) -> str:
        profile = row.get(f"{prefix}_profile") or {}
        full_name = profile.get("fullName") or profile.get("name") or ""
        return full_name or row.get(f"{prefix}_email") or row.get(f"{prefix}_phone") or "—"

    return {
        "count": len(rows),
        "items": [
            {
                "id": r["id"],
                "sender_user_id": r["sender_user_id"],
                "sender_name": user_label(r, "sender"),
                "sender_phone": r.get("sender_phone") or "",
                "sender_email": r.get("sender_email") or "",
                "recipient_user_id": r["recipient_user_id"],
                "recipient_name": user_label(r, "recipient"),
                "recipient_phone": r.get("recipient_phone") or "",
                "recipient_email": r.get("recipient_email") or "",
                "amount": float(r["amount"]),
                "currency": r["currency"],
                "status": r["status"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/transfers")
async def list_transfers(
    status: str | None = None,
    limit: int = 50,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if status:
            cur.execute(
                "SELECT * FROM transfers WHERE status = %s ORDER BY created_at DESC LIMIT %s",
                (status, limit),
            )
        else:
            cur.execute(
                "SELECT * FROM transfers ORDER BY created_at DESC LIMIT %s", (limit,)
            )
        rows = cur.fetchall() or []
    return {"count": len(rows), "items": [serialize_transfer(r) for r in rows]}


class TransferPatchRequest(BaseModel):
    status: str | None = None
    payment_status: str | None = None
    settlement_status: str | None = None
    note: str | None = None


@router.patch("/transfers/{transfer_id}")
async def patch_transfer(
    transfer_id: str,
    body: TransferPatchRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Manually override a transfer's status (manual review, force-complete, etc.)."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id FROM transfers WHERE id = %s", (transfer_id,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Transfer not found")

        fields: list[str] = ["updated_at = %s"]
        values: list[Any] = [utcnow()]
        if body.status:
            fields.append("status = %s")
            values.append(body.status)
        if body.payment_status:
            fields.append("payment_status = %s")
            values.append(body.payment_status)
        if body.settlement_status:
            fields.append("settlement_status = %s")
            values.append(body.settlement_status)

        if body.note:
            step = {
                "step": "admin_override",
                "status": "ok",
                "timestamp": utcnow().isoformat(),
                "detail": {"note": body.note, "changes": body.model_dump(exclude_none=True)},
            }
            fields.append("orchestration = orchestration || %s::jsonb")
            values.append(Json([step]))

        values.append(transfer_id)
        cur.execute(f"UPDATE transfers SET {', '.join(fields)} WHERE id = %s", values)
        conn.commit()
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        row = cur.fetchone()

    return serialize_transfer(row)


# ── Support tickets ───────────────────────────────────────────────────────────


@router.get("/support/tickets")
async def list_all_tickets(
    status: str | None = None,
    limit: int = 50,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if status:
            cur.execute(
                """
                SELECT st.id, st.subject, st.status, st.updated_at, u.phone_e164
                FROM support_tickets st JOIN users u ON u.id = st.user_id
                WHERE st.status = %s ORDER BY st.updated_at DESC LIMIT %s
                """,
                (status, limit),
            )
        else:
            cur.execute(
                """
                SELECT st.id, st.subject, st.status, st.updated_at, u.phone_e164
                FROM support_tickets st JOIN users u ON u.id = st.user_id
                ORDER BY st.updated_at DESC LIMIT %s
                """,
                (limit,),
            )
        rows = cur.fetchall() or []
    return {
        "count": len(rows),
        "items": [
            {
                "id": r["id"],
                "subject": r["subject"],
                "status": r["status"],
                "phone_e164": r["phone_e164"],
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/support/tickets/{ticket_id}/messages")
async def get_ticket_messages(
    ticket_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT id, user_id, subject, status FROM support_tickets WHERE id = %s",
            (ticket_id,),
        )
        ticket = cur.fetchone()
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        cur.execute(
            """
            SELECT from_role, author_name, body, created_at
            FROM support_messages
            WHERE user_id = %s
            ORDER BY created_at ASC
            """,
            (ticket["user_id"],),
        )
        messages = cur.fetchall() or []
    return {
        "ticket_id": ticket_id,
        "subject": ticket["subject"],
        "status": ticket["status"],
        "messages": [
            {
                "from": m["from_role"],
                "name": m["author_name"],
                "text": m["body"],
                "ts": m["created_at"].isoformat(),
            }
            for m in messages
        ],
    }


class TicketReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    author_name: str = Field(default="Support", max_length=80)
    close: bool = False


@router.post("/support/tickets/{ticket_id}/reply")
async def reply_ticket(
    ticket_id: str,
    body: TicketReplyRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Send an agent reply and optionally close the ticket."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT id, user_id, status FROM support_tickets WHERE id = %s", (ticket_id,)
        )
        ticket = cur.fetchone()
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        if ticket["status"] == "closed":
            raise HTTPException(status_code=409, detail="Ticket already closed")

        msg_id = f"msg_{uuid.uuid4().hex[:14]}"
        cur.execute(
            """
            INSERT INTO support_messages (id, user_id, from_role, author_name, body, created_at)
            VALUES (%s, %s, 'agent', %s, %s, %s)
            """,
            (msg_id, ticket["user_id"], body.author_name, body.message, utcnow()),
        )
        if body.close:
            cur.execute(
                "UPDATE support_tickets SET status = 'closed', updated_at = %s WHERE id = %s",
                (utcnow(), ticket_id),
            )
        conn.commit()

    return {"ok": True, "ticket_id": ticket_id, "closed": body.close}


# ── Support conversations directes (chat) ────────────────────────────────────

@router.get("/support/conversations")
async def list_conversations(
    limit: int = 100,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Liste tous les utilisateurs ayant des messages support (chat ou ticket)."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS support_conversation_archives (
                user_id TEXT PRIMARY KEY,
                archived_at TIMESTAMPTZ NOT NULL
            )
            """
        )
        cur.execute(
            """
            WITH latest AS (
                SELECT DISTINCT ON (user_id)
                    user_id, body, from_role, created_at
                FROM support_messages
                ORDER BY user_id, created_at DESC
            )
            SELECT
                l.user_id,
                u.phone_e164,
                u.profile->>'full_name' AS full_name,
                l.body          AS last_message,
                l.from_role     AS last_from,
                l.created_at    AS last_at,
                st.id           AS ticket_id,
                st.subject      AS ticket_subject,
                st.status       AS ticket_status,
                sca.archived_at AS archived_at
            FROM latest l
            JOIN users u ON u.id = l.user_id
            LEFT JOIN LATERAL (
                SELECT id, subject, status
                FROM support_tickets
                WHERE user_id = l.user_id
                ORDER BY updated_at DESC
                LIMIT 1
            ) st ON TRUE
            LEFT JOIN support_conversation_archives sca ON sca.user_id = l.user_id
            WHERE sca.archived_at IS NULL
               OR l.created_at > sca.archived_at
               OR st.status = 'open'
            ORDER BY l.created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall() or []
    return {
        "count": len(rows),
        "items": [
            {
                "user_id": r["user_id"],
                "phone_e164": r["phone_e164"],
                "full_name": r.get("full_name"),
                "last_message": r["last_message"],
                "last_from": r["last_from"],
                "last_at": r["last_at"].isoformat(),
                "ticket_id": r.get("ticket_id"),
                "ticket_subject": r.get("ticket_subject"),
                "ticket_status": r.get("ticket_status"),
            }
            for r in rows
        ],
    }


@router.get("/support/conversations/{user_id}")
async def get_conversation(
    user_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Historique complet d'un utilisateur (chat + tickets mélangés)."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT phone_e164, profile->>'full_name' AS full_name FROM users WHERE id = %s",
            (user_id,),
        )
        user = cur.fetchone()
        cur.execute(
            """
            SELECT from_role, author_name, body, created_at
            FROM support_messages
            WHERE user_id = %s
            ORDER BY created_at ASC
            """,
            (user_id,),
        )
        msgs = cur.fetchall() or []
        cur.execute(
            "SELECT id, subject, status FROM support_tickets WHERE user_id = %s ORDER BY updated_at DESC LIMIT 1",
            (user_id,),
        )
        ticket = cur.fetchone()
    return {
        "user_id": user_id,
        "phone_e164": user["phone_e164"] if user else user_id,
        "full_name": user.get("full_name") if user else None,
        "ticket": {"id": ticket["id"], "subject": ticket["subject"], "status": ticket["status"]} if ticket else None,
        "messages": [
            {"from": m["from_role"], "name": m["author_name"], "text": m["body"], "ts": m["created_at"].isoformat()}
            for m in msgs
        ],
    }


class ConversationReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    author_name: str = Field(default="Support Kobo", max_length=80)
    close_ticket: bool = False


@router.post("/support/conversations/{user_id}/reply")
async def reply_conversation(
    user_id: str,
    body: ConversationReplyRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Répond à un utilisateur (chat direct ou ticket, même endpoint)."""
    _require_admin(x_admin_token)
    msg_id = f"msg_{uuid.uuid4().hex[:14]}"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO support_messages (id, user_id, from_role, author_name, body, created_at) VALUES (%s,%s,'agent',%s,%s,%s)",
            (msg_id, user_id, body.author_name, body.message, utcnow()),
        )
        if body.close_ticket:
            cur.execute(
                "UPDATE support_tickets SET status='closed', updated_at=%s WHERE user_id=%s AND status='open'",
                (utcnow(), user_id),
            )
        conn.commit()
    try:
        create_notification(
            user_id,
            "ticket_reply",
            "Réponse du support 💬",
            body.message[:120] + ("…" if len(body.message) > 120 else ""),
            {"from": body.author_name},
        )
    except Exception:
        pass
    return {"ok": True, "user_id": user_id}


@router.post("/support/conversations/{user_id}/close")
async def close_conversation_ticket(
    user_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Ferme les tickets ouverts d'un utilisateur sans ajouter de réponse support."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS support_conversation_archives (
                user_id TEXT PRIMARY KEY,
                archived_at TIMESTAMPTZ NOT NULL
            )
            """
        )
        cur.execute(
            "UPDATE support_tickets SET status='closed', updated_at=%s WHERE user_id=%s AND status='open'",
            (utcnow(), user_id),
        )
        closed = cur.rowcount
        cur.execute(
            """
            INSERT INTO support_conversation_archives (user_id, archived_at)
            VALUES (%s, %s)
            ON CONFLICT (user_id) DO UPDATE SET archived_at = EXCLUDED.archived_at
            """,
            (user_id, utcnow()),
        )
        conn.commit()
    return {"ok": True, "user_id": user_id, "closed": closed, "archived": True}


# ── Crypto deposits (paiements manuels) ──────────────────────────────────────

@router.get("/crypto/deposits")
async def list_crypto_deposits(
    status: str | None = None,
    limit: int = 100,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Liste les dépôts crypto. Filtre par status: pending|submitted|confirmed|rejected"""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if status:
            cur.execute(
                """SELECT d.*, u.phone_e164 FROM crypto_deposits d
                   JOIN users u ON u.id = d.user_id
                   WHERE d.status = %s ORDER BY d.created_at DESC LIMIT %s""",
                (status, limit),
            )
        else:
            cur.execute(
                """SELECT d.*, u.phone_e164 FROM crypto_deposits d
                   JOIN users u ON u.id = d.user_id
                   ORDER BY d.created_at DESC LIMIT %s""",
                (limit,),
            )
        rows = cur.fetchall() or []
    return {
        "count": len(rows),
        "items": [
            {
                "deposit_id": r["id"], "user_id": r["user_id"], "phone_e164": r["phone_e164"],
                "status": r["status"], "amount_usdt": float(r["amount_usdt"]),
                "amount_xaf": float(r["amount_xaf"]), "network": r["network"],
                "tx_hash": r.get("tx_hash") or None, "note": r.get("note") or "",
                "reject_reason": r.get("reject_reason") or None,
                "created_at": r["created_at"].isoformat(), "updated_at": r["updated_at"].isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/crypto/chain-events")
async def list_crypto_chain_events(
    status: str | None = None,
    limit: int = 100,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Journal on-chain USDT TRC20 détecté par le scanner automatique."""
    _require_admin(x_admin_token)
    limit = max(1, min(int(limit or 100), 500))
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if status:
            cur.execute(
                """SELECT * FROM crypto_chain_events
                   WHERE status=%s
                   ORDER BY created_at DESC
                   LIMIT %s""",
                (status, limit),
            )
        else:
            cur.execute(
                """SELECT * FROM crypto_chain_events
                   ORDER BY created_at DESC
                   LIMIT %s""",
                (limit,),
            )
        rows = cur.fetchall() or []
        cur.execute(
            """
            SELECT status, COUNT(*) AS count, COALESCE(SUM(amount_usdt),0) AS amount_usdt
            FROM crypto_chain_events
            GROUP BY status
            ORDER BY status
            """
        )
        summary = cur.fetchall() or []
        cur.execute(
            """SELECT *
               FROM crypto_scan_runs
               ORDER BY created_at DESC
               LIMIT 20"""
        )
        runs = cur.fetchall() or []
    return {
        "items": [
            {
                "id": r["id"],
                "network": r["network"],
                "tx_hash": r["tx_hash"],
                "from_address": r["from_address"],
                "to_address": r["to_address"],
                "amount_usdt": float(r["amount_usdt"] or 0),
                "confirmations": int(r["confirmations"] or 0),
                "status": r["status"],
                "match_type": r["match_type"],
                "matched_table": r["matched_table"],
                "matched_id": r["matched_id"],
                "reason": r["reason"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
            }
            for r in rows
        ],
        "summary": [
            {"status": r["status"], "count": int(r["count"] or 0), "amount_usdt": float(r["amount_usdt"] or 0)}
            for r in summary
        ],
        "runs": [
            {
                "id": r["id"],
                "wallet_address": r["wallet_address"],
                "status": r["status"],
                "checked": int(r["checked"] or 0),
                "matched": int(r["matched"] or 0),
                "credited": int(r["credited"] or 0),
                "failed": int(r["failed"] or 0),
                "message": r["message"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in runs
        ],
    }


@router.post("/crypto/reconcile")
async def trigger_crypto_reconcile(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Déclenche immédiatement le scanner blockchain crypto."""
    _require_admin(x_admin_token)
    result = reconcile_crypto_deposits()
    record_audit(
        action="trigger_crypto_reconcile",
        resource="crypto",
        actor=_get_actor_email(x_admin_token),
        details=result,
    )
    return {"ok": True, "result": result}


class CryptoConfirmRequest(BaseModel):
    note: str | None = Field(default=None, max_length=240)


class CryptoRejectRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=240)


@router.post("/crypto/deposits/{deposit_id}/confirm")
async def confirm_crypto_deposit(
    deposit_id: str,
    req: CryptoConfirmRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Admin confirme → crédite le wallet FCFA de l'utilisateur."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM crypto_deposits WHERE id = %s", (deposit_id,))
        dep = cur.fetchone()
        if not dep:
            raise HTTPException(status_code=404, detail="Dépôt introuvable")
        if dep["status"] == "confirmed":
            raise HTTPException(status_code=409, detail="Déjà confirmé")
        if dep["status"] == "rejected":
            raise HTTPException(status_code=409, detail="Dépôt rejeté, impossible de confirmer")
        user_id = dep["user_id"]
        amount_xaf = dep["amount_xaf"]
        # Créditer le wallet FCFA
        cur.execute(
            """INSERT INTO wallet_accounts (user_id, currency, balance, address, metadata, created_at, updated_at)
               VALUES (%s,'FCFA',%s,NULL,'{}'::jsonb,NOW(),NOW())
               ON CONFLICT (user_id, currency)
               DO UPDATE SET balance = wallet_accounts.balance + EXCLUDED.balance, updated_at = NOW()""",
            (user_id, amount_xaf),
        )
        tx_id = f"tx_{uuid.uuid4().hex[:16]}"
        cur.execute(
            """INSERT INTO wallet_transactions
               (id,user_id,direction,category,label,counterpart,amount,currency,status,metadata,created_at)
               VALUES (%s,%s,'credit','crypto_deposit','Dépôt crypto USDT',%s,%s,'FCFA','completed',%s,NOW())""",
            (tx_id, user_id, dep.get("tx_hash") or "crypto", amount_xaf,
             Json({"deposit_id": deposit_id, "network": dep["network"], "tx_hash": dep.get("tx_hash") or ""})),
        )
        cur.execute(
            "UPDATE crypto_deposits SET status='confirmed', updated_at=%s WHERE id=%s",
            (utcnow(), deposit_id),
        )
        conn.commit()
    try:
        create_notification(
            user_id,
            "deposit_confirmed",
            "Dépôt confirmé",
            f"Votre dépôt de {float(amount_xaf):,.0f} FCFA a été confirmé et crédité sur votre compte.",
            {"deposit_id": deposit_id, "amount_xaf": float(amount_xaf)},
        )
        notify_user(
            user_id,
            "Dépôt crypto confirmé",
            f"Votre dépôt crypto a été <b>confirmé et crédité</b> sur votre portefeuille Kobo.<br><br>"
            f"<b>Montant crédité :</b> {float(amount_xaf):,.0f} FCFA<br>"
            f"<b>Réseau :</b> {dep.get('network', '')}<br>"
            f"<b>Référence :</b> {deposit_id}",
            success=True,
        )
    except Exception:
        pass
    return {"ok": True, "deposit_id": deposit_id, "status": "confirmed", "credited_xaf": float(amount_xaf), "transaction_id": tx_id}


@router.post("/crypto/deposits/{deposit_id}/reject")
async def reject_crypto_deposit(
    deposit_id: str,
    req: CryptoRejectRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Admin rejette le dépôt avec une raison."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT status, user_id, network FROM crypto_deposits WHERE id = %s", (deposit_id,))
        dep = cur.fetchone()
        if not dep:
            raise HTTPException(status_code=404, detail="Dépôt introuvable")
        if dep["status"] in ("confirmed", "rejected"):
            raise HTTPException(status_code=409, detail=f"Déjà en statut '{dep['status']}'")
        cur.execute(
            "UPDATE crypto_deposits SET status='rejected', reject_reason=%s, updated_at=%s WHERE id=%s",
            (req.reason, utcnow(), deposit_id),
        )
        uid = dep["user_id"]
        conn.commit()
    try:
        create_notification(
            uid,
            "deposit_rejected",
            "Dépôt rejeté",
            f"Votre dépôt a été rejeté. Motif : {req.reason}",
            {"deposit_id": deposit_id},
        )
        notify_user(
            uid,
            "Dépôt crypto refusé",
            f"Votre dépôt crypto a été <b>refusé</b>.<br><br>"
            f"<b>Motif :</b> {req.reason}<br>"
            f"<b>Réseau :</b> {dep.get('network', '')}<br><br>"
            f"Si vous pensez qu'il s'agit d'une erreur, contactez le support avec la référence : {deposit_id}",
            success=False,
        )
    except Exception:
        pass
    return {"ok": True, "deposit_id": deposit_id, "status": "rejected", "reason": req.reason}


# ── Admin : retraits crypto ───────────────────────────────────────────────────

class WithdrawalCompleteRequest(BaseModel):
    tx_hash: str = Field(min_length=10, max_length=128)


class WithdrawalRejectRequest(BaseModel):
    reason: str = Field(min_length=2, max_length=400)


@router.get("/crypto/withdrawals")
async def list_crypto_withdrawals(
    status: str | None = None,
    limit: int = 100,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Liste les retraits crypto. Filtre: pending|completed|rejected"""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if status:
            cur.execute(
                """SELECT w.*, u.phone_e164, u.email FROM crypto_withdrawals w
                   JOIN users u ON u.id = w.user_id
                   WHERE w.status = %s ORDER BY w.created_at DESC LIMIT %s""",
                (status, limit),
            )
        else:
            cur.execute(
                """SELECT w.*, u.phone_e164, u.email FROM crypto_withdrawals w
                   JOIN users u ON u.id = w.user_id
                   ORDER BY w.created_at DESC LIMIT %s""",
                (limit,),
            )
        rows = cur.fetchall() or []
    return {
        "count": len(rows),
        "items": [
            {
                "withdrawal_id": r["id"],
                "user_id": r["user_id"],
                "user_email": r.get("email") or r.get("phone_e164") or "",
                "status": r["status"],
                "amount_usdt": float(r["amount_usdt"]),
                "amount_xaf": float(r["amount_xaf"]),
                "network": r["network"],
                "destination_address": r["destination_address"],
                "tx_hash": r.get("tx_hash"),
                "note": r.get("note") or "",
                "reject_reason": r.get("reject_reason"),
                "created_at": r["created_at"].isoformat(),
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in rows
        ],
    }


@router.post("/crypto/withdrawals/{withdrawal_id}/complete")
async def complete_crypto_withdrawal(
    withdrawal_id: str,
    req: WithdrawalCompleteRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Admin marque le retrait comme envoyé avec le hash TX."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM crypto_withdrawals WHERE id = %s", (withdrawal_id,))
        w = cur.fetchone()
        if not w:
            raise HTTPException(status_code=404, detail="Retrait introuvable")
        if w["status"] != "pending":
            raise HTTPException(status_code=409, detail=f"Statut actuel: {w['status']}")
        cur.execute(
            """UPDATE crypto_withdrawals SET status='completed', tx_hash=%s, updated_at=%s WHERE id=%s""",
            (req.tx_hash, utcnow(), withdrawal_id),
        )
        # Mettre à jour la transaction wallet correspondante
        cur.execute(
            """UPDATE wallet_transactions SET status='completed'
               WHERE user_id=%s AND category='crypto_withdraw'
               AND metadata->>'withdrawal_id'=%s""",
            (w["user_id"], withdrawal_id),
        )
        conn.commit()
    try:
        create_notification(
            w["user_id"],
            "withdrawal_completed",
            "Retrait effectué",
            f"Votre retrait de {float(w['amount_usdt']):.2f} USDT a été envoyé. Hash : {req.tx_hash[:16]}…",
            {"withdrawal_id": withdrawal_id, "tx_hash": req.tx_hash},
        )
        notify_user(
            w["user_id"],
            "Retrait crypto envoyé",
            f"Votre retrait crypto a été <b>envoyé avec succès</b>.<br><br>"
            f"<b>Montant :</b> {float(w['amount_usdt']):.4f} USDT<br>"
            f"<b>Réseau :</b> {w.get('network', '')}<br>"
            f"<b>Adresse :</b> {str(w.get('destination_address', ''))[:20]}…<br>"
            f"<b>Hash TX :</b> {req.tx_hash[:20]}…",
            success=True,
        )
    except Exception:
        pass
    return {"ok": True, "withdrawal_id": withdrawal_id, "status": "completed", "tx_hash": req.tx_hash}


@router.post("/crypto/withdrawals/{withdrawal_id}/reject")
async def reject_crypto_withdrawal(
    withdrawal_id: str,
    req: WithdrawalRejectRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Admin rejette le retrait et rembourse le solde FCFA."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM crypto_withdrawals WHERE id = %s", (withdrawal_id,))
        w = cur.fetchone()
        if not w:
            raise HTTPException(status_code=404, detail="Retrait introuvable")
        if w["status"] != "pending":
            raise HTTPException(status_code=409, detail=f"Statut actuel: {w['status']}")
        # Rembourser le solde FCFA
        cur.execute(
            "UPDATE wallet_accounts SET balance = balance + %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
            (w["amount_xaf"], utcnow(), w["user_id"]),
        )
        cur.execute(
            "UPDATE crypto_withdrawals SET status='rejected', reject_reason=%s, updated_at=%s WHERE id=%s",
            (req.reason, utcnow(), withdrawal_id),
        )
        cur.execute(
            "UPDATE wallet_transactions SET status='failed' WHERE user_id=%s AND category='crypto_withdraw' AND metadata->>'withdrawal_id'=%s",
            (w["user_id"], withdrawal_id),
        )
        conn.commit()
    try:
        create_notification(
            w["user_id"],
            "withdrawal_rejected",
            "Retrait rejeté",
            f"Votre retrait de {float(w['amount_usdt']):.2f} USDT a été rejeté. Motif : {req.reason}. Votre solde a été remboursé.",
            {"withdrawal_id": withdrawal_id},
        )
        notify_user(
            w["user_id"],
            "Retrait crypto refusé",
            f"Votre demande de retrait crypto a été <b>refusée</b>.<br><br>"
            f"<b>Montant :</b> {float(w['amount_usdt']):.4f} USDT<br>"
            f"<b>Motif :</b> {req.reason}<br><br>"
            f"Votre solde FCFA a été remboursé automatiquement.",
            success=False,
        )
    except Exception:
        pass
    return {"ok": True, "withdrawal_id": withdrawal_id, "status": "rejected", "refunded_xaf": float(w["amount_xaf"])}


# ── Admin : wallets crypto ────────────────────────────────────────────────────

class WalletCreateRequest(BaseModel):
    network: str = Field(min_length=2, max_length=16)
    address: str = Field(min_length=10, max_length=128)
    label: str = Field(default="", max_length=80)
    explorer_url_prefix: str = Field(default="", max_length=200)
    active: bool = True


class WalletUpdateRequest(BaseModel):
    address: str | None = Field(default=None, min_length=10, max_length=128)
    label: str | None = Field(default=None, max_length=80)
    explorer_url_prefix: str | None = Field(default=None, max_length=200)
    active: bool | None = None


@router.get("/crypto/wallets")
async def list_admin_wallets(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM crypto_wallets ORDER BY network")
        rows = cur.fetchall() or []
    return {
        "items": [
            {
                "id": r["id"],
                "network": r["network"],
                "address": r["address"],
                "label": r.get("label") or "",
                "explorer_url_prefix": r.get("explorer_url_prefix") or "",
                "active": r["active"],
                "created_at": r["created_at"].isoformat(),
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/crypto/wallets")
async def create_admin_wallet(
    req: WalletCreateRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    wallet_id = f"cw_{uuid.uuid4().hex[:16]}"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """INSERT INTO crypto_wallets (id, network, address, label, explorer_url_prefix, active, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (wallet_id, req.network.upper(), req.address, req.label, req.explorer_url_prefix, req.active, utcnow(), utcnow()),
            )
            conn.commit()
        except Exception as e:
            if "unique" in str(e).lower():
                raise HTTPException(status_code=409, detail=f"Réseau {req.network} existe déjà")
            raise
    return {"ok": True, "id": wallet_id, "network": req.network.upper()}


@router.put("/crypto/wallets/{wallet_id}")
async def update_admin_wallet(
    wallet_id: str,
    req: WalletUpdateRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    fields: list[str] = ["updated_at = %s"]
    values: list[Any] = [utcnow()]
    if req.address is not None:
        fields.append("address = %s")
        values.append(req.address)
    if req.label is not None:
        fields.append("label = %s")
        values.append(req.label)
    if req.explorer_url_prefix is not None:
        fields.append("explorer_url_prefix = %s")
        values.append(req.explorer_url_prefix)
    if req.active is not None:
        fields.append("active = %s")
        values.append(req.active)
    values.append(wallet_id)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE crypto_wallets SET {', '.join(fields)} WHERE id = %s", values)
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Wallet introuvable")
        conn.commit()
    return {"ok": True, "id": wallet_id}


@router.delete("/crypto/wallets/{wallet_id}")
async def delete_admin_wallet(
    wallet_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM crypto_wallets WHERE id = %s", (wallet_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Wallet introuvable")
        conn.commit()
    return {"ok": True, "deleted": wallet_id}


# ── Retraits Mobile Money & Virements bancaires ───────────────────────────────

@router.get("/withdrawals")
async def list_wallet_withdrawals(
    status: str | None = None,
    provider: str | None = None,
    limit: int = 100,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Liste les retraits MTN/Orange/bank depuis wallet_transactions."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        filters = ["t.category = 'withdraw'", "t.direction = 'debit'"]
        params: list[Any] = []
        if status:
            filters.append("t.status = %s")
            params.append(status)
        if provider:
            filters.append("t.metadata->>'provider' = %s")
            params.append(provider)
        params.append(limit)
        where = " AND ".join(filters)
        cur.execute(
            f"""SELECT t.*, u.email, u.profile->>'full_name' AS full_name
                FROM wallet_transactions t
                LEFT JOIN users u ON u.id = t.user_id
                WHERE {where}
                ORDER BY t.created_at DESC LIMIT %s""",
            params,
        )
        rows = cur.fetchall() or []

    items = []
    for r in rows:
        meta = r.get("metadata") or {}
        items.append({
            "id": r["id"],
            "user_id": r["user_id"],
            "user_email": r.get("email"),
            "user_name": r.get("full_name"),
            "provider": meta.get("provider", r.get("label", "")),
            "amount": float(r["amount"]),
            "currency": r["currency"],
            "counterpart": r["counterpart"],
            "status": r["status"],
            "iban": meta.get("iban"),
            "bank_name": meta.get("bankName"),
            "momo": meta.get("momo"),
            "notchpay_ref": meta.get("notchpay_ref"),
            "created_at": r["created_at"].isoformat(),
        })
    return {"count": len(items), "items": items}


@router.post("/withdrawals/{tx_id}/complete")
async def complete_wallet_withdrawal(
    tx_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Marquer un virement bancaire comme traité (admin a envoyé les fonds)."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM wallet_transactions WHERE id = %s AND category = 'withdraw'", (tx_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction introuvable")
        if tx["status"] not in ("pending", "processing"):
            raise HTTPException(status_code=400, detail=f"Statut actuel '{tx['status']}' non modifiable")
        cur.execute("UPDATE wallet_transactions SET status = 'completed' WHERE id = %s", (tx_id,))
        conn.commit()
    return {"ok": True, "transaction_id": tx_id, "status": "completed"}


@router.post("/withdrawals/{tx_id}/reject")
async def reject_wallet_withdrawal(
    tx_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Rejeter un retrait de la catégorie 'withdraw' (route legacy désactivée).

    IMPORTANT : la route /withdraw ne déduisait jamais wallet_accounts.balance.
    Ce endpoint est conservé pour compatibilité mais N'ÉMET PLUS de remboursement
    car il n'y a rien à rembourser (le débit n'a jamais eu lieu).
    Pour les vrais retraits fiat, utiliser /admin/fiat-withdrawals/{id}/reject.
    """
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM wallet_transactions WHERE id = %s AND category = 'withdraw'", (tx_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction introuvable")
        if tx["status"] not in ("pending", "processing"):
            raise HTTPException(status_code=400, detail=f"Statut actuel '{tx['status']}' non modifiable")
        # NE PAS créditer le solde : la route /withdraw n'a jamais débité wallet_accounts.balance.
        # Émettre un remboursement ici créerait de l'argent fictif (bug confirmé sur compte Nem).
        cur.execute("UPDATE wallet_transactions SET status = 'cancelled' WHERE id = %s", (tx_id,))
        conn.commit()
    return {"ok": True, "transaction_id": tx_id, "status": "cancelled", "refunded": 0}


# ── Paramètres ────────────────────────────────────────────────────────────────

# Default fee schedule — all amounts in FCFA or % as indicated
_DEFAULT_FEES: dict[str, Any] = {
    "p2p_transfer":              {"type": "percent", "rate": 1.5,  "min_fcfa": 100,  "min_amount_fcfa": 100, "label": "Transfert P2P"},
    "mobile_money_withdrawal":   {"type": "percent", "rate": 1.5,  "min_fcfa": 100,  "min_amount_fcfa": 500, "label": "Retrait Mobile Money (MTN/Orange)"},
    "mobile_money_bridge":       {"type": "percent", "rate": 0.0,  "min_fcfa": 0,    "min_amount_fcfa": 100, "label": "Transfert direct MTN/Orange"},
    "bank_withdrawal_eur":       {"type": "flat",    "amount": 5,  "currency": "EUR", "min_amount_fcfa": 500, "label": "Retrait virement EUR"},
    "bank_withdrawal_usd":       {"type": "flat",    "amount": 5,  "currency": "USD", "min_amount_fcfa": 500, "label": "Retrait virement USD"},
    "bank_withdrawal_fcfa":      {"type": "percent", "rate": 2.0,  "min_fcfa": 500,  "min_amount_fcfa": 500, "label": "Retrait virement FCFA"},
    "fiat_deposit":              {"type": "percent", "rate": 0.0,  "min_fcfa": 0,    "min_amount_fcfa": 100, "label": "Dépôt virement bancaire"},
    "mobile_money_deposit":      {"type": "percent", "rate": 0.0,  "min_fcfa": 0,    "min_amount_fcfa": 100, "label": "Dépôt Mobile Money"},
    "crypto_deposit_usdt":       {"type": "percent", "rate": 0.0,  "min_fcfa": 0,    "min_amount_fcfa": 100, "label": "Dépôt USDT"},
    "crypto_deposit_btc":        {"type": "percent", "rate": 0.0,  "min_fcfa": 0,    "min_amount_fcfa": 100, "label": "Dépôt BTC"},
    "crypto_withdrawal_usdt":    {"type": "flat",    "amount": 1,  "currency": "USDT", "min_amount_fcfa": 100, "label": "Retrait USDT"},
    "crypto_withdrawal_btc":     {"type": "flat",    "amount": 0.00005, "currency": "BTC", "min_amount_fcfa": 100, "label": "Retrait BTC"},
    "intl_transfer_spread":      {"type": "percent", "rate": 2.5,  "min_fcfa": 0,    "min_amount_fcfa": 100, "label": "Transfert international (spread)"},
    "api_payment":               {"type": "percent", "rate": 5.0,  "min_fcfa": 0,    "min_amount_fcfa": 100, "label": "Lien de paiement API (frais Kobo)"},
    "payment_link":              {"type": "percent", "rate": 1.5,  "min_fcfa": 0,    "min_amount_fcfa": 100, "label": "Lien de paiement utilisateur"},
}


def _normalize_fee_config(cfg: dict[str, Any]) -> dict[str, Any]:
    out = dict(cfg or {})
    if "min_amount_fcfa" not in out and "min_transaction_fcfa" in out:
        out["min_amount_fcfa"] = out.get("min_transaction_fcfa")
    if "min_amount_fcfa" in out:
        try:
            out["min_amount_fcfa"] = max(0, int(out.get("min_amount_fcfa") or 0))
        except (TypeError, ValueError):
            out["min_amount_fcfa"] = 0
    if "min_fcfa" in out:
        try:
            out["min_fcfa"] = max(0, int(out.get("min_fcfa") or 0))
        except (TypeError, ValueError):
            out["min_fcfa"] = 0
    return out


# ── API publique — gestion admin ──────────────────────────────────────────────

@router.get("/api/keys/{user_id}")
async def admin_list_api_keys(
    user_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    from app.services.api_auth import list_api_keys
    return {"items": list_api_keys(user_id)}


class AdminCreateKeyReq(BaseModel):
    user_id: str
    name: str = Field(min_length=2, max_length=100)
    is_test: bool = False


@router.post("/api/keys")
async def admin_create_api_key(
    body: AdminCreateKeyReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    from app.services.api_auth import generate_api_key
    return generate_api_key(body.user_id, body.name, body.is_test)


@router.delete("/api/keys/{key_id}")
async def admin_revoke_api_key(
    key_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    from app.services.api_auth import revoke_api_key
    from app.db.session import get_conn
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE api_keys SET active=FALSE WHERE id=%s", (key_id,))
        conn.commit()
    return {"ok": True}


class AdminWebhookReq(BaseModel):
    user_id: str
    url: str = Field(min_length=10, max_length=500)
    events: list[str] | None = None


@router.post("/api/webhook")
async def admin_set_webhook(
    body: AdminWebhookReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    from app.services.webhook_delivery import register_webhook
    try:
        return register_webhook(body.user_id, body.url, body.events)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/api/webhook/{user_id}")
async def admin_get_webhook(
    user_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    from app.services.webhook_delivery import get_webhook
    ep = get_webhook(user_id)
    if not ep:
        raise HTTPException(404, "Aucun webhook")
    ep["secret"] = ep["secret"][:8] + "..." + ep["secret"][-4:]
    return ep


@router.get("/settings/fees")
async def get_fee_settings(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'fees'")
        row = cur.fetchone()
    stored = row["value"] if row else {}
    # Merge stored over defaults so new keys always appear
    result = {**_DEFAULT_FEES}
    for k, v in stored.items():
        if k in result:
            result[k] = _normalize_fee_config({**result[k], **v})
    return result


@router.put("/settings/fees")
async def update_fee_settings(
    body: dict[str, Any],
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    # Validate only known keys
    valid = {
        k: _normalize_fee_config({**_DEFAULT_FEES[k], **v})
        for k, v in body.items()
        if k in _DEFAULT_FEES
    }
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES ('fees', %s, %s)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at""",
            (Json(valid), utcnow()),
        )
        conn.commit()
    return {"ok": True, "saved": len(valid)}


@router.get("/settings/operator-fees")
async def get_operator_fee_settings(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT key, value FROM app_settings WHERE key IN ('notchpay_fee_rate', 'sharepay_fee_rate')")
        rows = cur.fetchall()
    stored = {r["key"]: r["value"] for r in rows}
    return {
        "notchpay_fee_rate": float(stored["notchpay_fee_rate"]) if "notchpay_fee_rate" in stored else 1.5,
        "sharepay_fee_rate": float(stored["sharepay_fee_rate"]) if "sharepay_fee_rate" in stored else 1.6,
    }


class OperatorFeeSettings(BaseModel):
    notchpay_fee_rate: float = Field(..., ge=0, le=10)
    sharepay_fee_rate: float = Field(..., ge=0, le=10)


@router.put("/settings/operator-fees")
async def update_operator_fee_settings(
    body: OperatorFeeSettings,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        for key, val in [("notchpay_fee_rate", body.notchpay_fee_rate), ("sharepay_fee_rate", body.sharepay_fee_rate)]:
            cur.execute(
                """INSERT INTO app_settings (key, value, updated_at)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at""",
                (key, Json(val), now),
            )
        conn.commit()
    return {"ok": True, "notchpay_fee_rate": body.notchpay_fee_rate, "sharepay_fee_rate": body.sharepay_fee_rate}


class KoboBankSettings(BaseModel):
    beneficiary: str = Field(min_length=2, max_length=120)
    iban: str = Field(max_length=60)
    bic: str = Field(max_length=20)
    bank: str = Field(min_length=2, max_length=120)


@router.get("/settings/kobo-bank")
async def get_kobo_bank_settings(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'kobo_bank'")
        row = cur.fetchone()
    if not row:
        return {}
    return row["value"]


@router.put("/settings/kobo-bank")
async def update_kobo_bank_settings(
    body: KoboBankSettings,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES ('kobo_bank', %s, %s)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at""",
            (Json(body.model_dump()), utcnow()),
        )
        conn.commit()
    return {"ok": True, **body.model_dump()}


# ── Fournisseur de paiement actif ─────────────────────────────────────────────

@router.get("/settings/payment-provider")
async def get_payment_provider_setting(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'payment_provider' LIMIT 1")
        row = cur.fetchone()
    provider = "sharepay"
    if row and isinstance(row["value"], dict):
        provider = row["value"].get("provider", "sharepay")
    return {"provider": provider}


@router.put("/settings/payment-provider")
async def set_payment_provider_setting(
    body: dict,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    provider = body.get("provider", "sharepay")
    if provider not in ("notchpay", "sharepay"):
        raise HTTPException(400, "Provider invalide : 'notchpay' ou 'sharepay'")
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES ('payment_provider', %s, %s)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at""",
            (Json({"provider": provider}), utcnow()),
        )
        conn.commit()
    return {"ok": True, "provider": provider}


@router.get("/corridors")
async def admin_list_corridors(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("""
            SELECT id, source_currency, target_currency, destination_country,
                   payout_method, fixed_fee, variable_fee_bps, min_fee, active
            FROM pricing_rules
            ORDER BY source_currency, destination_country, payout_method
        """)
        rows = cur.fetchall()
    return {"corridors": [dict(r) | {"fixed_fee": float(r["fixed_fee"]), "min_fee": float(r["min_fee"])} for r in rows]}


class CorridorCreate(BaseModel):
    source_currency: str = Field(min_length=2, max_length=10)
    target_currency: str = Field(min_length=2, max_length=10)
    destination_country: str = Field(min_length=2, max_length=4)
    payout_method: str = Field(min_length=2, max_length=40)
    fixed_fee: float = 0.0
    variable_fee_bps: int = 0
    min_fee: float = 0.0


class CorridorUpdate(BaseModel):
    fixed_fee: float | None = None
    variable_fee_bps: int | None = None
    min_fee: float | None = None
    active: bool | None = None


@router.post("/corridors")
async def admin_create_corridor(
    body: CorridorCreate,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO pricing_rules
              (source_currency, target_currency, destination_country, payout_method,
               fixed_fee, variable_fee_bps, min_fee, active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE)
            RETURNING id, source_currency, target_currency, destination_country,
                      payout_method, fixed_fee, variable_fee_bps, min_fee, active
            """,
            (
                body.source_currency.upper(),
                body.target_currency.upper(),
                body.destination_country.upper(),
                body.payout_method,
                body.fixed_fee,
                body.variable_fee_bps,
                body.min_fee,
            ),
        )
        row = cur.fetchone()
        conn.commit()
    record_audit(
        action="create_corridor",
        resource=f"pricing_rule:{row['id']}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata=dict(body.model_dump()),
    )
    return dict(row) | {"fixed_fee": float(row["fixed_fee"]), "min_fee": float(row["min_fee"])}


@router.patch("/corridors/{corridor_id}")
async def admin_update_corridor(
    corridor_id: int,
    body: CorridorUpdate,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(400, "Aucun champ à mettre à jour")
    set_clause = ", ".join(f"{k} = %s" for k in fields)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            f"UPDATE pricing_rules SET {set_clause} WHERE id = %s RETURNING id, source_currency, target_currency, destination_country, payout_method, fixed_fee, variable_fee_bps, min_fee, active",
            [*fields.values(), corridor_id],
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Corridor introuvable")
        conn.commit()
    record_audit(
        action="update_corridor",
        resource=f"pricing_rule:{corridor_id}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata=fields,
    )
    return dict(row) | {"fixed_fee": float(row["fixed_fee"]), "min_fee": float(row["min_fee"])}


@router.delete("/corridors/{corridor_id}")
async def admin_delete_corridor(
    corridor_id: int,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM pricing_rules WHERE id = %s RETURNING id", (corridor_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Corridor introuvable")
        conn.commit()
    record_audit(
        action="delete_corridor",
        resource=f"pricing_rule:{corridor_id}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={},
    )
    return {"ok": True, "id": corridor_id}


@router.patch("/corridors/{corridor_id}/toggle")
async def admin_toggle_corridor(
    corridor_id: int,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id, active FROM pricing_rules WHERE id=%s LIMIT 1", (corridor_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Corridor introuvable")
        new_active = not row["active"]
        cur.execute("UPDATE pricing_rules SET active=%s WHERE id=%s", (new_active, corridor_id))
        conn.commit()
    record_audit(
        action="toggle_corridor",
        resource=f"pricing_rule:{corridor_id}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"active": new_active},
    )
    return {"ok": True, "id": corridor_id, "active": new_active}


# ── Country compliance rules ───────────────────────────────────────────────────

DEFAULT_COMPLIANCE_RULES: list[dict[str, Any]] = [
    {
        "country": "CA", "name": "Canada", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 3000000, "daily_limit_fcfa": 6000000, "monthly_limit_fcfa": 30000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 1000000, "reporting_threshold_fcfa": 4000000,
        "notes": "Verifier exposition MSB/FMSB FINTRAC, RPAA/Bank of Canada, sanctions et declarations crypto importantes.",
    },
    {
        "country": "US", "name": "United States", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 3000000, "daily_limit_fcfa": 6000000, "monthly_limit_fcfa": 30000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 1000000, "reporting_threshold_fcfa": 4000000,
        "notes": "Verifier FinCEN MSB, licences money transmitter par Etat et OFAC.",
    },
    {
        "country": "CM", "name": "Cameroun", "status": "active", "kyc_min_level": 1,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 500000, "reporting_threshold_fcfa": 5000000,
        "notes": "Regles CEMAC/BEAC/AML a confirmer par conseil local.",
    },
]


class ComplianceRuleReq(BaseModel):
    country: str = Field(min_length=2, max_length=4)
    name: str = ""
    status: str = "manual_review"
    kyc_min_level: int = 1
    single_limit_fcfa: Decimal = Decimal("0")
    daily_limit_fcfa: Decimal = Decimal("0")
    monthly_limit_fcfa: Decimal = Decimal("0")
    crypto_allowed: bool = True
    fiat_allowed: bool = True
    p2p_allowed: bool = True
    intl_allowed: bool = True
    manual_review_above_fcfa: Decimal = Decimal("0")
    reporting_threshold_fcfa: Decimal = Decimal("0")
    notes: str = ""


class ComplianceEvaluateReq(BaseModel):
    country: str
    amount_fcfa: Decimal = Decimal("0")
    flow: str = "intl"
    kyc_level: int = 0


def _normalize_compliance_rule(rule: dict[str, Any]) -> dict[str, Any]:
    out = dict(rule)
    out["country"] = str(out.get("country", "")).upper()
    out["status"] = out.get("status") or "manual_review"
    out["kyc_min_level"] = int(out.get("kyc_min_level") or 0)
    for key in ("single_limit_fcfa", "daily_limit_fcfa", "monthly_limit_fcfa", "manual_review_above_fcfa", "reporting_threshold_fcfa"):
        out[key] = float(out.get(key) or 0)
    for key in ("crypto_allowed", "fiat_allowed", "p2p_allowed", "intl_allowed"):
        out[key] = bool(out.get(key, True))
    return out


def _load_compliance_rules(cur: psycopg.Cursor) -> list[dict[str, Any]]:
    cur.execute("SELECT value FROM app_settings WHERE key='country_compliance_rules' LIMIT 1")
    row = cur.fetchone()
    rules = row[0] if row and row[0] else DEFAULT_COMPLIANCE_RULES
    if not isinstance(rules, list):
        rules = DEFAULT_COMPLIANCE_RULES
    return [_normalize_compliance_rule(r) for r in rules]


def _save_compliance_rules(cur: psycopg.Cursor, rules: list[dict[str, Any]]) -> None:
    cur.execute(
        """INSERT INTO app_settings (key, value, updated_at)
           VALUES ('country_compliance_rules', %s, %s)
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at""",
        (Json(rules), utcnow()),
    )


def _evaluate_compliance(rule: dict[str, Any] | None, body: ComplianceEvaluateReq) -> dict[str, Any]:
    if not rule:
        return {"decision": "require_manual_review", "reasons": ["country_rule_missing"], "rule": None}
    amount = Decimal(str(body.amount_fcfa or 0))
    flow_key = f"{body.flow}_allowed"
    reasons: list[str] = []
    if rule.get("status") == "blocked":
        reasons.append("country_blocked")
    if rule.get("status") == "manual_review":
        reasons.append("country_manual_review")
    if flow_key in rule and not rule.get(flow_key, True):
        reasons.append(f"{body.flow}_not_allowed")
    if int(body.kyc_level or 0) < int(rule.get("kyc_min_level") or 0):
        reasons.append("kyc_upgrade_required")
    if Decimal(str(rule.get("single_limit_fcfa") or 0)) > 0 and amount > Decimal(str(rule.get("single_limit_fcfa") or 0)):
        reasons.append("single_limit_exceeded")
    if Decimal(str(rule.get("manual_review_above_fcfa") or 0)) > 0 and amount >= Decimal(str(rule.get("manual_review_above_fcfa") or 0)):
        reasons.append("amount_manual_review")
    if Decimal(str(rule.get("reporting_threshold_fcfa") or 0)) > 0 and amount >= Decimal(str(rule.get("reporting_threshold_fcfa") or 0)):
        reasons.append("reporting_required")

    if "country_blocked" in reasons or "single_limit_exceeded" in reasons or f"{body.flow}_not_allowed" in reasons:
        decision = "block"
    elif "kyc_upgrade_required" in reasons:
        decision = "require_kyc_upgrade"
    elif reasons:
        decision = "allow_with_review"
    else:
        decision = "allow"
    return {"decision": decision, "reasons": reasons, "rule": rule}


@router.get("/compliance/rules")
async def list_compliance_rules(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        rules = _load_compliance_rules(cur)
    return {"items": rules}


@router.put("/compliance/rules")
async def upsert_compliance_rule(
    body: ComplianceRuleReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    rule = _normalize_compliance_rule(body.model_dump())
    if rule["status"] not in ("active", "manual_review", "blocked"):
        raise HTTPException(400, "status doit etre active, manual_review ou blocked")
    with closing(get_conn()) as conn, conn.cursor() as cur:
        rules = [r for r in _load_compliance_rules(cur) if r["country"] != rule["country"]]
        rules.append(rule)
        rules.sort(key=lambda r: r["country"])
        _save_compliance_rules(cur, rules)
        conn.commit()
    record_audit(action="upsert_compliance_rule", resource=f"country:{rule['country']}", actor_identifier=_get_actor_email(x_admin_token), metadata=rule)
    return {"ok": True, "rule": rule}


@router.post("/compliance/evaluate")
async def evaluate_compliance_rule(
    body: ComplianceEvaluateReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        rules = _load_compliance_rules(cur)
    rule = next((r for r in rules if r["country"] == body.country.upper()), None)
    return _evaluate_compliance(rule, body)


@router.get("/settings/withdrawal-threshold")
async def get_withdrawal_threshold(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'withdrawal_approval_threshold' LIMIT 1")
        row = cur.fetchone()
    threshold = 10000
    if row and isinstance(row["value"], dict):
        threshold = row["value"].get("amount_fcfa", 10000)
    return {"amount_fcfa": threshold}


@router.put("/settings/withdrawal-threshold")
async def set_withdrawal_threshold(
    body: dict,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    amount = body.get("amount_fcfa")
    if amount is None or not isinstance(amount, (int, float)) or amount < 0:
        raise HTTPException(400, "amount_fcfa doit être un nombre positif (0 = désactiver l'approbation)")
    amount = int(amount)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES ('withdrawal_approval_threshold', %s, %s)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at""",
            (Json({"amount_fcfa": amount}), utcnow()),
        )
        conn.commit()
    record_audit(
        action="update_withdrawal_threshold",
        resource="settings:withdrawal_approval_threshold",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"amount_fcfa": amount},
    )
    return {"ok": True, "amount_fcfa": amount}


# ── Disponibilité des services ────────────────────────────────────────────────

_SERVICE_STATUS_DEFAULTS: dict[str, Any] = {
    "withdrawals_enabled": True,
    "deposits_enabled": True,
    "withdrawals_message": "",
    "deposits_message": "",
}


@router.get("/settings/service-status")
async def get_service_status_setting(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'service_status' LIMIT 1")
        row = cur.fetchone()
    if row and isinstance(row["value"], dict):
        return {**_SERVICE_STATUS_DEFAULTS, **row["value"]}
    return {**_SERVICE_STATUS_DEFAULTS}


@router.put("/settings/service-status")
async def set_service_status_setting(
    body: dict,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    patch = {**_SERVICE_STATUS_DEFAULTS}
    if "withdrawals_enabled" in body:
        patch["withdrawals_enabled"] = bool(body["withdrawals_enabled"])
    if "deposits_enabled" in body:
        patch["deposits_enabled"] = bool(body["deposits_enabled"])
    if "withdrawals_message" in body:
        patch["withdrawals_message"] = str(body.get("withdrawals_message") or "")[:500]
    if "deposits_message" in body:
        patch["deposits_message"] = str(body.get("deposits_message") or "")[:500]
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'service_status' LIMIT 1")
        existing = cur.fetchone()
        current = {**_SERVICE_STATUS_DEFAULTS}
        if existing and isinstance(existing["value"], dict):
            current.update(existing["value"])
        current.update(patch)
        cur.execute(
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES ('service_status', %s, %s)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at""",
            (Json(current), utcnow()),
        )
        conn.commit()
    record_audit(
        action="update_service_status",
        resource="settings:service_status",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata=current,
    )
    return {"ok": True, **current}


# ── Transferts Internationaux ─────────────────────────────────────────────────

@router.get("/intl-transfers")
async def list_intl_transfers(
    status: str | None = None,
    limit: int = 100,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Liste les transferts internationaux (corridors EUR/USD/GBP/XAF)."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if status:
            cur.execute(
                "SELECT * FROM transfers WHERE status = %s ORDER BY created_at DESC LIMIT %s",
                (status, limit),
            )
        else:
            cur.execute(
                "SELECT * FROM transfers ORDER BY created_at DESC LIMIT %s", (limit,)
            )
        rows = cur.fetchall() or []

    items = []
    for r in rows:
        sender = r.get("sender") or {}
        recipient = r.get("recipient") or {}
        items.append({
            "id": r["id"],
            "user_id": r.get("user_id") or sender.get("user_id"),
            "sender_name": sender.get("name"),
            "sender_phone": sender.get("phone"),
            "recipient_name": recipient.get("name"),
            "recipient_phone": recipient.get("phone"),
            "source_currency": r["source_currency"],
            "target_currency": r["target_currency"],
            "source_amount": float(r["source_amount"]),
            "target_amount": float(r["target_amount"]),
            "fees_amount": float(r["fees_amount"]),
            "funding_method": r["funding_method"],
            "payment_status": r["payment_status"],
            "settlement_status": r["settlement_status"],
            "status": r["status"],
            "created_at": r["created_at"].isoformat(),
        })
    return {"count": len(items), "items": items}


KOBO_USDT_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"


@router.get("/intl-transfers/{transfer_id}/scan-usdt")
async def scan_usdt_for_transfer(
    transfer_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Interroge TronScan pour trouver des paiements USDT entrants correspondant à ce transfert."""
    _require_admin(x_admin_token)
    from app.services.blockchain_verify import scan_trc20_incoming
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id=%s LIMIT 1", (transfer_id,))
        tx = cur.fetchone()
    if not tx:
        raise HTTPException(404, "Transfert introuvable")
    if tx.get("funding_method") != "usdt":
        raise HTTPException(400, "Ce transfert n'est pas de type USDT")

    expected_usdt = Decimal(str(tx["source_amount"]))
    created_at = tx["created_at"]
    # Allow scanning 30 minutes before creation (clock skew)
    after_ts_ms = int((created_at.timestamp() - 1800) * 1000)

    try:
        candidates = scan_trc20_incoming(
            to_address=KOBO_USDT_ADDRESS,
            expected_usdt=expected_usdt,
            after_ts_ms=after_ts_ms,
        )
    except RuntimeError as e:
        raise HTTPException(502, str(e)) from e

    return {
        "transfer_id": transfer_id,
        "expected_usdt": float(expected_usdt),
        "kobo_address": KOBO_USDT_ADDRESS,
        "candidates": candidates,
        "best_match": next((c for c in candidates if c["amount_match"] and c["success"]), None),
    }


class VerifyUsdtTxReq(BaseModel):
    tx_hash: str = Field(..., min_length=60, max_length=70)
    auto_confirm: bool = True


@router.post("/intl-transfers/{transfer_id}/verify-usdt-tx")
async def verify_usdt_tx_for_transfer(
    transfer_id: str,
    body: VerifyUsdtTxReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Vérifie un tx_hash USDT TRC-20 sur TronScan et confirme le paiement si valide."""
    _require_admin(x_admin_token)
    from app.services.blockchain_verify import verify_tx
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id=%s LIMIT 1", (transfer_id,))
        tx = cur.fetchone()
    if not tx:
        raise HTTPException(404, "Transfert introuvable")
    if tx.get("funding_method") != "usdt":
        raise HTTPException(400, "Ce transfert n'est pas de type USDT")

    expected_usdt = Decimal(str(tx["source_amount"]))
    result = verify_tx(
        tx_hash=body.tx_hash.strip(),
        network="TRC20",
        expected_to=KOBO_USDT_ADDRESS,
        expected_usdt=expected_usdt,
    )

    confirmed = False
    if body.auto_confirm and result.status in ("auto_confirmed", "hash_verified"):
        now = utcnow()
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                """UPDATE transfers
                   SET payment_status='paid', settlement_status='pending_settlement',
                       status='pending_settlement', updated_at=%s,
                       metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb
                   WHERE id=%s AND status='pending_payment'""",
                (now, Json({"usdt_tx_hash": body.tx_hash, "usdt_confirmations": result.confirmations}), transfer_id),
            )
            conn.commit()
        confirmed = True
        actor = _get_actor_email(x_admin_token)
        record_audit(
            action="confirm_usdt_payment",
            resource=f"transfer:{transfer_id}",
            actor_identifier=actor,
            metadata={
                "tx_hash": body.tx_hash,
                "amount_usdt": float(result.amount_usdt or 0),
                "confirmations": result.confirmations,
                "verify_status": result.status,
            },
        )
        try:
            user_id = tx.get("user_id") or (tx.get("sender") or {}).get("user_id")
            if user_id:
                create_notification(
                    user_id=user_id,
                    notif_type="usdt_payment_confirmed",
                    title="Paiement USDT reçu",
                    body=f"Votre paiement de {float(expected_usdt):.2f} USDT a été confirmé sur TronScan. Le virement est en cours de traitement.",
                    metadata={"transfer_id": transfer_id, "tx_hash": body.tx_hash},
                )
        except Exception:
            pass

    return {
        "verify_status": result.status,
        "amount_usdt": float(result.amount_usdt) if result.amount_usdt else None,
        "confirmations": result.confirmations,
        "reason": result.reason,
        "payment_confirmed": confirmed,
        "transfer_status": "pending_settlement" if confirmed else tx["status"],
    }


@router.post("/intl-transfers/{transfer_id}/confirm-payment")
async def confirm_intl_payment(
    transfer_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """EUR/USD→XAF : confirmer réception du paiement entrant et passer en pending_settlement."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transfert introuvable")
        if tx["payment_status"] != "pending_payment":
            raise HTTPException(status_code=400, detail=f"Statut paiement actuel : '{tx['payment_status']}'")
        cur.execute(
            """UPDATE transfers SET payment_status='paid', settlement_status='pending_settlement',
               status='pending_settlement', updated_at=%s WHERE id=%s""",
            (utcnow(), transfer_id),
        )
        conn.commit()

    uid = tx.get("user_id") or (tx.get("sender") or {}).get("user_id")
    src = float(tx["source_amount"]); src_cur = tx["source_currency"]
    tgt = float(tx["target_amount"]); tgt_cur = tx["target_currency"]
    recipient_name = (tx.get("recipient") or {}).get("name", "—")
    if uid:
        try:
            create_notification(
                user_id=uid,
                notif_type="intl_transfer_payment_received",
                title="Paiement reçu — traitement en cours",
                body=f"Votre paiement de {src:,.2f} {src_cur} a bien été reçu. Nous traitons maintenant l'envoi de {tgt:,.0f} {tgt_cur} à {recipient_name}.",
                metadata={"transfer_id": transfer_id},
            )
        except Exception:
            pass
        try:
            notify_user(
                uid,
                "Paiement reçu — traitement de votre transfert",
                f"Bonjour,<br><br>Votre paiement de <b>{src:,.2f} {src_cur}</b> a bien été reçu et confirmé par notre équipe.<br><br>"
                f"Nous procédons maintenant à l'envoi de <b>{tgt:,.0f} {tgt_cur}</b> à <b>{recipient_name}</b>.<br><br>"
                f"Référence : <code>{transfer_id}</code><br><br>Vous pouvez suivre l'avancement dans l'application.",
                success=True,
            )
        except Exception:
            pass

    return {"ok": True, "transfer_id": transfer_id, "status": "pending_settlement"}


@router.post("/intl-transfers/{transfer_id}/complete")
async def complete_intl_transfer(
    transfer_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Marquer le transfert comme complété (admin a envoyé les fonds au destinataire)."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transfert introuvable")
        if tx["status"] not in ("pending_settlement", "pending_payment", "paid"):
            raise HTTPException(status_code=400, detail=f"Statut actuel '{tx['status']}' non modifiable")
        cur.execute(
            """UPDATE transfers SET payment_status='paid', settlement_status='settled',
               status='completed', updated_at=%s WHERE id=%s""",
            (utcnow(), transfer_id),
        )
        conn.commit()

    uid = tx.get("user_id") or (tx.get("sender") or {}).get("user_id")
    src = float(tx["source_amount"]); src_cur = tx["source_currency"]
    tgt = float(tx["target_amount"]); tgt_cur = tx["target_currency"]
    recipient_name = (tx.get("recipient") or {}).get("name", "—")
    recipient_phone = (tx.get("recipient") or {}).get("phone", "—")
    if uid:
        try:
            create_notification(
                user_id=uid,
                notif_type="intl_transfer_completed",
                title="Transfert complété avec succes",
                body=f"{tgt:,.0f} {tgt_cur} ont été envoyés à {recipient_name} ({recipient_phone}). Votre transfert est finalisé.",
                metadata={"transfer_id": transfer_id},
            )
        except Exception:
            pass
        try:
            notify_user(
                uid,
                "Votre transfert international est complété",
                f"Bonjour,<br><br>Bonne nouvelle ! Votre transfert a été <b>complété avec succès</b>.<br><br>"
                f"<b>{tgt:,.0f} {tgt_cur}</b> ont été envoyés à <b>{recipient_name}</b> ({recipient_phone}).<br><br>"
                f"Montant envoyé : <b>{src:,.2f} {src_cur}</b><br>"
                f"Référence : <code>{transfer_id}</code><br><br>"
                f"Merci de votre confiance.",
                success=True,
            )
        except Exception:
            pass

    return {"ok": True, "transfer_id": transfer_id, "status": "completed"}


@router.post("/intl-transfers/{transfer_id}/reject")
async def reject_intl_transfer(
    transfer_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Rejeter le transfert. Rembourse FCFA si source=XAF."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transfert introuvable")
        if tx["status"] in ("completed", "cancelled", "rejected"):
            raise HTTPException(status_code=400, detail=f"Statut actuel '{tx['status']}' non modifiable")

        cur.execute(
            """UPDATE transfers SET status='rejected', payment_status='cancelled',
               updated_at=%s WHERE id=%s""",
            (utcnow(), transfer_id),
        )

        refunded = 0.0
        sender = tx.get("sender") or {}
        uid = tx.get("user_id") or sender.get("user_id")
        if tx["source_currency"] == "XAF" and tx["payment_status"] == "paid" and uid:
            cur.execute(
                "UPDATE wallet_accounts SET balance = balance + %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
                (tx["source_amount"], utcnow(), uid),
            )
            refunded = float(tx["source_amount"])
        conn.commit()

    src = float(tx["source_amount"]); src_cur = tx["source_currency"]
    tgt = float(tx["target_amount"]); tgt_cur = tx["target_currency"]
    recipient_name = (tx.get("recipient") or {}).get("name", "—")
    if uid:
        try:
            create_notification(
                user_id=uid,
                notif_type="intl_transfer_rejected",
                title="Transfert rejeté",
                body=f"Votre transfert de {src:,.2f} {src_cur} vers {recipient_name} a été rejeté."
                     + (f" {refunded:,.0f} FCFA ont été recrédités sur votre wallet." if refunded > 0 else ""),
                metadata={"transfer_id": transfer_id},
            )
        except Exception:
            pass
        try:
            notify_user(
                uid,
                "Transfert international rejeté",
                f"Bonjour,<br><br>Nous avons le regret de vous informer que votre transfert a été <b>rejeté</b>.<br><br>"
                f"Montant : <b>{src:,.2f} {src_cur}</b> → {tgt:,.0f} {tgt_cur} à {recipient_name}<br>"
                f"Référence : <code>{transfer_id}</code><br><br>"
                + (f"<b>{refunded:,.0f} FCFA ont été recrédités sur votre wallet Kobo.</b><br><br>" if refunded > 0 else "")
                + "Contactez notre support pour plus d'informations.",
                success=False,
            )
        except Exception:
            pass

    return {"ok": True, "transfer_id": transfer_id, "status": "rejected", "refunded_fcfa": refunded}


# ── App event logs ────────────────────────────────────────────────────────────

@router.get("/logs")
async def get_logs(
    limit: int = 100,
    offset: int = 0,
    event_type: str | None = None,
    user_id: str | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict:
    _require_admin(x_admin_token)
    conditions = []
    params: list = []
    if event_type:
        conditions.append("event_type = %s")
        params.append(event_type)
    if user_id:
        conditions.append("user_id = %s")
        params.append(user_id)
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT COUNT(*) as total FROM app_events " + where, params)
        total = cur.fetchone()["total"]
        cur.execute(
            "SELECT id, event_type, user_id, user_phone, payload, created_at "
            "FROM app_events " + where + " ORDER BY created_at DESC LIMIT %s OFFSET %s",
            params + [limit, offset],
        )
        rows = cur.fetchall()
    return {
        "total": total,
        "items": [
            {
                "id": r["id"],
                "event_type": r["event_type"],
                "user_id": r["user_id"],
                "user_phone": r["user_phone"],
                "payload": r["payload"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/audit-logs")
async def list_audit_logs(
    limit: int = 50,
    offset: int = 0,
    action: str | None = None,
    actor: str | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    conditions: list[str] = []
    params: list = []
    if action:
        conditions.append("action ILIKE %s")
        params.append(f"%{action}%")
    if actor:
        conditions.append("actor_identifier ILIKE %s")
        params.append(f"%{actor}%")
    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(f"SELECT COUNT(*) as total FROM audit_logs {where}", params)
        total = cur.fetchone()["total"]
        cur.execute(
            f"SELECT id, actor_user_id, actor_identifier, action, resource, metadata, created_at "
            f"FROM audit_logs {where} ORDER BY created_at DESC LIMIT %s OFFSET %s",
            params + [limit, offset],
        )
        rows = cur.fetchall()
    return {
        "total": total,
        "items": [
            {
                "id": r["id"],
                "actor_identifier": r["actor_identifier"] or r["actor_user_id"] or "—",
                "action": r["action"],
                "resource": r["resource"],
                "metadata": r["metadata"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
    }


class StripeSetupRequest(BaseModel):
    stripe_api_key: str = Field(min_length=16, max_length=256)
    merchant_id: str = Field(min_length=2, max_length=128)


@router.post("/hyperswitch/setup-stripe")
async def setup_stripe(
    req: StripeSetupRequest,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict:
    """Configure Stripe connector sur l'instance Hyperswitch locale."""
    _require_admin(x_admin_token, {"superadmin"})
    from app.services.hyperswitch_client import setup_stripe_connector
    result = await setup_stripe_connector(req.stripe_api_key, req.merchant_id)
    return result


# ── Admin OTP auth ────────────────────────────────────────────────────────────

class AdminOtpStartRequest(BaseModel):
    email: str


class AdminOtpVerifyRequest(BaseModel):
    challenge_id: str
    code: str


@router.post("/auth/start")
async def admin_auth_start(req: AdminOtpStartRequest) -> dict:
    email_lower = req.email.lower().strip()
    # Vérifier dans admin_users OU fallback sur settings.admin_email
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT email, role FROM admin_users WHERE LOWER(email)=%s AND is_active=TRUE LIMIT 1",
            (email_lower,),
        )
        admin_user = cur.fetchone()
    if not admin_user and email_lower != settings.admin_email.lower():
        raise HTTPException(status_code=404, detail="Not found")
    resolved_email = admin_user["email"] if admin_user else settings.admin_email
    try:
        challenge_id, dev_code = otp_service.start_challenge(email=resolved_email)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=503, detail="otp_delivery_unavailable")
    result: dict[str, Any] = {"challenge_id": challenge_id}
    if dev_code:
        result["dev_code"] = dev_code
    return result


@router.post("/auth/verify")
async def admin_auth_verify(req: AdminOtpVerifyRequest) -> dict:
    try:
        email, _verification_token = otp_service.verify_challenge(
            challenge_id=req.challenge_id,
            code=req.code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # Récupérer le rôle depuis admin_users, sinon superadmin par défaut
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT role FROM admin_users WHERE LOWER(email)=%s AND is_active=TRUE LIMIT 1",
            (email.lower(),),
        )
        admin_user = cur.fetchone()
    if not admin_user and email.lower() != settings.admin_email.lower():
        raise HTTPException(status_code=403, detail="Forbidden")
    role = admin_user["role"] if admin_user else "superadmin"
    token = f"adm_{uuid.uuid4().hex}"
    token_hash = sha256_hex(token)
    now = utcnow()
    expires = now + timedelta(hours=24)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO admin_sessions (token, email, role, created_at, expires_at) VALUES (%s, %s, %s, %s, %s)",
            (token_hash, email, role, now, expires),
        )
        conn.commit()
    record_audit(
        action="admin_login",
        resource="admin_session",
        actor_identifier=email,
        metadata={"role": role, "token_prefix": token[:8]},
    )
    return {"token": token, "role": role, "email": email}


@router.get("/auth/me")
async def admin_me(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT email, role FROM admin_sessions WHERE token=%s LIMIT 1",
            (sha256_hex(x_admin_token),),
        )
        s = cur.fetchone()
    if not s:
        return {"email": "dev_admin", "role": "superadmin"}
    return {"email": s["email"] or "dev_admin", "role": s["role"] or "superadmin"}


class AdminSessionRevokeReq(BaseModel):
    email: str
    token_prefix: str
    created_at: str


@router.get("/admin-sessions")
async def list_admin_sessions(
    limit: int = 300,
    include_revoked: bool = True,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    limit = max(1, min(limit, 1000))
    current_token_hash = sha256_hex(x_admin_token) if x_admin_token else ""
    where = "" if include_revoked else "WHERE revoked=FALSE"
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            f"""
            SELECT token, email, role, created_at, expires_at, revoked,
                   CASE
                     WHEN revoked THEN 'revoked'
                     WHEN expires_at <= %s THEN 'expired'
                     ELSE 'active'
                   END AS status
            FROM admin_sessions
            {where}
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (utcnow(), limit),
        )
        rows = cur.fetchall() or []
    return {
        "items": [
            {
                "email": r.get("email") or "dev_admin",
                "role": r.get("role") or "superadmin",
                "token_prefix": (r["token"] or "")[:12],
                "created_at": r["created_at"].isoformat(),
                "expires_at": r["expires_at"].isoformat(),
                "revoked": bool(r["revoked"]),
                "status": r["status"],
                "current": bool(current_token_hash and r["token"] == current_token_hash),
            }
            for r in rows
        ]
    }


@router.post("/admin-sessions/revoke")
async def revoke_admin_session(
    body: AdminSessionRevokeReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    created_at = body.created_at
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            UPDATE admin_sessions
            SET revoked=TRUE
            WHERE LOWER(COALESCE(email, ''))=LOWER(%s)
              AND token LIKE %s
              AND created_at=%s::timestamptz
              AND revoked=FALSE
            RETURNING token, email, role, created_at
            """,
            (body.email.strip(), f"{body.token_prefix}%", created_at),
        )
        row = cur.fetchone()
        conn.commit()
    if not row:
        raise HTTPException(404, "Session introuvable ou déjà révoquée")
    record_audit(
        action="revoke_admin_session",
        resource=f"admin_session:{body.email}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={
            "email": body.email,
            "role": row.get("role"),
            "token_prefix": body.token_prefix,
            "created_at": created_at,
        },
    )
    return {"ok": True, "email": body.email, "token_prefix": body.token_prefix}


# ── Admin Users (multi-admin / rôles) ────────────────────────────────────────

_VALID_ROLES = {"superadmin", "ops", "support"}


class AdminUserCreateReq(BaseModel):
    email: str
    name: str = ""
    role: str = "ops"


@router.get("/admin-users")
async def list_admin_users(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id, email, name, role, is_active, created_at FROM admin_users ORDER BY created_at ASC")
        rows = cur.fetchall()
    return {
        "items": [
            {
                "id": r["id"],
                "email": r["email"],
                "name": r["name"] or "",
                "role": r["role"],
                "is_active": r["is_active"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/admin-users")
async def create_admin_user(
    body: AdminUserCreateReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    if body.role not in _VALID_ROLES:
        raise HTTPException(400, f"Rôle invalide. Valeurs acceptées : {', '.join(sorted(_VALID_ROLES))}")
    user_id = f"adm_{uuid.uuid4().hex[:16]}"
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        try:
            cur.execute(
                "INSERT INTO admin_users (id, email, name, role, is_active, created_at) VALUES (%s, %s, %s, %s, TRUE, %s)",
                (user_id, body.email.lower().strip(), body.name, body.role, now),
            )
            conn.commit()
        except Exception as exc:
            if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
                raise HTTPException(409, "Un admin avec cet email existe déjà")
            raise
    record_audit(
        action="create_admin_user",
        resource=f"admin_user:{body.email}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"email": body.email, "role": body.role, "name": body.name},
    )
    return {"ok": True, "id": user_id, "email": body.email, "role": body.role}


@router.patch("/admin-users/{admin_email}/role")
async def update_admin_user_role(
    admin_email: str,
    body: ForceStatusReq,  # on réutilise: body.status = new role
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    new_role = body.status
    if new_role not in _VALID_ROLES:
        raise HTTPException(400, f"Rôle invalide. Valeurs acceptées : {', '.join(sorted(_VALID_ROLES))}")
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE admin_users SET role=%s WHERE LOWER(email)=%s",
            (new_role, admin_email.lower()),
        )
        cur.execute(
            "UPDATE admin_sessions SET revoked=TRUE WHERE LOWER(email)=%s AND revoked=FALSE",
            (admin_email.lower(),),
        )
        conn.commit()
    record_audit(
        action="update_admin_role",
        resource=f"admin_user:{admin_email}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"email": admin_email, "new_role": new_role},
    )
    return {"ok": True, "email": admin_email, "role": new_role}


@router.delete("/admin-users/{admin_email}")
async def deactivate_admin_user(
    admin_email: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE admin_users SET is_active=FALSE WHERE LOWER(email)=%s",
            (admin_email.lower(),),
        )
        # Révoquer toutes les sessions actives de cet admin
        cur.execute(
            "UPDATE admin_sessions SET revoked=TRUE WHERE LOWER(email)=%s AND revoked=FALSE",
            (admin_email.lower(),),
        )
        conn.commit()
    record_audit(
        action="deactivate_admin_user",
        resource=f"admin_user:{admin_email}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"email": admin_email},
    )
    return {"ok": True, "email": admin_email}


# ── User management ───────────────────────────────────────────────────────────

@router.get("/users/{user_id}/detail")
async def user_detail(
    user_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM users WHERE id = %s", (user_id,))
        user = cur.fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Utilisateur introuvable")

        cur.execute("SELECT currency, balance FROM wallet_accounts WHERE user_id = %s ORDER BY currency", (user_id,))
        wallets = cur.fetchall()

        cur.execute(
            "SELECT id, recipient_user_id, sender_user_id, amount, currency, status, created_at FROM p2p_transfers WHERE sender_user_id = %s OR recipient_user_id = %s ORDER BY created_at DESC LIMIT 20",
            (user_id, user_id),
        )
        p2p = cur.fetchall()

        cur.execute(
            "SELECT id, device_name, ip_address, created_at, last_seen_at FROM sessions WHERE user_id = %s AND revoked = FALSE ORDER BY last_seen_at DESC LIMIT 10",
            (user_id,),
        )
        sessions = cur.fetchall()

        cur.execute("SELECT level, status, updated_at FROM kyc_profiles WHERE user_id = %s LIMIT 1", (user_id,))
        kyc = cur.fetchone()

        # Wallet transactions (last 30)
        cur.execute(
            "SELECT id, direction, category, label, counterpart, amount, currency, status, created_at FROM wallet_transactions WHERE user_id = %s ORDER BY created_at DESC LIMIT 30",
            (user_id,),
        )
        txns = cur.fetchall()

        # Fiat deposits (last 15)
        cur.execute(
            "SELECT id, method, provider, amount, currency, status, reference, note, created_at FROM fiat_deposits WHERE user_id = %s ORDER BY created_at DESC LIMIT 15",
            (user_id,),
        )
        fiat_deposits = cur.fetchall()

        # Fiat withdrawals (last 15)
        cur.execute(
            "SELECT id, method, provider, amount, fee_fcfa, total_debit, currency, status, reference, recipient_name, recipient_phone, recipient_iban, note, reject_reason, created_at FROM fiat_withdrawals WHERE user_id = %s ORDER BY created_at DESC LIMIT 15",
            (user_id,),
        )
        fiat_withdrawals = cur.fetchall()

        # Aggregated stats
        cur.execute(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS vol FROM p2p_transfers WHERE sender_user_id = %s",
            (user_id,),
        )
        p2p_sent = cur.fetchone()
        cur.execute(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS vol FROM fiat_deposits WHERE user_id = %s AND status = 'completed'",
            (user_id,),
        )
        dep_stats = cur.fetchone()
        cur.execute(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(total_debit),0) AS vol FROM fiat_withdrawals WHERE user_id = %s AND status = 'completed'",
            (user_id,),
        )
        wd_stats = cur.fetchone()

        # Session count (all time)
        cur.execute("SELECT COUNT(*) AS cnt, MAX(last_seen_at) AS last_active FROM sessions WHERE user_id = %s", (user_id,))
        sess_stats = cur.fetchone()

        # Fraud scan results for this user
        cur.execute(
            "SELECT id, risk_score, action, signals, reviewed, reviewer_note, created_at FROM fraud_scan_results WHERE user_id = %s ORDER BY created_at DESC LIMIT 5",
            (user_id,),
        )
        fraud_history = cur.fetchall()

        # Payment links created by this user
        cur.execute(
            "SELECT id, description, amount, currency, status, use_count, max_uses, created_at FROM payment_links WHERE user_id = %s AND status != 'deleted' ORDER BY created_at DESC LIMIT 20",
            (user_id,),
        )
        user_payment_links = cur.fetchall()

    profile = user.get("profile") or {}
    return {
        "id": user["id"],
        "email": user.get("email") or "",
        "phone_e164": user["phone_e164"],
        "fullName": profile.get("fullName") or "",
        "username": profile.get("username") or None,
        "country": profile.get("country") or "",
        "kycLevel": kyc["level"] if kyc else (profile.get("kycLevel") or 0),
        "is_blocked": bool(user.get("is_blocked") or user.get("blocked")),
        "auto_blocked": bool(user.get("blocked")),
        "created_at": user["created_at"].isoformat(),
        "wallets": [{"currency": w["currency"], "balance": float(w["balance"])} for w in wallets],
        "stats": {
            "p2p_sent_count": p2p_sent["cnt"],
            "p2p_sent_volume_fcfa": float(p2p_sent["vol"]),
            "deposits_completed": dep_stats["cnt"],
            "deposits_total_fcfa": float(dep_stats["vol"]),
            "withdrawals_completed": wd_stats["cnt"],
            "withdrawals_total_fcfa": float(wd_stats["vol"]),
            "sessions_total": sess_stats["cnt"],
            "last_active": sess_stats["last_active"].isoformat() if sess_stats["last_active"] else None,
        },
        "kyc": {"level": kyc["level"], "status": kyc["status"], "updated_at": kyc["updated_at"].isoformat()} if kyc else None,
        "sessions": [
            {
                "device_name": s["device_name"] or "Inconnu",
                "ip_address": s["ip_address"] or "—",
                "created_at": s["created_at"].isoformat(),
                "last_seen_at": s["last_seen_at"].isoformat(),
            }
            for s in sessions
        ],
        "wallet_transactions": [
            {
                "id": t["id"],
                "direction": t["direction"],
                "category": t["category"],
                "label": t["label"],
                "counterpart": t["counterpart"],
                "amount": float(t["amount"]),
                "currency": t["currency"],
                "status": t["status"],
                "created_at": t["created_at"].isoformat(),
            }
            for t in txns
        ],
        "fiat_deposits": [
            {
                "id": d["id"],
                "method": d["method"],
                "provider": d["provider"] or "",
                "amount": float(d["amount"]),
                "currency": d["currency"],
                "status": d["status"],
                "reference": d["reference"],
                "note": d["note"] or "",
                "created_at": d["created_at"].isoformat(),
            }
            for d in fiat_deposits
        ],
        "fiat_withdrawals": [
            {
                "id": w["id"],
                "method": w["method"],
                "provider": w["provider"] or "",
                "amount": float(w["amount"]),
                "fee_fcfa": float(w.get("fee_fcfa") or 0),
                "total_debit": float(w.get("total_debit") or w["amount"]),
                "currency": w["currency"],
                "status": w["status"],
                "reference": w["reference"],
                "recipient_name": w["recipient_name"],
                "recipient_contact": w["recipient_phone"] or w["recipient_iban"] or "",
                "note": w["note"] or w["reject_reason"] or "",
                "created_at": w["created_at"].isoformat(),
            }
            for w in fiat_withdrawals
        ],
        "p2p_transfers": [
            {
                "direction": "out" if r["sender_user_id"] == user_id else "in",
                "amount": float(r["amount"]),
                "currency": r["currency"],
                "note": "",
                "status": r["status"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in p2p
        ],
        "fraud_history": [
            {
                "id": f["id"],
                "risk_score": f["risk_score"],
                "action": f["action"],
                "signals_count": len(f["signals"] or []),
                "reviewed": f["reviewed"],
                "reviewer_note": f["reviewer_note"] or "",
                "created_at": f["created_at"].isoformat(),
            }
            for f in fraud_history
        ],
        "payment_links": [
            {
                "id": pl["id"],
                "description": pl["description"] or "",
                "amount": float(pl["amount"]) if pl["amount"] else None,
                "currency": pl["currency"] or "FCFA",
                "status": pl["status"],
                "use_count": pl["use_count"],
                "max_uses": pl["max_uses"],
                "created_at": pl["created_at"].isoformat(),
            }
            for pl in user_payment_links
        ],
    }


@router.post("/users/{user_id}/block")
async def block_user(
    user_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE users SET is_blocked = TRUE, blocked = TRUE WHERE id = %s", (user_id,))
        cur.execute("UPDATE sessions SET revoked = TRUE WHERE user_id = %s", (user_id,))
        conn.commit()
    record_audit(
        action="block_user",
        resource=f"user:{user_id}",
        actor_identifier=_get_actor_email(x_admin_token),
    )
    return {"ok": True}


@router.post("/users/{user_id}/unblock")
async def unblock_user(
    user_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE users SET is_blocked = FALSE, blocked = FALSE, under_review = FALSE WHERE id = %s",
            (user_id,),
        )
        conn.commit()
    record_audit(
        action="unblock_user",
        resource=f"user:{user_id}",
        actor_identifier=_get_actor_email(x_admin_token),
    )
    return {"ok": True}


class AdjustBalanceReq(BaseModel):
    new_balance: Decimal = Field(..., ge=0)
    note: str = Field(..., min_length=5, max_length=500)


@router.post("/users/{user_id}/adjust-balance")
async def adjust_user_balance(
    user_id: str,
    body: AdjustBalanceReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT id FROM users WHERE id=%s LIMIT 1", (user_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Utilisateur introuvable")
        cur.execute("SELECT balance FROM wallet_accounts WHERE user_id=%s AND currency='FCFA' LIMIT 1", (user_id,))
        row = cur.fetchone()
        current = Decimal(str(row["balance"])) if row else Decimal("0")
        cur.execute(
            """
            SELECT COALESCE(SUM(
                CASE
                    WHEN direction='credit' AND status NOT IN ('cancelled','canceled') THEN amount
                    WHEN direction='debit' AND status NOT IN ('cancelled','canceled') THEN -amount
                    ELSE 0
                END
            ), 0) AS expected_balance
            FROM wallet_transactions
            WHERE user_id=%s AND currency='FCFA' AND category != 'withdraw'
            """,
            (user_id,),
        )
        expected_current = Decimal(str((cur.fetchone() or {}).get("expected_balance") or 0))
        diff = body.new_balance - expected_current
        now = utcnow()

        if diff == 0:
            if current != body.new_balance:
                cur.execute(
                    """INSERT INTO wallet_accounts (user_id, currency, balance, address, metadata, created_at, updated_at)
                       VALUES (%s,'FCFA',%s,NULL,'{}'::jsonb,%s,%s)
                       ON CONFLICT (user_id, currency)
                       DO UPDATE SET balance=%s, updated_at=%s""",
                    (user_id, body.new_balance, now, now, body.new_balance, now),
                )
                conn.commit()
            return {
                "ok": True,
                "prev_balance": float(current),
                "expected_prev_balance": float(expected_current),
                "new_balance": float(body.new_balance),
                "diff": 0,
            }

        direction = "credit" if diff > 0 else "debit"
        abs_diff = abs(diff)
        tx_id = f"tx_{uuid.uuid4().hex[:16]}"
        cur.execute(
            """INSERT INTO wallet_accounts (user_id, currency, balance, address, metadata, created_at, updated_at)
               VALUES (%s,'FCFA',%s,NULL,'{}'::jsonb,%s,%s)
               ON CONFLICT (user_id, currency)
               DO UPDATE SET balance=%s, updated_at=%s""",
            (user_id, body.new_balance, now, now, body.new_balance, now),
        )
        cur.execute(
            """INSERT INTO wallet_transactions
               (id,user_id,direction,category,label,counterpart,amount,currency,status,metadata,created_at)
               VALUES (%s,%s,%s,'admin_balance_adjustment',%s,'Kobo Admin',%s,'FCFA','completed',%s,%s)""",
            (tx_id, user_id, direction,
             f"Ajustement admin : {body.note[:80]}",
             abs_diff,
             Json({"note": body.note, "prev_balance": float(current), "expected_prev_balance": float(expected_current), "new_balance": float(body.new_balance)}),
             now),
        )
        conn.commit()

    actor = _get_actor_email(x_admin_token)
    record_audit(
        action="adjust_user_balance",
        resource=f"user:{user_id}",
        actor_identifier=actor,
        metadata={"prev_balance": float(current), "expected_prev_balance": float(expected_current), "new_balance": float(body.new_balance), "diff": float(diff), "note": body.note},
    )
    try:
        create_notification(
            user_id=user_id,
            notif_type="balance_adjusted",
            title="Solde mis à jour",
            body=f"Votre solde a été ajusté à {float(body.new_balance):,.0f} FCFA par l'équipe Kobo.",
            metadata={"note": body.note},
        )
    except Exception:
        pass
    return {
        "ok": True,
        "prev_balance": float(current),
        "expected_prev_balance": float(expected_current),
        "new_balance": float(body.new_balance),
        "diff": float(diff),
    }


# ── Analytics ─────────────────────────────────────────────────────────────────

@router.get("/accounting/ledger")
async def accounting_ledger(
    limit: int = 200,
    date_from: str | None = None,
    date_to: str | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    limit = max(1, min(limit, 5000))
    date_filter = """
      AND (%s::date IS NULL OR {alias}.created_at >= %s::date)
      AND (%s::date IS NULL OR {alias}.created_at < (%s::date + INTERVAL '1 day'))
    """
    date_params = (date_from, date_from, date_to, date_to)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT currency,
                   COUNT(*) AS accounts,
                   COALESCE(SUM(balance), 0) AS total_balance
            FROM wallet_accounts
            GROUP BY currency
            ORDER BY currency
            """
        )
        balances = cur.fetchall() or []

        cur.execute(
            """
            SELECT currency,
                   COUNT(*) AS entries,
                   COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END), 0) AS credits,
                   COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END), 0) AS debits,
                   COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END), 0) AS net_movement
            FROM wallet_transactions
            WHERE 1=1
            """ + date_filter.format(alias="wallet_transactions") + """
            GROUP BY currency
            ORDER BY currency
            """,
            date_params,
        )
        ledger_totals = cur.fetchall() or []

        cur.execute(
            """
            SELECT category,
                   direction,
                   status,
                   currency,
                   COUNT(*) AS count,
                   COALESCE(SUM(amount), 0) AS total
            FROM wallet_transactions
            WHERE 1=1
            """ + date_filter.format(alias="wallet_transactions") + """
            GROUP BY category, direction, status, currency
            ORDER BY category, direction, status, currency
            """,
            date_params,
        )
        aggregates = cur.fetchall() or []

        cur.execute(
            """
            SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                   currency,
                   COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END), 0) AS credits,
                   COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END), 0) AS debits,
                   COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END), 0) AS net_movement
            FROM wallet_transactions
            WHERE 1=1
            """ + date_filter.format(alias="wallet_transactions") + """
            GROUP BY 1, currency
            ORDER BY 1, currency
            """,
            date_params,
        )
        ledger_daily = cur.fetchall() or []

        cur.execute(
            """
            WITH refund_state AS (
              SELECT metadata->>'withdrawal_id' AS withdrawal_id,
                     COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund' THEN amount ELSE 0 END), 0) AS refund_amount,
                     COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund_reversal' THEN amount ELSE 0 END), 0) AS reversal_amount
              FROM wallet_transactions
              WHERE category IN ('fiat_withdrawal_refund','fiat_withdrawal_refund_reversal')
              GROUP BY 1
            )
            SELECT fw.status,
                   COUNT(*) AS count,
                   COALESCE(SUM(fw.amount), 0) AS amount,
                   COALESCE(SUM(fw.fee_fcfa), 0) AS fees,
                   COALESCE(SUM(fw.total_debit), 0) AS total_debit,
                   COALESCE(SUM(rs.refund_amount), 0) AS refunds,
                   COALESCE(SUM(rs.reversal_amount), 0) AS reversals
            FROM fiat_withdrawals fw
            LEFT JOIN refund_state rs ON rs.withdrawal_id=fw.id
            WHERE 1=1
            """ + date_filter.format(alias="fw") + """
            GROUP BY fw.status
            ORDER BY fw.status
            """,
            date_params,
        )
        withdrawal_totals = cur.fetchall() or []

        cur.execute(
            """
            WITH refund_state AS (
              SELECT metadata->>'withdrawal_id' AS withdrawal_id,
                     COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund' THEN amount ELSE 0 END), 0) AS refund_amount,
                     COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund_reversal' THEN amount ELSE 0 END), 0) AS reversal_amount
              FROM wallet_transactions
              WHERE category IN ('fiat_withdrawal_refund','fiat_withdrawal_refund_reversal')
              GROUP BY 1
            )
            SELECT TO_CHAR(fw.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                   COUNT(*) AS count,
                   COALESCE(SUM(fw.total_debit), 0) AS total_debit,
                   COALESCE(SUM(rs.refund_amount), 0) AS refunds,
                   COALESCE(SUM(rs.reversal_amount), 0) AS reversals
            FROM fiat_withdrawals fw
            LEFT JOIN refund_state rs ON rs.withdrawal_id=fw.id
            WHERE 1=1
            """ + date_filter.format(alias="fw") + """
            GROUP BY 1
            ORDER BY 1
            """,
            date_params,
        )
        withdrawal_daily = cur.fetchall() or []

        cur.execute(
            """
            SELECT wt.id, wt.user_id, u.email, u.phone_e164,
                   wt.direction, wt.category, wt.label, wt.counterpart,
                   wt.amount, wt.currency, wt.status, wt.metadata, wt.created_at
            FROM wallet_transactions wt
            LEFT JOIN users u ON u.id = wt.user_id
            WHERE 1=1
            """ + date_filter.format(alias="wt") + """
            ORDER BY wt.created_at DESC
            LIMIT %s
            """,
            (*date_params, limit),
        )
        entries = cur.fetchall() or []

        cur.execute(
            """
            WITH refund_state AS (
              SELECT metadata->>'withdrawal_id' AS withdrawal_id,
                     COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund' THEN amount ELSE 0 END), 0) AS refund_amount,
                     COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund_reversal' THEN amount ELSE 0 END), 0) AS reversal_amount
              FROM wallet_transactions
              WHERE category IN ('fiat_withdrawal_refund','fiat_withdrawal_refund_reversal')
              GROUP BY 1
            )
            SELECT fw.id, fw.user_id, u.email, u.phone_e164,
                   fw.reference, fw.notchpay_txid, fw.amount, fw.fee_fcfa,
                   fw.total_debit, fw.currency, fw.method, fw.provider,
                   fw.recipient_name, fw.recipient_phone, fw.status,
                   fw.note, fw.reject_reason, fw.created_at, fw.updated_at,
                   COALESCE(rs.refund_amount, 0) AS refund_amount,
                   COALESCE(rs.reversal_amount, 0) AS reversal_amount,
                   EXISTS (
                     SELECT 1 FROM wallet_transactions r
                     WHERE r.category='fiat_withdrawal_refund'
                       AND r.metadata->>'withdrawal_id'=fw.id
                   ) AS has_refund,
                   EXISTS (
                     SELECT 1 FROM wallet_transactions rr
                     WHERE rr.category='fiat_withdrawal_refund_reversal'
                       AND rr.metadata->>'withdrawal_id'=fw.id
                   ) AS has_refund_reversal
            FROM fiat_withdrawals fw
            LEFT JOIN users u ON u.id = fw.user_id
            LEFT JOIN refund_state rs ON rs.withdrawal_id=fw.id
            WHERE 1=1
            """ + date_filter.format(alias="fw") + """
            ORDER BY fw.created_at DESC
            LIMIT %s
            """,
            (*date_params, limit),
        )
        withdrawals = cur.fetchall() or []

        cur.execute(
            """
            SELECT fw.id, fw.reference, fw.status, fw.amount, fw.total_debit,
                   fw.user_id, u.email, u.phone_e164,
                   CASE
                     WHEN fw.status IN ('failed','rejected')
                      AND NOT EXISTS (
                        SELECT 1 FROM wallet_transactions r
                        WHERE r.category='fiat_withdrawal_refund'
                          AND r.metadata->>'withdrawal_id'=fw.id
                      )
                       THEN 'missing_refund'
                     WHEN fw.status IN ('pending','processing','completed')
                      AND EXISTS (
                        SELECT 1 FROM wallet_transactions r
                        WHERE r.category='fiat_withdrawal_refund'
                          AND r.metadata->>'withdrawal_id'=fw.id
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM wallet_transactions rr
                        WHERE rr.category='fiat_withdrawal_refund_reversal'
                          AND rr.metadata->>'withdrawal_id'=fw.id
                      )
                       THEN 'refunded_but_active'
                     ELSE NULL
                   END AS issue
            FROM fiat_withdrawals fw
            LEFT JOIN users u ON u.id = fw.user_id
            WHERE (
              fw.status IN ('failed','rejected')
              AND NOT EXISTS (
                SELECT 1 FROM wallet_transactions r
                WHERE r.category='fiat_withdrawal_refund'
                  AND r.metadata->>'withdrawal_id'=fw.id
              )
            ) OR (
              fw.status IN ('pending','processing','completed')
              AND EXISTS (
                SELECT 1 FROM wallet_transactions r
                WHERE r.category='fiat_withdrawal_refund'
                  AND r.metadata->>'withdrawal_id'=fw.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM wallet_transactions rr
                WHERE rr.category='fiat_withdrawal_refund_reversal'
                  AND rr.metadata->>'withdrawal_id'=fw.id
              )
            )
            ORDER BY fw.updated_at DESC
            LIMIT 100
            """
        )
        alerts = cur.fetchall() or []

    return {
        "balances": [
            {
                "currency": r["currency"],
                "accounts": int(r["accounts"]),
                "total_balance": float(r["total_balance"]),
            }
            for r in balances
        ],
        "ledger_totals": [
            {
                "currency": r["currency"],
                "entries": int(r["entries"]),
                "credits": float(r["credits"]),
                "debits": float(r["debits"]),
                "net_movement": float(r["net_movement"]),
            }
            for r in ledger_totals
        ],
        "ledger_daily": [
            {
                "day": r["day"],
                "currency": r["currency"],
                "credits": float(r["credits"]),
                "debits": float(r["debits"]),
                "net_movement": float(r["net_movement"]),
            }
            for r in ledger_daily
        ],
        "withdrawal_totals": [
            {
                "status": r["status"],
                "count": int(r["count"]),
                "amount": float(r["amount"]),
                "fees": float(r["fees"]),
                "total_debit": float(r["total_debit"]),
                "refunds": float(r["refunds"]),
                "reversals": float(r["reversals"]),
                "net_user_effect": float(r["refunds"] - r["total_debit"] - r["reversals"]),
            }
            for r in withdrawal_totals
        ],
        "withdrawal_daily": [
            {
                "day": r["day"],
                "count": int(r["count"]),
                "total_debit": float(r["total_debit"]),
                "refunds": float(r["refunds"]),
                "reversals": float(r["reversals"]),
            }
            for r in withdrawal_daily
        ],
        "aggregates": [
            {
                "category": r["category"],
                "direction": r["direction"],
                "status": r["status"],
                "currency": r["currency"],
                "count": int(r["count"]),
                "total": float(r["total"]),
            }
            for r in aggregates
        ],
        "entries": [
            {
                "id": r["id"],
                "user_id": r["user_id"],
                "email": r.get("email") or "",
                "phone_e164": r.get("phone_e164") or "",
                "direction": r["direction"],
                "category": r["category"],
                "label": r["label"],
                "counterpart": r["counterpart"],
                "amount": float(r["amount"]),
                "currency": r["currency"],
                "status": r["status"],
                "metadata": r["metadata"] or {},
                "created_at": r["created_at"].isoformat(),
            }
            for r in entries
        ],
        "withdrawals": [
            {
                "id": r["id"],
                "user_id": r["user_id"],
                "email": r.get("email") or "",
                "phone_e164": r.get("phone_e164") or "",
                "reference": r["reference"],
                "notchpay_txid": r.get("notchpay_txid") or "",
                "amount": float(r["amount"]),
                "fee_fcfa": float(r.get("fee_fcfa") or 0),
                "total_debit": float(r.get("total_debit") or 0),
                "currency": r["currency"],
                "method": r["method"],
                "provider": r["provider"] or "",
                "recipient_name": r["recipient_name"],
                "recipient_phone": r["recipient_phone"] or "",
                "status": r["status"],
                "note": r["note"] or "",
                "reject_reason": r["reject_reason"] or "",
                "has_refund": bool(r["has_refund"]),
                "has_refund_reversal": bool(r["has_refund_reversal"]),
                "refund_amount": float(r.get("refund_amount") or 0),
                "reversal_amount": float(r.get("reversal_amount") or 0),
                "net_refund": float((r.get("refund_amount") or 0) - (r.get("reversal_amount") or 0)),
                "net_user_effect": float((r.get("refund_amount") or 0) - (r.get("total_debit") or 0) - (r.get("reversal_amount") or 0)),
                "created_at": r["created_at"].isoformat(),
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in withdrawals
        ],
        "alerts": [
            {
                "id": r["id"],
                "reference": r["reference"],
                "status": r["status"],
                "amount": float(r["amount"]),
                "total_debit": float(r["total_debit"]),
                "user_id": r["user_id"],
                "email": r.get("email") or "",
                "phone_e164": r.get("phone_e164") or "",
                "issue": r["issue"],
            }
            for r in alerts
        ],
    }


@router.get("/accounting/balance-audit")
async def accounting_balance_audit(
    search: str | None = None,
    user_id: str | None = None,
    currency: str = "FCFA",
    only_mismatches: bool = False,
    limit: int = 100,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    limit = max(1, min(limit, 500))
    currency = (currency or "FCFA").upper()
    tolerance = Decimal("0.01")

    where = ["c.currency = %s"]
    params: list[Any] = [currency]
    if user_id:
        where.append("c.user_id = %s")
        params.append(user_id)
    if search:
        like = f"%{search.lower().strip()}%"
        where.append(
            "(LOWER(c.user_id) LIKE %s OR LOWER(COALESCE(u.email, '')) LIKE %s "
            "OR LOWER(COALESCE(u.phone_e164, '')) LIKE %s OR LOWER(COALESCE(u.profile->>'email', '')) LIKE %s "
            "OR LOWER(COALESCE(u.profile->>'fullName', '')) LIKE %s OR LOWER(COALESCE(u.profile->>'username', '')) LIKE %s)"
        )
        params.extend([like, like, like, like, like, like])
    where_sql = " AND ".join(where)

    mismatch_sql = ""
    if only_mismatches:
        mismatch_sql = "WHERE ABS(stored_balance - expected_balance) > %s"

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        query = f"""
            WITH ledger AS (
              SELECT user_id,
                     currency,
                     COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END), 0) AS expected_balance,
                     COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END), 0) AS credits,
                     COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE 0 END), 0) AS debits,
                     COUNT(*) AS entries,
                     MIN(created_at) AS first_entry_at,
                     MAX(created_at) AS last_entry_at
              FROM wallet_transactions
              WHERE currency=%s
                AND category <> 'withdraw'
                AND COALESCE(status, '') NOT IN ('cancelled','canceled')
              GROUP BY user_id, currency
            ),
            accounts AS (
              SELECT user_id, currency, COALESCE(balance, 0) AS stored_balance, updated_at AS account_updated_at
              FROM wallet_accounts
              WHERE currency=%s
            ),
            combined AS (
              SELECT COALESCE(a.user_id, l.user_id) AS user_id,
                     COALESCE(a.currency, l.currency) AS currency,
                     COALESCE(a.stored_balance, 0) AS stored_balance,
                     COALESCE(l.expected_balance, 0) AS expected_balance,
                     COALESCE(l.credits, 0) AS credits,
                     COALESCE(l.debits, 0) AS debits,
                     COALESCE(l.entries, 0) AS entries,
                     l.first_entry_at,
                     l.last_entry_at,
                     a.account_updated_at
              FROM accounts a
              FULL OUTER JOIN ledger l ON l.user_id=a.user_id AND l.currency=a.currency
            ),
            filtered AS (
              SELECT c.*, u.email, u.phone_e164, u.profile,
                     (c.stored_balance - c.expected_balance) AS delta
              FROM combined c
              LEFT JOIN users u ON u.id=c.user_id
              WHERE {where_sql}
            ),
            flagged AS (
              SELECT *
              FROM filtered
              {mismatch_sql}
            )
            SELECT *
            FROM flagged
            ORDER BY ABS(delta) DESC, last_entry_at DESC NULLS LAST, user_id
            LIMIT %s
        """
        base_params: list[Any] = [currency, currency, *params]
        if only_mismatches:
            base_params.append(tolerance)
        base_params.append(limit)
        cur.execute(query, base_params)
        rows = cur.fetchall() or []

        summary_query = f"""
            WITH ledger AS (
              SELECT user_id,
                     currency,
                     COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END), 0) AS expected_balance
              FROM wallet_transactions
              WHERE currency=%s
                AND category <> 'withdraw'
                AND COALESCE(status, '') NOT IN ('cancelled','canceled')
              GROUP BY user_id, currency
            ),
            accounts AS (
              SELECT user_id, currency, COALESCE(balance, 0) AS stored_balance
              FROM wallet_accounts
              WHERE currency=%s
            ),
            combined AS (
              SELECT COALESCE(a.user_id, l.user_id) AS user_id,
                     COALESCE(a.currency, l.currency) AS currency,
                     COALESCE(a.stored_balance, 0) AS stored_balance,
                     COALESCE(l.expected_balance, 0) AS expected_balance
              FROM accounts a
              FULL OUTER JOIN ledger l ON l.user_id=a.user_id AND l.currency=a.currency
            ),
            filtered AS (
              SELECT c.*, u.email, u.phone_e164, u.profile,
                     (c.stored_balance - c.expected_balance) AS delta
              FROM combined c
              LEFT JOIN users u ON u.id=c.user_id
              WHERE {where_sql}
            )
            SELECT COUNT(*) AS accounts_checked,
                   COUNT(*) FILTER (WHERE ABS(delta) > %s) AS mismatches,
                   COALESCE(SUM(stored_balance), 0) AS stored_total,
                   COALESCE(SUM(expected_balance), 0) AS expected_total,
                   COALESCE(SUM(delta), 0) AS delta_total,
                   COALESCE(SUM(ABS(delta)), 0) AS abs_delta_total
            FROM filtered
        """
        cur.execute(summary_query, [currency, currency, *params, tolerance])
        summary = cur.fetchone() or {}

        detail_user_id = user_id
        if not detail_user_id and search and len(rows) == 1:
            detail_user_id = rows[0]["user_id"]
        breakdown: list[dict[str, Any]] = []
        transactions: list[dict[str, Any]] = []
        operations: list[dict[str, Any]] = []
        if detail_user_id:
            cur.execute(
                """
                SELECT category, direction, status, currency,
                       COUNT(*) AS count,
                       COALESCE(SUM(amount), 0) AS total
                FROM wallet_transactions
                WHERE user_id=%s AND currency=%s
                GROUP BY category, direction, status, currency
                ORDER BY category, direction, status
                """,
                (detail_user_id, currency),
            )
            breakdown = [dict(r) for r in cur.fetchall() or []]
            cur.execute(
                """
                SELECT id, direction, category, label, counterpart, amount, currency, status, metadata, created_at
                FROM wallet_transactions
                WHERE user_id=%s AND currency=%s
                ORDER BY created_at DESC
                LIMIT 200
                """,
                (detail_user_id, currency),
            )
            transactions = [dict(r) for r in cur.fetchall() or []]
            cur.execute(
                """
                WITH withdrawal_refunds AS (
                  SELECT metadata->>'withdrawal_id' AS withdrawal_id,
                         COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund' THEN amount ELSE 0 END), 0) AS refund_amount,
                         COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund_reversal' THEN amount ELSE 0 END), 0) AS reversal_amount
                  FROM wallet_transactions
                  WHERE user_id=%s
                    AND category IN ('fiat_withdrawal_refund','fiat_withdrawal_refund_reversal')
                  GROUP BY 1
                ),
                ops AS (
                  SELECT fd.id, 'Dépôt fiat' AS family, fd.method AS channel, fd.status,
                         fd.reference, fd.notchpay_txid AS provider_reference,
                         fd.amount AS gross_amount, fd.currency, COALESCE(fd.fee, 0) AS fee_amount,
                         CASE WHEN fd.status='completed' THEN COALESCE(wt.amount, fd.amount - COALESCE(fd.fee, 0)) ELSE 0 END AS net_amount,
                         0::numeric AS refund_amount,
                         CASE WHEN fd.status='completed' THEN COALESCE(wt.amount, fd.amount - COALESCE(fd.fee, 0)) ELSE 0 END AS balance_effect,
                         fd.created_at, fd.updated_at,
                         COALESCE(fd.note, fd.reject_reason, '') AS note
                  FROM fiat_deposits fd
                  LEFT JOIN wallet_transactions wt ON wt.category='fiat_deposit' AND wt.metadata->>'deposit_id'=fd.id
                  WHERE fd.user_id=%s

                  UNION ALL

                  SELECT fw.id, 'Retrait fiat' AS family, fw.method AS channel, fw.status,
                         fw.reference, fw.notchpay_txid AS provider_reference,
                         fw.amount AS gross_amount, 'FCFA' AS currency, COALESCE(fw.fee_fcfa, 0) AS fee_amount,
                         COALESCE(fw.total_debit, fw.amount) AS net_amount,
                         COALESCE(wr.refund_amount, 0) - COALESCE(wr.reversal_amount, 0) AS refund_amount,
                         (COALESCE(wr.refund_amount, 0) - COALESCE(wr.reversal_amount, 0) - COALESCE(fw.total_debit, fw.amount)) AS balance_effect,
                         fw.created_at, fw.updated_at,
                         COALESCE(fw.note, fw.reject_reason, '') AS note
                  FROM fiat_withdrawals fw
                  LEFT JOIN withdrawal_refunds wr ON wr.withdrawal_id=fw.id
                  WHERE fw.user_id=%s

                  UNION ALL

                  SELECT plt.id, 'Lien de paiement' AS family, COALESCE(plt.provider, 'lien') AS channel, plt.status,
                         plt.reference, plt.aggregator_txid AS provider_reference,
                         plt.amount AS gross_amount, 'FCFA' AS currency, COALESCE(plt.fee_fcfa, 0) AS fee_amount,
                         COALESCE(plt.net_fcfa, 0) AS net_amount,
                         0::numeric AS refund_amount,
                         CASE WHEN plt.status='completed' THEN COALESCE(plt.net_fcfa, 0) ELSE 0 END AS balance_effect,
                         plt.created_at, plt.updated_at,
                         COALESCE(pl.description, '') AS note
                  FROM payment_link_txs plt
                  JOIN payment_links pl ON pl.id=plt.link_id
                  WHERE pl.user_id=%s

                  UNION ALL

                  SELECT pt.id, 'Transfert P2P envoyé' AS family, 'p2p' AS channel, pt.status,
                         pt.id AS reference, '' AS provider_reference,
                         pt.amount AS gross_amount, pt.currency, 0::numeric AS fee_amount,
                         pt.amount AS net_amount,
                         0::numeric AS refund_amount,
                         -pt.amount AS balance_effect,
                         pt.created_at, pt.created_at AS updated_at,
                         'Argent envoyé à un autre utilisateur' AS note
                  FROM p2p_transfers pt
                  WHERE pt.sender_user_id=%s

                  UNION ALL

                  SELECT pt.id, 'Transfert P2P reçu' AS family, 'p2p' AS channel, pt.status,
                         pt.id AS reference, '' AS provider_reference,
                         pt.amount AS gross_amount, pt.currency, 0::numeric AS fee_amount,
                         pt.amount AS net_amount,
                         0::numeric AS refund_amount,
                         pt.amount AS balance_effect,
                         pt.created_at, pt.created_at AS updated_at,
                         'Argent recu d’un autre utilisateur' AS note
                  FROM p2p_transfers pt
                  WHERE pt.recipient_user_id=%s

                  UNION ALL

                  SELECT t.id, 'Transfert international / bancaire' AS family, COALESCE(t.funding_method, 'bank') AS channel, t.status,
                         COALESCE(t.funding_reference, t.id) AS reference, COALESCE(t.notchpay_reference, '') AS provider_reference,
                         t.source_amount AS gross_amount, t.source_currency AS currency, COALESCE(t.fees_amount, 0) AS fee_amount,
                         t.target_amount AS net_amount,
                         0::numeric AS refund_amount,
                         0::numeric AS balance_effect,
                         t.created_at, t.updated_at,
                         CONCAT('Vers ', COALESCE(t.recipient->>'name', t.target_currency, 'destinataire')) AS note
                  FROM transfers t
                  WHERE t.user_id=%s

                  UNION ALL

                  SELECT cd.id, 'Dépôt crypto' AS family, cd.network AS channel, cd.status,
                         COALESCE(cd.tx_hash, cd.id) AS reference, COALESCE(cd.tx_hash, '') AS provider_reference,
                         cd.amount_xaf AS gross_amount, 'FCFA' AS currency, 0::numeric AS fee_amount,
                         cd.amount_xaf AS net_amount,
                         0::numeric AS refund_amount,
                         CASE WHEN cd.status IN ('auto_confirmed','confirmed','completed') THEN cd.amount_xaf ELSE 0 END AS balance_effect,
                         cd.created_at, cd.updated_at,
                         COALESCE(cd.note, cd.reject_reason, '') AS note
                  FROM crypto_deposits cd
                  WHERE cd.user_id=%s

                  UNION ALL

                  SELECT cw.id, 'Retrait crypto' AS family, cw.network AS channel, cw.status,
                         COALESCE(cw.tx_hash, cw.id) AS reference, COALESCE(cw.tx_hash, '') AS provider_reference,
                         cw.amount_xaf AS gross_amount, 'FCFA' AS currency, 0::numeric AS fee_amount,
                         cw.amount_xaf AS net_amount,
                         0::numeric AS refund_amount,
                         CASE WHEN cw.status IN ('completed','processing','pending') THEN -cw.amount_xaf ELSE 0 END AS balance_effect,
                         cw.created_at, cw.updated_at,
                         COALESCE(cw.note, cw.reject_reason, '') AS note
                  FROM crypto_withdrawals cw
                  WHERE cw.user_id=%s
                )
                SELECT *
                FROM ops
                ORDER BY created_at DESC
                LIMIT 300
                """,
                (
                    detail_user_id,
                    detail_user_id,
                    detail_user_id,
                    detail_user_id,
                    detail_user_id,
                    detail_user_id,
                    detail_user_id,
                    detail_user_id,
                    detail_user_id,
                ),
            )
            operations = [dict(r) for r in cur.fetchall() or []]

    def _profile(row: dict[str, Any]) -> dict[str, Any]:
        return row.get("profile") or {}

    def _verdict(delta: Decimal) -> str:
        if abs(delta) <= tolerance:
            return "ok"
        return "surplus" if delta > 0 else "manquant"

    items = []
    for r in rows:
        delta = Decimal(str(r["delta"]))
        p = _profile(r)
        items.append(
            {
                "user_id": r["user_id"],
                "email": r.get("email") or p.get("email") or "",
                "phone_e164": r.get("phone_e164") or "",
                "fullName": p.get("fullName") or p.get("full_name") or "",
                "username": p.get("username") or "",
                "country": p.get("country") or "",
                "currency": r["currency"],
                "stored_balance": float(r["stored_balance"]),
                "expected_balance": float(r["expected_balance"]),
                "delta": float(delta),
                "credits": float(r["credits"]),
                "debits": float(r["debits"]),
                "entries": int(r["entries"] or 0),
                "verdict": _verdict(delta),
                "first_entry_at": r["first_entry_at"].isoformat() if r["first_entry_at"] else None,
                "last_entry_at": r["last_entry_at"].isoformat() if r["last_entry_at"] else None,
                "account_updated_at": r["account_updated_at"].isoformat() if r["account_updated_at"] else None,
            }
        )

    def _status_bucket(status: str, family: str, refund_amount: Decimal, refund_due: Decimal) -> str:
        s = (status or "").lower()
        if family.startswith("Retrait") and refund_due > 0:
            return "remboursement du"
        if family.startswith("Retrait") and refund_amount > 0:
            return "remboursé"
        if s in {"completed", "complete", "success", "successful", "paid", "auto_confirmed", "confirmed"}:
            return "réussi"
        if s in {"failed", "rejected", "cancelled", "canceled", "expired", "invalid"}:
            return "échoué"
        if s in {"pending", "processing", "pending_approval", "pending_payment", "hash_verified"}:
            return "en cours"
        return s or "inconnu"

    operation_items = []
    for r in operations:
        refund_amount = Decimal(str(r.get("refund_amount") or 0))
        net_amount = Decimal(str(r.get("net_amount") or 0))
        refund_due = Decimal("0")
        if (r.get("family") or "").startswith("Retrait") and (r.get("status") or "").lower() in {"failed", "rejected", "cancelled", "canceled"}:
            refund_due = max(Decimal("0"), net_amount - refund_amount)
        bucket = _status_bucket(r.get("status") or "", r.get("family") or "", refund_amount, refund_due)
        operation_items.append(
            {
                "id": r["id"],
                "family": r["family"],
                "channel": r.get("channel") or "",
                "status": r.get("status") or "",
                "status_bucket": bucket,
                "reference": r.get("reference") or "",
                "provider_reference": r.get("provider_reference") or "",
                "gross_amount": float(r.get("gross_amount") or 0),
                "currency": r.get("currency") or currency,
                "fee_amount": float(r.get("fee_amount") or 0),
                "net_amount": float(net_amount),
                "refund_amount": float(refund_amount),
                "refund_due": float(refund_due),
                "balance_effect": float(r.get("balance_effect") or 0),
                "note": r.get("note") or "",
                "created_at": r["created_at"].isoformat() if r.get("created_at") else None,
                "updated_at": r["updated_at"].isoformat() if r.get("updated_at") else None,
            }
        )

    operation_summary_map: dict[tuple[str, str], dict[str, Any]] = {}
    for op in operation_items:
        key = (op["family"], op["status_bucket"])
        if key not in operation_summary_map:
            operation_summary_map[key] = {
                "family": op["family"],
                "status_bucket": op["status_bucket"],
                "count": 0,
                "gross_total": 0.0,
                "net_total": 0.0,
                "refund_total": 0.0,
                "balance_effect_total": 0.0,
                "currency": op["currency"],
            }
        row = operation_summary_map[key]
        row["count"] += 1
        row["gross_total"] += op["gross_amount"]
        row["net_total"] += op["net_amount"]
        row["refund_total"] += op["refund_amount"]
        row["refund_due_total"] = row.get("refund_due_total", 0.0) + op["refund_due"]
        row["balance_effect_total"] += op["balance_effect"]

    return {
        "currency": currency,
        "formula": "solde attendu = somme(credits) - somme(debits), hors catégorie legacy 'withdraw' et statuts cancelled/canceled",
        "summary": {
            "accounts_checked": int(summary.get("accounts_checked") or 0),
            "mismatches": int(summary.get("mismatches") or 0),
            "stored_total": float(summary.get("stored_total") or 0),
            "expected_total": float(summary.get("expected_total") or 0),
            "delta_total": float(summary.get("delta_total") or 0),
            "abs_delta_total": float(summary.get("abs_delta_total") or 0),
        },
        "items": items,
        "detail": {
            "user_id": detail_user_id,
            "breakdown": [
                {
                    "category": r["category"],
                    "direction": r["direction"],
                    "status": r["status"],
                    "currency": r["currency"],
                    "count": int(r["count"]),
                    "total": float(r["total"]),
                }
                for r in breakdown
            ],
            "transactions": [
                {
                    "id": r["id"],
                    "direction": r["direction"],
                    "category": r["category"],
                    "label": r["label"],
                    "counterpart": r["counterpart"],
                    "amount": float(r["amount"]),
                    "currency": r["currency"],
                    "status": r["status"],
                    "metadata": r["metadata"] or {},
                    "created_at": r["created_at"].isoformat(),
                }
                for r in transactions
            ],
            "operations": operation_items,
            "operation_summary": list(operation_summary_map.values()),
        },
    }


@router.get("/analytics")
async def analytics(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT COUNT(*) as n FROM users")
        total_users = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(*) as n FROM p2p_transfers")
        total_p2p = cur.fetchone()["n"]
        cur.execute("SELECT COALESCE(SUM(amount), 0) as n FROM p2p_transfers")
        total_volume = float(cur.fetchone()["n"])
        cur.execute(
            "SELECT COUNT(*) as n FROM sessions WHERE revoked = FALSE AND last_seen_at >= NOW() - INTERVAL '24 hours'"
        )
        active_sessions = cur.fetchone()["n"]
        cur.execute(
            """
            SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day, COUNT(*) as count
            FROM users WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY 1 ORDER BY 1
            """
        )
        users_by_day = cur.fetchall()
        cur.execute(
            """
            SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
                   COUNT(*) as count,
                   COALESCE(SUM(amount), 0) as volume
            FROM p2p_transfers WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY 1 ORDER BY 1
            """
        )
        p2p_by_day = cur.fetchall()
        cur.execute(
            """
            SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day, COUNT(*) as count
            FROM sessions WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY 1 ORDER BY 1
            """
        )
        logins_by_day = cur.fetchall()
        # Dépôts fiat par jour (30 jours)
        cur.execute(
            """
            SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
                   COUNT(*) as count,
                   COALESCE(SUM(amount) FILTER (WHERE status='completed'), 0) as volume
            FROM fiat_deposits WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY 1 ORDER BY 1
            """
        )
        deposits_by_day = cur.fetchall()
        # Retraits fiat par jour (30 jours)
        cur.execute(
            """
            SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
                   COUNT(*) as count,
                   COALESCE(SUM(total_debit) FILTER (WHERE status='completed'), 0) as volume
            FROM fiat_withdrawals WHERE created_at >= NOW() - INTERVAL '30 days'
            GROUP BY 1 ORDER BY 1
            """
        )
        withdrawals_by_day = cur.fetchall()
        # Revenus de la plateforme (frais collectés sur sys_kobo_platform)
        cur.execute(
            "SELECT COALESCE(balance, 0) as bal FROM wallet_accounts WHERE user_id = 'sys_kobo_platform' AND currency = 'FCFA' LIMIT 1"
        )
        row = cur.fetchone()
        platform_revenue_fcfa = float(row["bal"]) if row else 0.0
        # Total frais collectés historiquement (somme des crédits platform_fee)
        cur.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE user_id = 'sys_kobo_platform' AND direction = 'credit'"
        )
        total_fees_collected = float(cur.fetchone()["total"])
        # Frais du mois en cours
        cur.execute(
            "SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE user_id = 'sys_kobo_platform' AND direction = 'credit' AND created_at >= date_trunc('month', NOW())"
        )
        fees_this_month = float(cur.fetchone()["total"])
        # Stats globales liens de paiement
        cur.execute(
            """SELECT
                COUNT(t.id) FILTER (WHERE t.status='completed')                      AS total_paid,
                COUNT(t.id) FILTER (WHERE t.status='failed')                         AS total_failed,
                COUNT(t.id)                                                           AS total_txs,
                COALESCE(SUM(t.amount) FILTER (WHERE t.status='completed'), 0)       AS total_gross_volume,
                COALESCE(SUM(t.net_fcfa) FILTER (WHERE t.status='completed'), 0)     AS total_net_volume,
                COUNT(DISTINCT t.link_id)                                             AS total_links_used,
                COALESCE(SUM(t.amount) FILTER (WHERE t.status='completed'
                    AND t.created_at >= date_trunc('month', NOW())), 0)              AS gross_this_month
               FROM payment_link_txs t"""
        )
        pl = cur.fetchone() or {}
        pl_total_paid = int(pl.get("total_paid") or 0)
        pl_total_txs = int(pl.get("total_txs") or 0)
        pl_gross = float(pl.get("total_gross_volume") or 0)
        pl_net = float(pl.get("total_net_volume") or 0)
        pl_success = round(pl_total_paid / pl_total_txs * 100, 1) if pl_total_txs > 0 else 0.0
        # Total argent sous gestion (somme de tous les wallets FCFA utilisateurs)
        cur.execute(
            "SELECT COALESCE(SUM(balance), 0) AS total FROM wallet_accounts WHERE currency = 'FCFA'"
        )
        total_aum_fcfa = float(cur.fetchone()["total"])
        # Statistiques agrégées dépôts & retraits
        cur.execute(
            "SELECT COUNT(*) FILTER (WHERE status='completed') AS cnt, COALESCE(SUM(amount) FILTER (WHERE status='completed'), 0) AS vol FROM fiat_deposits"
        )
        dep_agg = cur.fetchone() or {}
        cur.execute(
            "SELECT COUNT(*) FILTER (WHERE status='completed') AS cnt, COALESCE(SUM(total_debit) FILTER (WHERE status='completed'), 0) AS vol FROM fiat_withdrawals"
        )
        wd_agg = cur.fetchone() or {}
        # Frais collectés par catégorie (source de revenus)
        cur.execute(
            """SELECT category,
                      COUNT(*) AS cnt,
                      COALESCE(SUM(amount), 0) AS total
               FROM wallet_transactions
               WHERE user_id = 'sys_kobo_platform' AND direction = 'credit'
               GROUP BY category
               ORDER BY total DESC"""
        )
        fees_by_category = cur.fetchall() or []
        # Synthèse mensuelle revenus (6 derniers mois)
        cur.execute(
            """SELECT TO_CHAR(date_trunc('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
                      COALESCE(SUM(amount), 0) AS fees,
                      COUNT(*) AS transactions
               FROM wallet_transactions
               WHERE user_id = 'sys_kobo_platform' AND direction = 'credit'
                 AND created_at >= NOW() - INTERVAL '6 months'
               GROUP BY 1 ORDER BY 1"""
        )
        monthly_fees = cur.fetchall() or []
        # Synthèse mensuelle dépôts & retraits (6 derniers mois)
        cur.execute(
            """SELECT TO_CHAR(date_trunc('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
                      COUNT(*) FILTER (WHERE status='completed') AS cnt,
                      COALESCE(SUM(amount) FILTER (WHERE status='completed'), 0) AS volume
               FROM fiat_deposits
               WHERE created_at >= NOW() - INTERVAL '6 months'
               GROUP BY 1 ORDER BY 1"""
        )
        monthly_deposits = cur.fetchall() or []
        cur.execute(
            """SELECT TO_CHAR(date_trunc('month', created_at AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
                      COUNT(*) FILTER (WHERE status='completed') AS cnt,
                      COALESCE(SUM(total_debit) FILTER (WHERE status='completed'), 0) AS volume
               FROM fiat_withdrawals
               WHERE created_at >= NOW() - INTERVAL '6 months'
               GROUP BY 1 ORDER BY 1"""
        )
        monthly_withdrawals = cur.fetchall() or []
        # Transactions récentes (toute la plateforme)
        cur.execute(
            """SELECT wt.id, wt.user_id, wt.direction, wt.category, wt.label,
                      wt.counterpart, wt.amount, wt.currency, wt.status, wt.created_at,
                      u.phone_e164 AS user_phone
               FROM wallet_transactions wt
               LEFT JOIN users u ON u.id = wt.user_id
               ORDER BY wt.created_at DESC LIMIT 20"""
        )
        recent_txs = cur.fetchall()
        # Stats transferts internationaux
        cur.execute(
            """SELECT COUNT(*) AS total_count,
                      COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
                      COALESCE(SUM(source_amount) FILTER (WHERE status = 'completed'), 0) AS total_source_volume,
                      COALESCE(SUM(fees_amount) FILTER (WHERE status = 'completed'), 0) AS total_fees
               FROM transfers"""
        )
        intl = cur.fetchone() or {}
        # Transferts internationaux récents
        cur.execute(
            """SELECT t.id, t.source_currency, t.target_currency,
                      t.source_amount, t.target_amount, t.fees_amount,
                      t.status, t.created_at,
                      t.sender->>'name' AS sender_name
               FROM transfers t
               ORDER BY t.created_at DESC LIMIT 10"""
        )
        recent_intl = cur.fetchall()
    return {
        "summary": {
            "total_users": total_users,
            "total_p2p_transfers": total_p2p,
            "total_p2p_volume_fcfa": total_volume,
            "active_sessions_24h": active_sessions,
            "platform_revenue_fcfa": platform_revenue_fcfa,
            "total_fees_collected_fcfa": total_fees_collected,
            "fees_this_month_fcfa": fees_this_month,
            "pl_total_paid": pl_total_paid,
            "pl_total_txs": pl_total_txs,
            "pl_total_gross_volume": pl_gross,
            "pl_total_net_volume": pl_net,
            "pl_success_rate": pl_success,
            "pl_links_used": int(pl.get("total_links_used") or 0),
            "pl_gross_this_month": float(pl.get("gross_this_month") or 0),
            "total_aum_fcfa": total_aum_fcfa,
            "deposits_completed_count": int(dep_agg.get("cnt") or 0),
            "deposits_total_volume": float(dep_agg.get("vol") or 0),
            "withdrawals_completed_count": int(wd_agg.get("cnt") or 0),
            "withdrawals_total_volume": float(wd_agg.get("vol") or 0),
            "intl_total_count": int(intl.get("total_count") or 0),
            "intl_completed_count": int(intl.get("completed_count") or 0),
            "intl_total_volume": float(intl.get("total_source_volume") or 0),
            "intl_total_fees": float(intl.get("total_fees") or 0),
        },
        "users_by_day": [{"day": r["day"], "count": r["count"]} for r in users_by_day],
        "p2p_by_day": [{"day": r["day"], "count": r["count"], "volume": float(r["volume"])} for r in p2p_by_day],
        "logins_by_day": [{"day": r["day"], "count": r["count"]} for r in logins_by_day],
        "deposits_by_day": [{"day": r["day"], "count": r["count"], "volume": float(r["volume"])} for r in deposits_by_day],
        "withdrawals_by_day": [{"day": r["day"], "count": r["count"], "volume": float(r["volume"])} for r in withdrawals_by_day],
        "fees_by_category": [{"category": r["category"], "count": int(r["cnt"]), "total": float(r["total"])} for r in fees_by_category],
        "monthly_fees": [{"month": r["month"], "fees": float(r["fees"]), "transactions": int(r["transactions"])} for r in monthly_fees],
        "monthly_deposits": [{"month": r["month"], "count": int(r["cnt"]), "volume": float(r["volume"])} for r in monthly_deposits],
        "monthly_withdrawals": [{"month": r["month"], "count": int(r["cnt"]), "volume": float(r["volume"])} for r in monthly_withdrawals],
        "recent_transactions": [
            {
                "id": r["id"],
                "user_phone": r["user_phone"],
                "direction": r["direction"],
                "category": r["category"],
                "label": r["label"],
                "counterpart": r["counterpart"],
                "amount": float(r["amount"]),
                "currency": r["currency"],
                "status": r["status"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in recent_txs
        ],
        "recent_intl_transfers": [
            {
                "id": r["id"],
                "source_currency": r["source_currency"],
                "target_currency": r["target_currency"],
                "source_amount": float(r["source_amount"]),
                "target_amount": float(r["target_amount"]),
                "fees_amount": float(r["fees_amount"]),
                "status": r["status"],
                "sender_name": r["sender_name"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in recent_intl
        ],
    }


# ── Activity feed ─────────────────────────────────────────────────────────────

@router.get("/activity-feed")
async def activity_feed(
    limit: int = 60,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT 'login' as type, s.device_name as label, u.phone_e164 as user_phone,
                   s.ip_address, s.created_at
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.created_at >= NOW() - INTERVAL '7 days'
            UNION ALL
            SELECT 'p2p' as type,
                   CONCAT(fmt.from_phone, ' → ', fmt.to_phone, ' : ', p.amount::text, ' ', p.currency) as label,
                   fmt.from_phone as user_phone, NULL as ip_address, p.created_at
            FROM p2p_transfers p
            JOIN LATERAL (
                SELECT u1.phone_e164 as from_phone, u2.phone_e164 as to_phone
                FROM users u1, users u2
                WHERE u1.id = p.sender_user_id AND u2.id = p.recipient_user_id
            ) fmt ON TRUE
            WHERE p.created_at >= NOW() - INTERVAL '7 days'
            UNION ALL
            SELECT 'kyc' as type,
                   CONCAT('KYC ', kp.status, ' niv.', kp.level) as label,
                   u.phone_e164 as user_phone, NULL as ip_address, kp.updated_at as created_at
            FROM kyc_profiles kp JOIN users u ON u.id = kp.user_id
            WHERE kp.updated_at >= NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC LIMIT %s
            """,
            (limit,),
        )
        rows = cur.fetchall()
    return {
        "items": [
            {
                "type": r["type"],
                "label": r["label"],
                "user_phone": r["user_phone"],
                "ip_address": r["ip_address"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }


# ── Fiat Deposits ──────────────────────────────────────────────────────────────

@router.get("/fiat-deposits")
async def list_fiat_deposits(
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        filters = []
        params: list = []
        if status:
            filters.append("fd.status = %s")
            params.append(status)
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        cur.execute(
            f"""
            SELECT fd.*, u.phone_e164
            FROM fiat_deposits fd
            JOIN users u ON u.id = fd.user_id
            {where}
            ORDER BY fd.created_at DESC
            LIMIT %s OFFSET %s
            """,
            params + [limit, offset],
        )
        rows = cur.fetchall() or []
        cur.execute(f"SELECT COUNT(*) as cnt FROM fiat_deposits fd {where}", params)
        total = (cur.fetchone() or {}).get("cnt", 0)
    return {
        "total": total,
        "items": [
            {
                "id": r["id"],
                "user_id": r["user_id"],
                "phone_e164": r["phone_e164"],
                "currency": r["currency"],
                "amount": float(r["amount"]),
                "method": r["method"],
                "provider": r["provider"],
                "phone": r["phone"],
                "reference": r["reference"],
                "status": r["status"],
                "notchpay_txid": r["notchpay_txid"],
                "note": r["note"],
                "reject_reason": r["reject_reason"],
                "created_at": r["created_at"].isoformat(),
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in rows
        ],
    }


class FiatDepositActionReq(BaseModel):
    note: str = ""
    reject_reason: str = ""


def _fiat_deposit_credit_state(cur: psycopg.Cursor, deposit_id: str) -> tuple[Decimal, Decimal]:
    cur.execute(
        """SELECT
             COALESCE(SUM(CASE WHEN category='fiat_deposit' THEN amount ELSE 0 END), 0) AS credited_amount,
             COALESCE(SUM(CASE WHEN category='fiat_deposit_credit_reversal' THEN amount ELSE 0 END), 0) AS reversed_amount
           FROM wallet_transactions
           WHERE category IN ('fiat_deposit', 'fiat_deposit_credit_reversal')
             AND metadata->>'deposit_id'=%s""",
        (deposit_id,),
    )
    row = cur.fetchone()
    if not row:
        return Decimal("0"), Decimal("0")
    if isinstance(row, dict):
        return Decimal(str(row.get("credited_amount") or 0)), Decimal(str(row.get("reversed_amount") or 0))
    return Decimal(str(row[0] or 0)), Decimal(str(row[1] or 0))


def _credit_fiat_deposit(cur: psycopg.Cursor, dep: dict[str, Any], note: str = "", forced: bool = False) -> str:
    deposit_id = dep["id"]
    credited, reversed_amount = _fiat_deposit_credit_state(cur, deposit_id)
    if credited > reversed_amount:
        raise HTTPException(409, "Ce dépôt a deja ete credite. Credit wallet refuse pour eviter un double solde.")
    if credited > 0 and reversed_amount >= credited:
        raise HTTPException(
            409,
            "Ce dépôt a deja ete credite puis contrepasse. Creez une nouvelle operation ou un ajustement comptable explicite.",
        )
    gross_fcfa = Decimal(str(dep["amount"]))
    method = str(dep.get("method") or "")
    if method == "mobile_money" and str(dep.get("currency") or "").upper() == "FCFA":
        provider = str(dep.get("provider") or "sharepay").lower()
        operator_rate = Decimal("1.6") if provider == "sharepay" else Decimal("1.5")
        try:
            with closing(get_conn()) as cfg_conn, cfg_conn.cursor(row_factory=psycopg.rows.dict_row) as cfg_cur:
                key = "sharepay_fee_rate" if provider == "sharepay" else "notchpay_fee_rate"
                cfg_cur.execute("SELECT value FROM app_settings WHERE key=%s LIMIT 1", (key,))
                row = cfg_cur.fetchone()
            if row and isinstance(row["value"], dict):
                operator_rate = Decimal(str(row["value"].get("rate", operator_rate)))
            elif row and row["value"] is not None:
                operator_rate = Decimal(str(row["value"]))
        except Exception:
            pass
        operator_fee = (gross_fcfa * operator_rate / Decimal("100")).quantize(Decimal("1"), rounding=ROUND_CEILING)
        net_after_operator = gross_fcfa - operator_fee
        kobo_fee = calculate_fee_fcfa("mobile_money_deposit", net_after_operator)
        amount_fcfa = net_after_operator - kobo_fee
        total_fee = operator_fee + kobo_fee
    else:
        operator_fee = Decimal("0")
        kobo_fee = Decimal("0")
        total_fee = Decimal("0")
        amount_fcfa = gross_fcfa
    now = utcnow()
    cur.execute(
        """INSERT INTO wallet_accounts (user_id, currency, balance)
           VALUES (%s, 'FCFA', 0)
           ON CONFLICT (user_id, currency) DO NOTHING""",
        (dep["user_id"],),
    )
    cur.execute(
        "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
        (amount_fcfa, now, dep["user_id"]),
    )
    tx_id = f"tx_{uuid.uuid4().hex}"
    label = f"Dépôt {str(dep['method']).replace('_',' ').title()} — {dep['currency']}"
    metadata = {"deposit_id": deposit_id}
    if total_fee > 0:
        metadata.update({
            "gross_fcfa": float(gross_fcfa),
            "operator_fee_fcfa": float(operator_fee),
            "kobo_fee_fcfa": float(kobo_fee),
            "total_fee_fcfa": float(total_fee),
            "confirmed_by_admin": True,
        })
    if forced:
        metadata["forced_by_admin"] = True
    if note:
        metadata["note"] = note
    cur.execute(
        """INSERT INTO wallet_transactions
           (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
           VALUES (%s,%s,'credit','fiat_deposit',%s,'Kobo',%s,'FCFA','completed',%s,%s)""",
        (tx_id, dep["user_id"], label, amount_fcfa, Json(metadata), now),
    )
    if kobo_fee > 0:
        cur.execute("UPDATE fiat_deposits SET fee=%s WHERE id=%s", (kobo_fee, deposit_id))
    return tx_id


def _reverse_fiat_deposit_credit(cur: psycopg.Cursor, dep: dict[str, Any], note: str = "", forced: bool = False) -> str:
    deposit_id = dep["id"]
    credited, reversed_amount = _fiat_deposit_credit_state(cur, deposit_id)
    open_credit = credited - reversed_amount
    if open_credit <= 0:
        raise HTTPException(409, "Aucun credit de depot ouvert a contrepasser.")
    cur.execute(
        "SELECT COALESCE(balance, 0) FROM wallet_accounts WHERE user_id=%s AND currency='FCFA' LIMIT 1 FOR UPDATE",
        (dep["user_id"],),
    )
    balance_row = cur.fetchone()
    if isinstance(balance_row, dict):
        balance = Decimal(str(next(iter(balance_row.values())) if balance_row else 0))
    else:
        balance = Decimal(str((balance_row or [Decimal("0")])[0] or 0))
    if balance < open_credit:
        raise HTTPException(
            409,
            f"Contrepassation impossible: solde utilisateur insuffisant ({balance} FCFA disponibles, {open_credit} FCFA requis).",
        )
    now = utcnow()
    cur.execute(
        "UPDATE wallet_accounts SET balance=balance-%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
        (open_credit, now, dep["user_id"]),
    )
    tx_id = f"tx_{uuid.uuid4().hex}"
    metadata = {"deposit_id": deposit_id}
    if forced:
        metadata["forced_by_admin"] = True
    if note:
        metadata["note"] = note
    cur.execute(
        """INSERT INTO wallet_transactions
           (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
           VALUES (%s,%s,'debit','fiat_deposit_credit_reversal','Dépôt annulé — contrepassation crédit','Kobo',%s,'FCFA','completed',%s,%s)""",
        (tx_id, dep["user_id"], open_credit, Json(metadata), now),
    )
    return tx_id


@router.post("/fiat-deposits/{deposit_id}/confirm")
async def confirm_fiat_deposit(
    deposit_id: str,
    body: FiatDepositActionReq = FiatDepositActionReq(),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_deposits WHERE id=%s LIMIT 1", (deposit_id,))
        dep = cur.fetchone()
    if not dep:
        raise HTTPException(404, "Dépôt introuvable")
    if dep["status"] not in ("pending", "processing"):
        raise HTTPException(400, f"Dépôt déjà traité (statut: {dep['status']})")

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_deposits SET status='completed', note=%s, updated_at=%s WHERE id=%s",
            (body.note, utcnow(), deposit_id),
        )
        _credit_fiat_deposit(cur, dep, body.note)
        conn.commit()

    amount_fcfa = Decimal(str(dep["amount"]))
    if str(dep.get("method") or "") == "mobile_money":
        with closing(get_conn()) as read_conn, read_conn.cursor(row_factory=psycopg.rows.dict_row) as read_cur:
            read_cur.execute(
                "SELECT COALESCE(SUM(amount),0) AS credited FROM wallet_transactions WHERE category='fiat_deposit' AND metadata->>'deposit_id'=%s",
                (deposit_id,),
            )
            row = read_cur.fetchone()
            if row and Decimal(str(row["credited"] or 0)) > 0:
                amount_fcfa = Decimal(str(row["credited"]))
    create_notification(
        user_id=dep["user_id"],
        notif_type="deposit_confirmed",
        title="Dépôt confirmé",
        body=f"{float(amount_fcfa):,.0f} FCFA crédités sur votre compte Kobo.",
    )
    notify_user(
        dep["user_id"],
        "Dépôt confirmé",
        f"Votre dépôt de <b>{float(amount_fcfa):,.0f} FCFA</b> a été validé et crédité sur votre portefeuille Kobo.",
        success=True,
    )
    return {"status": "confirmed", "deposit_id": deposit_id}


@router.post("/fiat-deposits/{deposit_id}/reject")
async def reject_fiat_deposit(
    deposit_id: str,
    body: FiatDepositActionReq = FiatDepositActionReq(),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_deposits WHERE id=%s LIMIT 1", (deposit_id,))
        dep = cur.fetchone()
    if not dep:
        raise HTTPException(404, "Dépôt introuvable")
    if dep["status"] not in ("pending", "processing"):
        raise HTTPException(400, f"Dépôt déjà traité (statut: {dep['status']})")

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_deposits SET status='rejected', reject_reason=%s, updated_at=%s WHERE id=%s",
            (body.reject_reason, utcnow(), deposit_id),
        )
        conn.commit()
    notify_user(
        dep["user_id"],
        "Dépôt refusé",
        f"Votre dépôt a été refusé. Motif : <b>{body.reject_reason or 'non précisé'}</b>.<br>Contactez le support si vous pensez qu'il s'agit d'une erreur.",
        success=False,
    )
    return {"status": "rejected", "deposit_id": deposit_id}


# ── Fiat Withdrawals ────────────────────────────────────────────────────────────

@router.get("/fiat-withdrawals")
async def list_fiat_withdrawals(
    limit: int = 50,
    offset: int = 0,
    status: str | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        filters, params = [], []
        if status:
            filters.append("fw.status = %s")
            params.append(status)
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        cur.execute(
            f"""SELECT fw.*, u.phone_e164, u.email,
                       kp.level as kyc_level, kp.status as kyc_status
                FROM fiat_withdrawals fw
                JOIN users u ON u.id = fw.user_id
                LEFT JOIN kyc_profiles kp ON kp.user_id = fw.user_id
                {where}
                ORDER BY fw.created_at DESC LIMIT %s OFFSET %s""",
            params + [limit, offset],
        )
        rows = cur.fetchall() or []
        cur.execute(f"SELECT COUNT(*) as cnt FROM fiat_withdrawals fw {where}", params)
        total = (cur.fetchone() or {}).get("cnt", 0)
    return {
        "total": total,
        "items": [
            {
                "id": r["id"],
                "user_id": r["user_id"],
                "phone_e164": r["phone_e164"],
                "email": r["email"],
                "currency": r["currency"],
                "amount": float(r["amount"]),
                "method": r["method"],
                "recipient_iban": r["recipient_iban"],
                "recipient_name": r["recipient_name"],
                "recipient_phone": r["recipient_phone"],
                "provider": r["provider"],
                "reference": r["reference"],
                "status": r["status"],
                "reject_reason": r["reject_reason"],
                "note": r["note"],
                "fee_fcfa": float(r.get("fee_fcfa") or 0),
                "total_debit": float(r.get("total_debit") or 0),
                "notchpay_txid": r.get("notchpay_txid") or "",
                "kyc_level": r["kyc_level"],
                "kyc_status": r["kyc_status"],
                "kyc_level_at_request": r["kyc_level_at_request"],
                "created_at": r["created_at"].isoformat(),
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in rows
        ],
    }


class FiatWithdrawalActionReq(BaseModel):
    note: str = ""
    reject_reason: str = ""


@router.post("/fiat-withdrawals/{withdrawal_id}/approve")
async def approve_fiat_withdrawal(
    withdrawal_id: str,
    background_tasks: BackgroundTasks,
    body: FiatWithdrawalActionReq = FiatWithdrawalActionReq(),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Approuve un retrait Mobile Money en attente de validation (> seuil)."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_withdrawals WHERE id=%s LIMIT 1", (withdrawal_id,))
        w = cur.fetchone()
    if not w:
        raise HTTPException(404, "Retrait introuvable")
    if w["status"] != "pending_approval":
        raise HTTPException(400, f"Ce retrait n'est pas en attente de validation (statut: {w['status']})")

    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE fiat_withdrawals SET status='processing', note=%s, updated_at=%s WHERE id=%s",
                    (body.note, now, withdrawal_id))
        conn.commit()

    await trigger_approved_payout(withdrawal_id, background_tasks)

    create_notification(
        user_id=w["user_id"],
        notif_type="withdrawal_approved",
        title="Retrait approuvé",
        body=f"Votre retrait de {float(w['amount']):,.0f} FCFA a été approuvé et est en cours de traitement.",
        metadata={"withdrawal_id": withdrawal_id},
    )
    actor = _get_actor_email(x_admin_token)
    record_audit(
        action="approve_fiat_withdrawal",
        resource=f"fiat_withdrawal:{withdrawal_id}",
        actor_identifier=actor,
        metadata={"amount": float(w["amount"]), "user_id": w["user_id"], "note": body.note},
    )
    return {"ok": True, "withdrawal_id": withdrawal_id, "status": "processing"}


@router.post("/fiat-withdrawals/{withdrawal_id}/confirm")
async def confirm_fiat_withdrawal(
    withdrawal_id: str,
    body: FiatWithdrawalActionReq = FiatWithdrawalActionReq(),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_withdrawals WHERE id=%s LIMIT 1", (withdrawal_id,))
        w = cur.fetchone()
    if not w:
        raise HTTPException(404, "Retrait introuvable")
    if w["status"] not in ("pending", "processing"):
        raise HTTPException(400, f"Retrait déjà traité (statut: {w['status']})")

    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_withdrawals SET status='completed', note=%s, updated_at=%s WHERE id=%s",
            (body.note, now, withdrawal_id),
        )
        # Mark wallet_transactions as completed
        cur.execute(
            "UPDATE wallet_transactions SET status='completed' WHERE metadata->>'withdrawal_id'=%s",
            (withdrawal_id,),
        )
        conn.commit()

    if w.get("fee_fcfa"):
        from app.services.fees import credit_platform_fee
        credit_platform_fee(
            Decimal(str(w["fee_fcfa"])),
            source="fiat_withdrawal_admin_confirm",
            ref=withdrawal_id,
        )
    create_notification(
        user_id=w["user_id"],
        notif_type="withdrawal_confirmed",
        title="Retrait confirmé",
        body=f"Votre retrait de {float(w['amount']):,.0f} FCFA a été envoyé.",
    )
    notify_user(
        w["user_id"],
        "Retrait confirmé",
        f"Votre retrait de <b>{float(w['amount']):,.0f} FCFA</b> a été traité et envoyé vers votre compte.",
        success=True,
    )
    record_audit(
        action="confirm_fiat_withdrawal",
        resource=f"fiat_withdrawal:{withdrawal_id}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"amount": float(w["amount"]), "fee_fcfa": float(w.get("fee_fcfa") or 0), "note": body.note},
    )
    return {"status": "confirmed", "withdrawal_id": withdrawal_id}


@router.post("/fiat-withdrawals/{withdrawal_id}/reject")
async def reject_fiat_withdrawal(
    withdrawal_id: str,
    body: FiatWithdrawalActionReq = FiatWithdrawalActionReq(),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_withdrawals WHERE id=%s LIMIT 1", (withdrawal_id,))
        w = cur.fetchone()
    if not w:
        raise HTTPException(404, "Retrait introuvable")
    if w["status"] not in ("pending", "processing", "pending_approval"):
        raise HTTPException(400, f"Retrait déjà traité (statut: {w['status']})")

    total_debit = Decimal(str(w.get("total_debit") or w["amount"]))
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_withdrawals SET status='rejected', reject_reason=%s, updated_at=%s WHERE id=%s",
            (body.reject_reason, now, withdrawal_id),
        )
        # Rembourser le montant total débité (amount + frais)
        cur.execute(
            "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
            (total_debit, now, w["user_id"]),
        )
        tx_id = f"tx_{uuid.uuid4().hex}"
        cur.execute(
            """INSERT INTO wallet_transactions
               (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
               VALUES (%s,%s,'credit','fiat_withdrawal_refund','Retrait annulé — remboursement','Kobo',%s,'FCFA','completed',%s,%s)""",
            (tx_id, w["user_id"], total_debit, Json({"withdrawal_id": withdrawal_id}), now),
        )
        conn.commit()

    create_notification(
        user_id=w["user_id"],
        notif_type="withdrawal_rejected",
        title="Retrait refusé",
        body=f"Votre retrait a été refusé. Motif : {body.reject_reason or 'non précisé'}. Fonds remboursés.",
    )
    notify_user(
        w["user_id"],
        "Retrait refusé",
        f"Votre retrait de <b>{float(w['amount']):,.0f} FCFA</b> a été refusé. Motif : <b>{body.reject_reason or 'non précisé'}</b>.<br>Les fonds ont été remboursés sur votre portefeuille.",
        success=False,
    )
    record_audit(
        action="reject_fiat_withdrawal",
        resource=f"fiat_withdrawal:{withdrawal_id}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"amount": float(w["amount"]), "total_debit": float(total_debit), "reason": body.reject_reason or ""},
    )
    return {"status": "rejected", "withdrawal_id": withdrawal_id}


@router.post("/fiat-withdrawals/{withdrawal_id}/retry-payout")
async def retry_fiat_withdrawal_payout(
    withdrawal_id: str,
    background_tasks: BackgroundTasks,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Re-déclenche le paiement SharePay pour un retrait Mobile Money coincé ou complété sans paiement."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_withdrawals WHERE id=%s LIMIT 1", (withdrawal_id,))
        w = cur.fetchone()
    if not w:
        raise HTTPException(404, "Retrait introuvable")
    if w["method"] != "mobile_money":
        raise HTTPException(400, "Retry disponible uniquement pour les retraits Mobile Money")

    new_reference = f"WIT-R-{uuid.uuid4().hex[:10].upper()}"
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_withdrawals SET status='processing', note=%s, notchpay_txid=NULL, updated_at=%s WHERE id=%s",
            (f"Retry admin — réf {new_reference}", now, withdrawal_id),
        )
        cur.execute(
            "UPDATE wallet_transactions SET status='processing' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
            (withdrawal_id,),
        )
        conn.commit()

    await trigger_payout_retry(withdrawal_id, background_tasks, new_reference)

    record_audit(
        action="retry_fiat_withdrawal_payout",
        resource=f"fiat_withdrawal:{withdrawal_id}",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"amount": float(w["amount"]), "new_reference": new_reference},
    )
    return {"ok": True, "withdrawal_id": withdrawal_id, "new_reference": new_reference, "status": "processing"}


# ── Force-override status ─────────────────────────────────────────────────────

_VALID_WITHDRAWAL_STATUSES = {"pending", "processing", "completed", "failed", "rejected"}


class ForceStatusReq(BaseModel):
    status: str
    note: str = ""
    reject_reason: str = ""


@router.patch("/fiat-withdrawals/{withdrawal_id}/force-status")
async def force_fiat_withdrawal_status(
    withdrawal_id: str,
    body: ForceStatusReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    if body.status not in _VALID_WITHDRAWAL_STATUSES:
        raise HTTPException(400, f"Statut invalide. Valeurs acceptées : {', '.join(sorted(_VALID_WITHDRAWAL_STATUSES))}")

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_withdrawals WHERE id=%s LIMIT 1", (withdrawal_id,))
        w = cur.fetchone()
    if not w:
        raise HTTPException(404, "Retrait introuvable")

    now = utcnow()
    prev_status = w["status"]

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT
                   COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund' THEN amount ELSE 0 END), 0) AS refunded_amount,
                   COALESCE(SUM(CASE WHEN category='fiat_withdrawal_refund_reversal' THEN amount ELSE 0 END), 0) AS reversed_amount
               FROM wallet_transactions
               WHERE category IN ('fiat_withdrawal_refund', 'fiat_withdrawal_refund_reversal')
                 AND metadata->>'withdrawal_id'=%s""",
            (withdrawal_id,),
        )
        refund_state = cur.fetchone() or (Decimal("0"), Decimal("0"))
        refund_balance = Decimal(str(refund_state[0] or 0)) - Decimal(str(refund_state[1] or 0))
        refund_is_open = refund_balance > Decimal("0")

        if refund_is_open and body.status in ("pending", "processing", "completed"):
            raise HTTPException(
                409,
                "Ce retrait a deja ete rembourse. Creez une nouvelle demande de retrait ou effectuez une contrepassation comptable explicite.",
            )

        if prev_status == "completed" and body.status in ("rejected", "failed"):
            raise HTTPException(
                409,
                "Ce retrait est deja marque comme paye. Annulation interdite depuis le changement de statut simple.",
            )

        cur.execute(
            "UPDATE fiat_withdrawals SET status=%s, note=%s, reject_reason=%s, updated_at=%s WHERE id=%s",
            (body.status, body.note or w.get("note") or "", body.reject_reason or w.get("reject_reason") or "", now, withdrawal_id),
        )
        cur.execute(
            "UPDATE wallet_transactions SET status=%s WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
            (body.status, withdrawal_id),
        )

        refunded = False
        if body.status in ("rejected", "failed") and not refund_is_open:
            total_debit = Decimal(str(w.get("total_debit") or w["amount"]))
            cur.execute(
                "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
                (total_debit, now, w["user_id"]),
            )
            refund_tx_id = f"tx_{uuid.uuid4().hex}"
            cur.execute(
                """INSERT INTO wallet_transactions
                   (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
                   VALUES (%s,%s,'credit','fiat_withdrawal_refund','Retrait annulé — remboursement admin','Kobo',%s,'FCFA','completed',%s,%s)""",
                (refund_tx_id, w["user_id"], total_debit, Json({"withdrawal_id": withdrawal_id, "forced_by_admin": True}), now),
            )
            refunded = True

        conn.commit()

    if refunded:
        create_notification(
            user_id=w["user_id"],
            notif_type="withdrawal_refunded",
            title="Retrait annulé — remboursé",
            body=f"Votre retrait de {float(w['amount']):,.0f} FCFA a été annulé. Les fonds ont été remboursés sur votre compte Kobo.",
            metadata={"withdrawal_id": withdrawal_id},
        )

    actor = _get_actor_email(x_admin_token)
    record_audit(
        action="force_withdrawal_status",
        resource=f"fiat_withdrawal:{withdrawal_id}",
        actor_identifier=actor,
        metadata={"from": prev_status, "to": body.status, "note": body.note, "refunded": refunded},
    )

    return {
        "ok": True,
        "withdrawal_id": withdrawal_id,
        "previous_status": prev_status,
        "new_status": body.status,
        "refunded": refunded,
    }


# ── Force-status generics ─────────────────────────────────────────────────────

_VALID_FIAT_DEPOSIT_STATUSES  = {"pending", "processing", "completed", "failed", "rejected"}
_VALID_CRYPTO_DEPOSIT_STATUSES = {"submitted", "confirmed", "rejected", "failed"}
_VALID_CRYPTO_WITHDRAW_STATUSES = {"pending", "processing", "completed", "rejected", "failed"}
_VALID_VIREMENT_STATUSES       = {"pending", "processing", "completed", "rejected", "failed", "cancelled"}
_VALID_INTL_STATUSES           = {"pending_payment", "pending_settlement", "completed", "cancelled", "rejected", "failed"}
_VALID_KYC_STATUSES            = {"pending", "in_review", "approved", "rejected"}


@router.patch("/fiat-deposits/{deposit_id}/force-status")
async def force_fiat_deposit_status(
    deposit_id: str,
    body: ForceStatusReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    if body.status not in _VALID_FIAT_DEPOSIT_STATUSES:
        raise HTTPException(400, f"Statut invalide. Valeurs : {', '.join(sorted(_VALID_FIAT_DEPOSIT_STATUSES))}")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_deposits WHERE id=%s LIMIT 1", (deposit_id,))
        dep = cur.fetchone()
        if not dep:
            raise HTTPException(404, "Dépôt introuvable")
        prev = dep["status"]
        if prev == "completed" and body.status in ("pending", "processing"):
            raise HTTPException(409, "Ce dépôt est deja credite. Retour vers un statut actif interdit sans contrepassation.")
        if body.status == "completed":
            if prev != "completed":
                _credit_fiat_deposit(cur, dep, body.note, forced=True)
        elif body.status in ("failed", "rejected"):
            credited, reversed_amount = _fiat_deposit_credit_state(cur, deposit_id)
            if credited > reversed_amount:
                _reverse_fiat_deposit_credit(cur, dep, body.note or body.reject_reason, forced=True)
        cur.execute(
            "UPDATE fiat_deposits SET status=%s, note=%s, reject_reason=%s, updated_at=%s WHERE id=%s",
            (body.status, body.note or dep.get("note") or "", body.reject_reason or dep.get("reject_reason") or "", utcnow(), deposit_id),
        )
        conn.commit()
    actor = _get_actor_email(x_admin_token)
    record_audit(action="force_fiat_deposit_status", resource=f"fiat_deposit:{deposit_id}",
                 actor_identifier=actor, metadata={"from": prev, "to": body.status, "note": body.note})
    return {"ok": True, "id": deposit_id, "previous_status": prev, "new_status": body.status}


@router.patch("/crypto/deposits/{deposit_id}/force-status")
async def force_crypto_deposit_status(
    deposit_id: str,
    body: ForceStatusReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    if body.status not in _VALID_CRYPTO_DEPOSIT_STATUSES:
        raise HTTPException(400, f"Statut invalide. Valeurs : {', '.join(sorted(_VALID_CRYPTO_DEPOSIT_STATUSES))}")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM crypto_deposits WHERE id=%s LIMIT 1", (deposit_id,))
        dep = cur.fetchone()
        if not dep:
            raise HTTPException(404, "Dépôt crypto introuvable")
        prev = dep["status"]
        credited_xaf = None

        # When forcing to completed/confirmed, credit wallet if not already done
        if body.status in ("completed", "confirmed") and prev not in ("completed", "confirmed"):
            cur.execute(
                "SELECT id FROM wallet_transactions WHERE metadata->>'deposit_id'=%s AND status='completed' LIMIT 1",
                (deposit_id,)
            )
            already_credited = cur.fetchone()
            if not already_credited:
                amount_xaf = dep.get("amount_xaf") or 0
                user_id = dep["user_id"]
                now = utcnow()
                cur.execute(
                    """INSERT INTO wallet_accounts (user_id, currency, balance, address, metadata, created_at, updated_at)
                       VALUES (%s,'FCFA',%s,NULL,'{}'::jsonb,%s,%s)
                       ON CONFLICT (user_id, currency)
                       DO UPDATE SET balance = wallet_accounts.balance + EXCLUDED.balance, updated_at = %s""",
                    (user_id, amount_xaf, now, now, now),
                )
                tx_id = f"tx_{uuid.uuid4().hex[:16]}"
                cur.execute(
                    """INSERT INTO wallet_transactions
                       (id,user_id,direction,category,label,counterpart,amount,currency,status,metadata,created_at)
                       VALUES (%s,%s,'credit','crypto_deposit','Dépôt crypto — forçage admin',%s,%s,'FCFA','completed',%s,%s)""",
                    (tx_id, user_id, dep.get("tx_hash") or "crypto", amount_xaf,
                     Json({"deposit_id": deposit_id, "forced_by_admin": True, "network": dep.get("network", "")}), now),
                )
                credited_xaf = float(amount_xaf)
                try:
                    create_notification(
                        user_id, "deposit_confirmed", "Dépôt confirmé",
                        f"Votre dépôt de {float(amount_xaf):,.0f} FCFA a été confirmé et crédité sur votre compte.",
                        {"deposit_id": deposit_id, "amount_xaf": float(amount_xaf)},
                    )
                except Exception:
                    pass

        cur.execute("UPDATE crypto_deposits SET status=%s, updated_at=%s WHERE id=%s", (body.status, utcnow(), deposit_id))
        conn.commit()

    actor = _get_actor_email(x_admin_token)
    record_audit(action="force_crypto_deposit_status", resource=f"crypto_deposit:{deposit_id}",
                 actor_identifier=actor, metadata={"from": prev, "to": body.status, "credited_xaf": credited_xaf, "note": body.note})
    return {"ok": True, "id": deposit_id, "previous_status": prev, "new_status": body.status, "credited_xaf": credited_xaf}


@router.patch("/crypto/withdrawals/{withdrawal_id}/force-status")
async def force_crypto_withdrawal_status(
    withdrawal_id: str,
    body: ForceStatusReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    if body.status not in _VALID_CRYPTO_WITHDRAW_STATUSES:
        raise HTTPException(400, f"Statut invalide. Valeurs : {', '.join(sorted(_VALID_CRYPTO_WITHDRAW_STATUSES))}")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM crypto_withdrawals WHERE id=%s LIMIT 1", (withdrawal_id,))
        w = cur.fetchone()
        if not w:
            raise HTTPException(404, "Retrait crypto introuvable")
        prev = w["status"]
        cur.execute("UPDATE crypto_withdrawals SET status=%s, updated_at=%s WHERE id=%s", (body.status, utcnow(), withdrawal_id))
        conn.commit()
    actor = _get_actor_email(x_admin_token)
    record_audit(action="force_crypto_withdrawal_status", resource=f"crypto_withdrawal:{withdrawal_id}",
                 actor_identifier=actor, metadata={"from": prev, "to": body.status, "note": body.note})
    return {"ok": True, "id": withdrawal_id, "previous_status": prev, "new_status": body.status}


@router.patch("/virements/{tx_id}/force-status")
async def force_virement_status(
    tx_id: str,
    body: ForceStatusReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    if body.status not in _VALID_VIREMENT_STATUSES:
        raise HTTPException(400, f"Statut invalide. Valeurs : {', '.join(sorted(_VALID_VIREMENT_STATUSES))}")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM wallet_transactions WHERE id=%s AND category='withdraw' LIMIT 1", (tx_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(404, "Virement introuvable")
        prev = tx["status"]
        cur.execute("UPDATE wallet_transactions SET status=%s WHERE id=%s", (body.status, tx_id))
        conn.commit()
    actor = _get_actor_email(x_admin_token)
    record_audit(action="force_virement_status", resource=f"virement:{tx_id}",
                 actor_identifier=actor, metadata={"from": prev, "to": body.status, "note": body.note})
    return {"ok": True, "id": tx_id, "previous_status": prev, "new_status": body.status}


@router.patch("/intl-transfers/{transfer_id}/force-status")
async def force_intl_transfer_status(
    transfer_id: str,
    body: ForceStatusReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    if body.status not in _VALID_INTL_STATUSES:
        raise HTTPException(400, f"Statut invalide. Valeurs : {', '.join(sorted(_VALID_INTL_STATUSES))}")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id=%s LIMIT 1", (transfer_id,))
        t = cur.fetchone()
        if not t:
            raise HTTPException(404, "Transfert introuvable")
        prev = t["status"]
        cur.execute("UPDATE transfers SET status=%s, updated_at=%s WHERE id=%s", (body.status, utcnow(), transfer_id))
        conn.commit()
    actor = _get_actor_email(x_admin_token)
    record_audit(action="force_intl_transfer_status", resource=f"intl_transfer:{transfer_id}",
                 actor_identifier=actor, metadata={"from": prev, "to": body.status, "note": body.note})
    return {"ok": True, "id": transfer_id, "previous_status": prev, "new_status": body.status}


@router.patch("/kyc/{profile_id}/force-status")
async def force_kyc_status(
    profile_id: str,
    body: ForceStatusReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    if body.status not in _VALID_KYC_STATUSES:
        raise HTTPException(400, f"Statut invalide. Valeurs : {', '.join(sorted(_VALID_KYC_STATUSES))}")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM kyc_profiles WHERE id=%s LIMIT 1", (profile_id,))
        kp = cur.fetchone()
        if not kp:
            raise HTTPException(404, "Profil KYC introuvable")
        prev = kp["status"]
        cur.execute("UPDATE kyc_profiles SET status=%s, updated_at=%s WHERE id=%s", (body.status, utcnow(), profile_id))
        if body.status == "approved":
            cur.execute(
                "UPDATE users SET profile=jsonb_set(profile, '{kycLevel}', %s::jsonb) WHERE id=%s",
                (str(kp.get("level", 1)), kp["user_id"]),
            )
        conn.commit()
    actor = _get_actor_email(x_admin_token)
    record_audit(action="force_kyc_status", resource=f"kyc:{profile_id}",
                 actor_identifier=actor, metadata={"from": prev, "to": body.status, "note": body.note, "user_id": kp["user_id"]})
    return {"ok": True, "id": profile_id, "previous_status": prev, "new_status": body.status}


# ── Email Marketing Blast ─────────────────────────────────────────────────────

class EmailBlastReq(BaseModel):
    subject: str
    body_html: str
    target: str = "all"  # "all" | "kyc_verified" | "kyc_not_completed" | "active_30d"
    test_email: str = ""  # if set, send only to this address (preview/test)


@router.post("/email-blast")
async def send_email_blast(
    body: EmailBlastReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    from app.services.email import send_email, _user_html

    # Test mode: send to a single address only
    if body.test_email and "@" in body.test_email:
        html = _user_html(body.subject, body.body_html, success=True)
        try:
            send_email(body.test_email, f"Kobo — {body.subject}", html)
            return {"sent": 1, "failed": 0, "test": True}
        except Exception as exc:
            raise HTTPException(500, f"Erreur envoi test : {exc}") from exc

    # Build recipient list based on target
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if body.target == "kyc_verified":
            cur.execute(
                """SELECT DISTINCT u.email FROM users u
                   JOIN kyc_profiles kp ON kp.user_id = u.id
                   WHERE kp.status = 'approved' AND u.email IS NOT NULL AND u.email LIKE '%@%'"""
            )
        elif body.target == "kyc_not_completed":
            cur.execute(
                """SELECT DISTINCT u.email FROM users u
                   WHERE u.email IS NOT NULL AND u.email LIKE '%@%'
                   AND NOT EXISTS (
                       SELECT 1 FROM kyc_profiles kp
                       WHERE kp.user_id = u.id AND kp.status = 'approved'
                   )"""
            )
        elif body.target == "active_30d":
            cur.execute(
                """SELECT DISTINCT u.email FROM users u
                   JOIN sessions s ON s.user_id = u.id
                   WHERE s.created_at >= NOW() - INTERVAL '30 days'
                   AND u.email IS NOT NULL AND u.email LIKE '%@%'"""
            )
        else:  # all
            cur.execute("SELECT email FROM users WHERE email IS NOT NULL AND email LIKE '%@%'")
        rows = cur.fetchall() or []

    emails = [r["email"] for r in rows if r.get("email") and "@" in r["email"]]
    if not emails:
        return {"sent": 0, "failed": 0}

    sent, failed = 0, 0
    html_template = _user_html(body.subject, body.body_html, success=True)
    for email in emails:
        try:
            send_email(email, f"Kobo — {body.subject}", html_template)
            sent += 1
        except Exception:
            failed += 1

    return {"sent": sent, "failed": failed, "total": len(emails)}




class LifecycleAutomationSettingsReq(BaseModel):
    enabled: bool = False
    daily_cap: int = 50
    interval_seconds: int = 86400


class LifecycleEmailReq(BaseModel):
    campaign_key: str = "dormant_30d"
    segment: str = "all_active"
    test_email: str = ""
    limit: int = 500
    dry_run: bool = True




@router.get("/lifecycle-emails/settings")
async def lifecycle_email_settings(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    from app.services.lifecycle_email import get_automation_settings
    return get_automation_settings()


@router.put("/lifecycle-emails/settings")
async def lifecycle_email_update_settings(
    body: LifecycleAutomationSettingsReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    actor = _get_actor_email(x_admin_token)
    from app.services.lifecycle_email import set_automation_settings
    result = set_automation_settings(enabled=body.enabled, daily_cap=body.daily_cap, interval_seconds=body.interval_seconds)
    record_audit(action="lifecycle_email_settings_update", resource="email:automation", actor_identifier=actor, metadata=result)
    return result

@router.get("/lifecycle-emails/templates")
async def lifecycle_email_templates(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    from app.services.lifecycle_email import available_campaigns
    return {
        "templates": available_campaigns(),
        "segments": ["all_active", "active_30d", "kyc_pending", "no_first_deposit", "dormant_30d"],
    }


@router.post("/lifecycle-emails/send")
async def lifecycle_email_send(
    body: LifecycleEmailReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    actor = _get_actor_email(x_admin_token)
    from app.services.lifecycle_email import send_campaign
    try:
        result = send_campaign(
            campaign_key=body.campaign_key,
            segment=body.segment,
            actor=actor,
            test_email=body.test_email,
            limit=body.limit,
            dry_run=body.dry_run,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    record_audit(action="lifecycle_email_send", resource=f"email:{body.campaign_key}", actor_identifier=actor, metadata=result)
    return result


@router.post("/lifecycle-emails/run-automation")
async def lifecycle_email_run_automation(
    limit: int = 50,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token, {"superadmin"})
    actor = _get_actor_email(x_admin_token)
    from app.services.lifecycle_email import run_automatic_lifecycle
    result = run_automatic_lifecycle(max_total=limit)
    record_audit(action="lifecycle_email_automation_run", resource="email:automation", actor_identifier=actor, metadata=result)
    return result


@router.get("/lifecycle-emails/campaigns")
async def lifecycle_email_campaigns(
    limit: int = 50,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    from app.services.lifecycle_email import list_campaigns
    return {"items": list_campaigns(limit=limit)}


# ── Fraud Cron ─────────────────────────────────────────────────────────────────

@router.post("/fraud-scan/run")
async def trigger_fraud_scan(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Trigger an immediate fraud scan (runs in background thread)."""
    _require_admin(x_admin_token)
    from app.services.fraud_cron import run_fraud_scan
    import asyncio
    result = await asyncio.get_event_loop().run_in_executor(None, run_fraud_scan)
    return result


@router.get("/fraud-scan/results")
async def list_fraud_scan_results(
    limit: int = 50,
    offset: int = 0,
    action: str | None = None,
    reviewed: bool | None = None,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        filters, params = [], []
        if action:
            filters.append("fsr.action = %s")
            params.append(action)
        if reviewed is not None:
            filters.append("fsr.reviewed = %s")
            params.append(reviewed)
        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        cur.execute(
            f"""SELECT fsr.*, u.email, u.phone_e164
                FROM fraud_scan_results fsr
                JOIN users u ON u.id = fsr.user_id
                {where}
                ORDER BY fsr.created_at DESC
                LIMIT %s OFFSET %s""",
            params + [limit, offset],
        )
        rows = cur.fetchall() or []
        cur.execute(f"SELECT COUNT(*) FROM fraud_scan_results fsr {where}", params)
        total = (cur.fetchone() or {}).get("count", 0)
    return {
        "total": total,
        "items": [
            {
                "id": r["id"],
                "user_id": r["user_id"],
                "email": r["email"],
                "phone": r["phone_e164"],
                "scan_run_id": r["scan_run_id"],
                "risk_score": r["risk_score"],
                "action": r["action"],
                "signals": r["signals"],
                "auto_blocked": r["auto_blocked"],
                "reviewed": r["reviewed"],
                "reviewer_note": r["reviewer_note"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
    }


@router.post("/fraud-scan/results/{result_id}/review")
async def mark_fraud_result_reviewed(
    result_id: str,
    body: dict[str, str] = {},
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Mark a fraud scan result as reviewed (manually processed)."""
    _require_admin(x_admin_token)
    note = body.get("note", "")
    reset_score = body.get("reset_score", "false").lower() in ("true", "1", "yes")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "UPDATE fraud_scan_results SET reviewed = TRUE, reviewer_note = %s WHERE id = %s RETURNING user_id",
            (note, result_id),
        )
        row = cur.fetchone()
        if reset_score and row:
            user_id = row["user_id"]
            cur.execute("DELETE FROM fraud_events WHERE user_id = %s", (user_id,))
            cur.execute(
                "UPDATE fraud_scan_results SET reviewed = TRUE WHERE user_id = %s AND reviewed = FALSE",
                (user_id,),
            )
        conn.commit()
    return {"ok": True}


@router.delete("/fraud/cleanup")
async def fraud_cleanup(
    days: int = 90,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Supprimer les données de fraude (fraud_events + fraud_scan_results révisés) antérieures à N jours."""
    _require_admin(x_admin_token, {"superadmin"})
    if days < 7:
        raise HTTPException(400, "La période minimale de rétention est de 7 jours.")
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM fraud_events WHERE created_at < NOW() - make_interval(days => %s)",
            (days,),
        )
        deleted_events = cur.rowcount
        cur.execute(
            "DELETE FROM fraud_scan_results WHERE reviewed = TRUE AND created_at < NOW() - make_interval(days => %s)",
            (days,),
        )
        deleted_results = cur.rowcount
        conn.commit()
    record_audit(
        action="fraud_cleanup",
        resource="fraud",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"days": days, "deleted_events": deleted_events, "deleted_results": deleted_results},
    )
    return {"ok": True, "deleted_events": deleted_events, "deleted_results": deleted_results}


@router.delete("/fraud/cleanup/all")
async def fraud_cleanup_all(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Supprimer TOUS les résultats de scan de fraude et les événements associés."""
    _require_admin(x_admin_token, {"superadmin"})
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM fraud_events")
        deleted_events = cur.rowcount
        cur.execute("DELETE FROM fraud_scan_results")
        deleted_results = cur.rowcount
        conn.commit()
    record_audit(
        action="fraud_cleanup_all",
        resource="fraud",
        actor_identifier=_get_actor_email(x_admin_token),
        metadata={"deleted_events": deleted_events, "deleted_results": deleted_results},
    )
    return {"ok": True, "deleted_events": deleted_events, "deleted_results": deleted_results}


# ── Retraits plateforme (sys_kobo_platform) ────────────────────────────────────

_PLATFORM_UID = "sys_kobo_platform"


class PlatformWithdrawReq(BaseModel):
    amount: Decimal = Field(..., gt=0)
    method: str = Field(pattern="^(mobile_money|bank_transfer)$")
    destination: str = Field(min_length=2, max_length=100)
    note: str = Field(default="", max_length=240)


@router.post("/platform/withdraw")
async def platform_withdraw(
    req: PlatformWithdrawReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Retrait admin depuis le compte de revenus Kobo (sys_kobo_platform)."""
    _require_admin(x_admin_token, {"superadmin"})
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT COALESCE(balance, 0) as bal FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA' LIMIT 1 FOR UPDATE",
            (_PLATFORM_UID,),
        )
        row = cur.fetchone()
        balance = Decimal(str(row["bal"])) if row else Decimal("0")
        if balance < req.amount:
            raise HTTPException(400, f"Solde insuffisant. Disponible : {float(balance):,.0f} FCFA")

        wid = f"pw_{uuid.uuid4().hex}"
        tx_id = f"tx_{uuid.uuid4().hex[:16]}"

        cur.execute(
            "UPDATE wallet_accounts SET balance = balance - %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
            (req.amount, now, _PLATFORM_UID),
        )
        cur.execute(
            """INSERT INTO wallet_transactions
               (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
               VALUES (%s, %s, 'debit', 'platform_withdrawal', %s, %s, %s, 'FCFA', 'completed', %s, %s)""",
            (tx_id, _PLATFORM_UID, f"Retrait plateforme — {req.method}", req.destination,
             req.amount, Json({"withdrawal_id": wid, "method": req.method, "destination": req.destination}), now),
        )
        cur.execute(
            """INSERT INTO platform_withdrawals (id, amount, method, destination, note, status, created_at)
               VALUES (%s, %s, %s, %s, %s, 'completed', %s)""",
            (wid, req.amount, req.method, req.destination, req.note, now),
        )
        conn.commit()

    return {
        "ok": True,
        "withdrawal_id": wid,
        "amount": float(req.amount),
        "new_balance": float(balance - req.amount),
    }


@router.get("/payment-links")
async def list_admin_payment_links(
    limit: int = 200,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Liste tous les liens de paiement avec leurs statistiques."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT pl.id, pl.user_id, pl.amount, pl.currency, pl.description,
                      pl.creator_name, pl.status, pl.max_uses, pl.use_count,
                      pl.expires_at, pl.created_at,
                      u.email AS user_email, u.phone_e164 AS user_phone,
                      COUNT(t.id)                                          AS tx_count,
                      COUNT(t.id) FILTER (WHERE t.status = 'completed')    AS paid_count,
                      COALESCE(SUM(t.net_fcfa) FILTER (WHERE t.status = 'completed'), 0) AS total_collected
               FROM payment_links pl
               LEFT JOIN users u ON u.id = pl.user_id
               LEFT JOIN payment_link_txs t ON t.link_id = pl.id
               WHERE pl.status != 'deleted'
               GROUP BY pl.id, u.email, u.phone_e164
               ORDER BY pl.created_at DESC
               LIMIT %s""",
            (limit,),
        )
        rows = cur.fetchall() or []
    return {
        "count": len(rows),
        "items": [
            {
                "id": r["id"],
                "user_id": str(r["user_id"]),
                "user_email": r["user_email"] or "",
                "user_phone": r["user_phone"] or "",
                "creator_name": r["creator_name"] or "",
                "amount": float(r["amount"]),
                "currency": r["currency"],
                "description": r["description"],
                "status": r["status"],
                "max_uses": r["max_uses"],
                "use_count": r["use_count"] or 0,
                "expires_at": r["expires_at"].isoformat() if r["expires_at"] else None,
                "created_at": r["created_at"].isoformat(),
                "tx_count": r["tx_count"] or 0,
                "paid_count": r["paid_count"] or 0,
                "total_collected": float(r["total_collected"]),
                "url": f"https://koboonline.com/pay/{r['id']}",
            }
            for r in rows
        ],
    }


class AdminPauseLinkReq(BaseModel):
    pass  # no body needed


@router.get("/payment-links/{link_id}/transactions")
async def admin_list_link_transactions(
    link_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        link = cur.fetchone()
    if not link:
        raise HTTPException(404, "Lien introuvable")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT id, payer_phone, provider, amount, net_fcfa, status, reference,
                      aggregator_txid, created_at, updated_at
               FROM payment_link_txs
               WHERE link_id = %s
               ORDER BY created_at DESC
               LIMIT 200""",
            (link_id,),
        )
        rows = cur.fetchall() or []
    items = []
    for r in rows:
        d = dict(r)
        d["amount"] = float(d["amount"] or 0)
        d["net_fcfa"] = float(d["net_fcfa"] or 0)
        phone = d.get("payer_phone") or ""
        d["payer_phone_display"] = (phone[:6] + "***" + phone[-3:]) if len(phone) >= 6 else (phone or "—")
        d["created_at"] = d["created_at"].isoformat() if d["created_at"] else None
        d["updated_at"] = d["updated_at"].isoformat() if d["updated_at"] else None
        items.append(d)
    return {
        "link_id": link_id,
        "description": link["description"],
        "amount": float(link["amount"]),
        "items": items,
    }


@router.patch("/payment-links/{link_id}/pause")
async def admin_toggle_link_pause(
    link_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT user_id, status, description, amount FROM payment_links WHERE id=%s AND status!='deleted' LIMIT 1",
            (link_id,),
        )
        link = cur.fetchone()
    if not link:
        raise HTTPException(404, "Lien introuvable")
    new_status = "active" if link["status"] == "suspended" else "suspended"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE payment_links SET status=%s, updated_at=%s WHERE id=%s",
            (new_status, utcnow(), link_id),
        )
        conn.commit()
    uid = str(link["user_id"])
    desc = link["description"]
    amount = float(link["amount"])
    try:
        if new_status == "suspended":
            create_notification(
                uid, "deposit_rejected",
                "Lien de paiement suspendu",
                f"Votre lien « {desc} » ({int(amount):,} FCFA) a été suspendu par l'administration.".replace(",", " "),
                {"link_id": link_id},
            )
            notify_user(
                uid,
                "Lien de paiement suspendu",
                f"Votre lien de paiement <b>« {desc} »</b> ({int(amount):,} FCFA) a été <b>suspendu</b> par l'administration Kobo.<br><br>"
                f"Les paiements via ce lien ne seront plus acceptés tant qu'il est suspendu.<br>"
                f"Pour toute question, contactez le support.",
                success=False,
            )
        else:
            create_notification(
                uid, "deposit_confirmed",
                "Lien de paiement réactivé",
                f"Votre lien « {desc} » ({int(amount):,} FCFA) a été réactivé.".replace(",", " "),
                {"link_id": link_id},
            )
            notify_user(
                uid,
                "Lien de paiement réactivé",
                f"Votre lien de paiement <b>« {desc} »</b> ({int(amount):,} FCFA) a été <b>réactivé</b> par l'administration Kobo.<br><br>"
                f"Les paiements via ce lien sont à nouveau acceptés.",
                success=True,
            )
    except Exception:
        pass
    return {"ok": True, "status": new_status}


class AdminDeleteLinkReq(BaseModel):
    reason: str = Field(default="", max_length=400)


@router.get("/payment-links/txs/pending-crypto")
async def admin_pending_crypto_txs(
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Liste toutes les transactions crypto en attente de validation manuelle."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT t.id, t.link_id, t.provider, t.amount, t.net_fcfa,
                      t.status, t.aggregator_txid, t.created_at,
                      pl.description AS link_desc, pl.user_id AS creator_id,
                      u.profile->>'fullName' AS creator_name, u.phone_e164 AS creator_phone
               FROM payment_link_txs t
               JOIN payment_links pl ON pl.id = t.link_id
               LEFT JOIN users u ON u.id = pl.user_id
               WHERE t.provider = 'crypto_trc20' AND t.status = 'pending'
               ORDER BY t.created_at ASC
               LIMIT 200"""
        )
        rows = cur.fetchall() or []
    items = []
    for r in rows:
        d = dict(r)
        d["amount"] = float(d["amount"] or 0)
        d["net_fcfa"] = float(d["net_fcfa"] or 0)
        d["created_at"] = d["created_at"].isoformat() if d["created_at"] else None
        items.append(d)
    return {"items": items, "total": len(items)}


@router.post("/payment-links/txs/{tx_id}/confirm-crypto")
async def admin_confirm_crypto_tx(
    tx_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Re-verifie TronScan/TronGrid puis credite une transaction crypto en attente."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT t.*, pl.user_id AS creator_id, pl.description AS link_desc
               FROM payment_link_txs t
               JOIN payment_links pl ON pl.id = t.link_id
               WHERE t.id = %s LIMIT 1""",
            (tx_id,)
        )
        tx = cur.fetchone()
    if not tx:
        raise HTTPException(404, "Transaction introuvable")
    if tx["status"] == "completed":
        raise HTTPException(409, "Transaction déjà confirmée")
    if tx["provider"] not in ("crypto_trc20",):
        raise HTTPException(400, "Seules les transactions crypto peuvent être confirmées manuellement")
    if tx["status"] != "pending":
        raise HTTPException(409, "Seules les transactions crypto en attente peuvent être confirmées")
    tx_hash = (tx.get("aggregator_txid") or "").strip()
    if not tx_hash:
        raise HTTPException(400, "Hash TronScan manquant")

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT address FROM crypto_wallets WHERE active=TRUE AND network='TRC20' LIMIT 1")
        wallet = cur.fetchone()
    if not wallet:
        raise HTTPException(503, "Adresse Kobo USDT TRC20 indisponible")

    expected_usdt = (Decimal(str(tx["amount"])) / Decimal("550")).quantize(
        Decimal("0.01"),
        rounding=ROUND_CEILING,
    )
    verification = verify_tx(
        tx_hash=tx_hash,
        network="TRC20",
        expected_to=wallet["address"],
        expected_usdt=expected_usdt,
    )
    if verification.status == "invalid":
        raise HTTPException(400, verification.reason or "Transaction invalide sur TronScan")
    if verification.status == "needs_manual_review":
        raise HTTPException(503, "Verification blockchain indisponible. Reessayez plus tard, aucun credit n'a ete applique.")
    if verification.status != "auto_confirmed":
        raise HTTPException(
            409,
            f"Transaction valide mais pas assez confirmee ({verification.confirmations}/20). Reessayez dans quelques minutes.",
        )

    net = Decimal(str(tx["net_fcfa"]))
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE payment_link_txs SET status='completed', updated_at=%s WHERE id=%s AND status='pending' RETURNING id",
            (now, tx_id)
        )
        if cur.fetchone() is None:
            conn.rollback()
            raise HTTPException(409, "Transaction deja traitee")
        cur.execute(
            "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
            (net, now, tx["creator_id"])
        )
        cur.execute(
            """INSERT INTO wallet_transactions
               (id,user_id,direction,category,label,counterpart,amount,currency,status,metadata,created_at)
               VALUES (%s,%s,'credit','payment_link',%s,'USDT TRC20 (admin)',%s,'FCFA','completed',%s,%s)""",
            (f"wt_{uuid.uuid4().hex[:16]}", tx["creator_id"],
             f"Paiement lien crypto (confirmé admin) : {tx['link_desc']}", net,
             Json({
                 "tx_id": tx_id,
                 "tx_hash": tx_hash,
                 "link_id": tx["link_id"],
                 "amount_usdt": float(verification.amount_usdt or 0),
                 "confirmations": verification.confirmations,
             }), now)
        )
        cur.execute(
            "UPDATE payment_links SET use_count=use_count+1, updated_at=%s WHERE id=%s",
            (now, tx["link_id"])
        )
        conn.commit()
    return {"ok": True, "tx_id": tx_id, "net_credited": float(net)}


@router.post("/payment-links/txs/{tx_id}/reject-crypto")
async def admin_reject_crypto_tx(
    tx_id: str,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Refuse manuellement une transaction crypto en attente et marque comme failed."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_link_txs WHERE id=%s LIMIT 1", (tx_id,))
        tx = cur.fetchone()
    if not tx:
        raise HTTPException(404, "Transaction introuvable")
    if tx["status"] in ("completed", "failed"):
        raise HTTPException(409, f"Transaction déjà traitée (statut: {tx['status']})")
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE payment_link_txs SET status='failed', updated_at=%s WHERE id=%s",
            (utcnow(), tx_id)
        )
        conn.commit()
    return {"ok": True, "tx_id": tx_id, "status": "failed"}


@router.delete("/payment-links/{link_id}")
async def admin_delete_link(
    link_id: str,
    req: AdminDeleteLinkReq,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT user_id, description, amount FROM payment_links WHERE id=%s AND status!='deleted' LIMIT 1",
            (link_id,),
        )
        link = cur.fetchone()
    if not link:
        raise HTTPException(404, "Lien introuvable ou déjà supprimé")
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE payment_links SET status='deleted', updated_at=%s WHERE id=%s",
            (utcnow(), link_id),
        )
        conn.commit()
    uid = str(link["user_id"])
    desc = link["description"]
    amount = float(link["amount"])
    reason_html = f"<br><br><b>Motif :</b> {req.reason}" if req.reason else ""
    try:
        create_notification(
            uid, "deposit_rejected",
            "Lien de paiement supprimé",
            f"Votre lien « {desc} » ({int(amount):,} FCFA) a été supprimé par l'administration.".replace(",", " "),
            {"link_id": link_id},
        )
        notify_user(
            uid,
            "Lien de paiement supprimé",
            f"Votre lien de paiement <b>« {desc} »</b> ({int(amount):,} FCFA) a été <b>supprimé</b> par l'administration Kobo.{reason_html}<br><br>"
            f"Si vous pensez qu'il s'agit d'une erreur, contactez le support.",
            success=False,
        )
    except Exception:
        pass
    return {"ok": True, "link_id": link_id}


@router.get("/platform/withdrawals")
async def list_platform_withdrawals(
    limit: int = 50,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    """Historique des retraits depuis le compte de revenus Kobo."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM platform_withdrawals ORDER BY created_at DESC LIMIT %s",
            (limit,),
        )
        rows = cur.fetchall() or []
    return {
        "items": [
            {
                "id": r["id"],
                "amount": float(r["amount"]),
                "method": r["method"],
                "destination": r["destination"],
                "note": r["note"] or "",
                "status": r["status"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }
