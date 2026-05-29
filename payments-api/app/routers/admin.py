from __future__ import annotations

import uuid
from contextlib import closing
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, Header, HTTPException
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.time import utcnow
from app.db.session import get_conn
from app.services.serializers import serialize_transfer

router = APIRouter(prefix="/admin", tags=["admin"])


def _require_admin(token: str | None) -> None:
    if not settings.dev_admin_token:
        raise HTTPException(status_code=404, detail="Not found")
    if not token or token != settings.dev_admin_token:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _header(token: str | None = Header(default=None, alias="X-Admin-Token")) -> str | None:
    return token


# ── Users ────────────────────────────────────────────────────────────────────


@router.get("/users")
async def list_users(
    limit: int = 50,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT id, phone_e164, profile, created_at FROM users ORDER BY created_at DESC LIMIT %s",
            (limit,),
        )
        rows = cur.fetchall() or []
    return {
        "count": len(rows),
        "items": [
            {
                "id": r["id"],
                "phone_e164": r["phone_e164"],
                "profile": r["profile"],
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
                SELECT kp.user_id, kp.level, kp.status, kp.updated_at, u.phone_e164
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
                SELECT kp.user_id, kp.level, kp.status, kp.updated_at, u.phone_e164
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
                "level": r["level"],
                "status": r["status"],
                "updated_at": r["updated_at"].isoformat(),
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
            }
            for r in rows
        ],
    }


# ── Transfers ─────────────────────────────────────────────────────────────────


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
        cur.execute("SELECT status FROM crypto_deposits WHERE id = %s", (deposit_id,))
        dep = cur.fetchone()
        if not dep:
            raise HTTPException(status_code=404, detail="Dépôt introuvable")
        if dep["status"] in ("confirmed", "rejected"):
            raise HTTPException(status_code=409, detail=f"Déjà en statut '{dep['status']}'")
        cur.execute(
            "UPDATE crypto_deposits SET status='rejected', reject_reason=%s, updated_at=%s WHERE id=%s",
            (req.reason, utcnow(), deposit_id),
        )
        conn.commit()
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
    """Rejeter un retrait et rembourser le solde FCFA."""
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM wallet_transactions WHERE id = %s AND category = 'withdraw'", (tx_id,))
        tx = cur.fetchone()
        if not tx:
            raise HTTPException(status_code=404, detail="Transaction introuvable")
        if tx["status"] not in ("pending", "processing"):
            raise HTTPException(status_code=400, detail=f"Statut actuel '{tx['status']}' non modifiable")
        cur.execute("UPDATE wallet_transactions SET status = 'rejected' WHERE id = %s", (tx_id,))
        # Rembourser le solde
        cur.execute(
            "UPDATE wallet_accounts SET balance = balance + %s, updated_at = NOW() WHERE user_id = %s AND currency = %s",
            (tx["amount"], tx["user_id"], tx["currency"]),
        )
        conn.commit()
    return {"ok": True, "transaction_id": tx_id, "status": "rejected", "refunded": float(tx["amount"])}


# ── Paramètres ────────────────────────────────────────────────────────────────

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
        raise HTTPException(status_code=404, detail="Paramètre introuvable")
    return row["value"]


@router.put("/settings/kobo-bank")
async def update_kobo_bank_settings(
    body: KoboBankSettings,
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
) -> dict[str, Any]:
    _require_admin(x_admin_token)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES ('kobo_bank', %s, %s)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at""",
            (Json(body.model_dump()), utcnow()),
        )
        conn.commit()
    return {"ok": True, **body.model_dump()}


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
    return {"ok": True, "transfer_id": transfer_id, "status": "rejected", "refunded_fcfa": refunded}
