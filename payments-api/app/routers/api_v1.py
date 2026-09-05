from __future__ import annotations

"""
Kobo Public API — v1
Auth : Authorization: Bearer kb_live_... | kb_test_...
Frais : 5 % sur chaque paiement (api_payment)
"""

import uuid
from contextlib import closing
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.core.time import utcnow
from app.db.session import get_conn
from app.services import sharepay as sharepay_svc
from app.services.api_auth import (
    generate_api_key, list_api_keys, resolve_api_key, revoke_api_key,
)
from app.services.fees import calculate_fee_fcfa, get_min_amount_fcfa
from app.services.webhook_delivery import (
    delete_webhook, dispatch, get_webhook, register_webhook,
)

router = APIRouter(prefix="/api/v1", tags=["public-api"])

# ── Auth middleware ────────────────────────────────────────────────────────────

class APIUser:
    def __init__(self, d: dict):
        self.key_id       = d["key_id"]
        self.user_id      = d["user_id"]
        self.is_test      = d["is_test"]
        self.merchant_name = d["merchant_name"]
        self.email        = d.get("email")


def _require_api_key(authorization: str | None = Header(default=None)) -> APIUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Clé API manquante — Authorization: Bearer kb_live_...")
    raw = authorization[len("Bearer "):]
    user = resolve_api_key(raw)
    if not user:
        raise HTTPException(401, "Clé API invalide ou révoquée")
    return APIUser(user)


# ── Schemas ────────────────────────────────────────────────────────────────────

class CreatePaymentReq(BaseModel):
    amount: Decimal = Field(..., gt=0, description="Montant en FCFA")
    description: str = Field(..., min_length=2, max_length=200)
    reference: str | None = Field(default=None, max_length=100, description="Votre référence interne")
    success_url: str | None = Field(default=None, max_length=500)
    cancel_url:  str | None = Field(default=None, max_length=500)
    expires_in_hours: int | None = Field(default=None, ge=1, le=8760)
    max_uses: int | None = Field(default=None, ge=1)


class CreateKeyReq(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    is_test: bool = False


class RegisterWebhookReq(BaseModel):
    url: str = Field(..., min_length=10, max_length=500)
    events: list[str] | None = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_balance(user_id: str) -> Decimal:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id=%s AND currency='FCFA' LIMIT 1",
            (user_id,),
        )
        row = cur.fetchone()
    return Decimal(str(row["balance"])) if row else Decimal("0")


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/me")
async def api_me(api_user: APIUser = Depends(_require_api_key)) -> dict[str, Any]:
    """Infos du compte marchand et solde."""
    balance = _get_balance(api_user.user_id)
    return {
        "merchant_name": api_user.merchant_name,
        "email":         api_user.email,
        "is_test":       api_user.is_test,
        "balance_fcfa":  float(balance),
    }


@router.get("/balance")
async def api_balance(api_user: APIUser = Depends(_require_api_key)) -> dict[str, Any]:
    """Solde FCFA disponible."""
    return {"balance_fcfa": float(_get_balance(api_user.user_id)), "currency": "FCFA"}


@router.post("/payment-requests")
async def create_payment_request(
    req: CreatePaymentReq,
    background_tasks: BackgroundTasks,
    api_user: APIUser = Depends(_require_api_key),
) -> dict[str, Any]:
    """
    Crée un lien de paiement Mobile Money.
    Frais Kobo : 5 % prélevés sur le montant reçu.
    Retourne l'URL de paiement à rediriger vers votre client.
    """
    min_amount = get_min_amount_fcfa("api_payment", 100)
    if req.amount < min_amount:
        raise HTTPException(400, f"Montant minimum : {int(min_amount)} FCFA")

    # Calcul des frais affichés au marchand depuis la config admin.
    kobo_fee = calculate_fee_fcfa("api_payment", req.amount)
    net_estimate = req.amount - kobo_fee

    link_id = f"pl_{uuid.uuid4().hex[:16]}"
    merch_ref = req.reference or f"API-{uuid.uuid4().hex[:12].upper()}"
    now = utcnow()
    from datetime import timedelta
    expires_at = (now + timedelta(hours=req.expires_in_hours)) if req.expires_in_hours else None

    success_url = req.success_url or f"https://koboonline.com/pay/{link_id}?status=success&ref={{reference}}"
    cancel_url  = req.cancel_url  or f"https://koboonline.com/pay/{link_id}?status=cancelled"

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO payment_links
               (id, user_id, amount, currency, description, creator_name, status, max_uses, expires_at,
                origin, created_at, updated_at)
               VALUES (%s,%s,%s,'FCFA',%s,%s,'active',%s,%s,'api',%s,%s)""",
            (link_id, api_user.user_id, req.amount, req.description,
             api_user.merchant_name, req.max_uses, expires_at, now, now),
        )
        conn.commit()

    return {
        "id":            link_id,
        "reference":     merch_ref,
        "payment_url":   f"https://koboonline.com/pay/{link_id}",
        "amount":        float(req.amount),
        "currency":      "FCFA",
        "description":   req.description,
        "kobo_fee":      float(kobo_fee),
        "net_estimate":  float(net_estimate),
        "status":        "active",
        "expires_at":    expires_at.isoformat() if expires_at else None,
    }


@router.get("/payment-requests/{link_id}")
async def get_payment_request(
    link_id: str,
    api_user: APIUser = Depends(_require_api_key),
) -> dict[str, Any]:
    """Statut d'un lien de paiement et transactions associées."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT pl.*,
                      COUNT(t.id) FILTER (WHERE t.status='completed') AS paid_count,
                      COALESCE(SUM(t.net_fcfa) FILTER (WHERE t.status='completed'), 0) AS total_collected
               FROM payment_links pl
               LEFT JOIN payment_link_txs t ON t.link_id = pl.id
               WHERE pl.id=%s AND pl.user_id=%s AND pl.status != 'deleted'
               GROUP BY pl.id""",
            (link_id, api_user.user_id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Lien de paiement introuvable")

    return {
        "id":              row["id"],
        "status":          row["status"],
        "amount":          float(row["amount"]),
        "currency":        row["currency"],
        "description":     row["description"],
        "payment_url":     f"https://koboonline.com/pay/{row['id']}",
        "paid_count":      row["paid_count"],
        "total_collected": float(row["total_collected"]),
        "expires_at":      row["expires_at"].isoformat() if row.get("expires_at") else None,
        "created_at":      row["created_at"].isoformat(),
    }


@router.get("/payment-requests")
async def list_payment_requests(
    limit: int = 20,
    offset: int = 0,
    api_user: APIUser = Depends(_require_api_key),
) -> dict[str, Any]:
    """Liste les liens de paiement du marchand (20 par page)."""
    limit = min(limit, 100)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT pl.*,
                      COUNT(t.id) FILTER (WHERE t.status='completed') AS paid_count,
                      COALESCE(SUM(t.net_fcfa) FILTER (WHERE t.status='completed'), 0) AS total_collected
               FROM payment_links pl
               LEFT JOIN payment_link_txs t ON t.link_id = pl.id
               WHERE pl.user_id=%s AND pl.status != 'deleted'
               GROUP BY pl.id
               ORDER BY pl.created_at DESC
               LIMIT %s OFFSET %s""",
            (api_user.user_id, limit, offset),
        )
        rows = cur.fetchall()
        cur.execute(
            "SELECT COUNT(*) FROM payment_links WHERE user_id=%s AND status != 'deleted'",
            (api_user.user_id,),
        )
        total = (cur.fetchone() or {}).get("count", 0)

    return {
        "total": total,
        "items": [
            {
                "id":              r["id"],
                "status":          r["status"],
                "amount":          float(r["amount"]),
                "description":     r["description"],
                "payment_url":     f"https://koboonline.com/pay/{r['id']}",
                "paid_count":      r["paid_count"],
                "total_collected": float(r["total_collected"]),
                "created_at":      r["created_at"].isoformat(),
            }
            for r in rows
        ],
    }


# ── Gestion des clés API (self-service) ───────────────────────────────────────

@router.post("/keys")
async def create_key(
    req: CreateKeyReq,
    api_user: APIUser = Depends(_require_api_key),
) -> dict[str, Any]:
    """Génère une nouvelle clé API. La clé en clair n'est retournée qu'une seule fois."""
    result = generate_api_key(api_user.user_id, req.name, req.is_test)
    return result


@router.get("/keys")
async def list_keys(api_user: APIUser = Depends(_require_api_key)) -> dict[str, Any]:
    """Liste les clés API du marchand (sans les valeurs en clair)."""
    return {"items": list_api_keys(api_user.user_id)}


@router.delete("/keys/{key_id}")
async def delete_key(
    key_id: str,
    api_user: APIUser = Depends(_require_api_key),
) -> dict[str, Any]:
    """Révoque une clé API."""
    ok = revoke_api_key(key_id, api_user.user_id)
    if not ok:
        raise HTTPException(404, "Clé introuvable")
    return {"ok": True}


# ── Webhooks ──────────────────────────────────────────────────────────────────

@router.post("/webhooks")
async def create_webhook(
    req: RegisterWebhookReq,
    api_user: APIUser = Depends(_require_api_key),
) -> dict[str, Any]:
    """Enregistre ou remplace l'URL de webhook pour les événements de paiement."""
    try:
        result = register_webhook(api_user.user_id, req.url, req.events)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


@router.get("/webhooks")
async def get_webhook_endpoint(api_user: APIUser = Depends(_require_api_key)) -> dict[str, Any]:
    """Retourne le webhook enregistré (secret masqué)."""
    ep = get_webhook(api_user.user_id)
    if not ep:
        raise HTTPException(404, "Aucun webhook enregistré")
    ep["secret"] = ep["secret"][:8] + "..." + ep["secret"][-4:]
    return ep


@router.delete("/webhooks/{endpoint_id}")
async def remove_webhook(
    endpoint_id: str,
    api_user: APIUser = Depends(_require_api_key),
) -> dict[str, Any]:
    ok = delete_webhook(endpoint_id, api_user.user_id)
    if not ok:
        raise HTTPException(404, "Webhook introuvable")
    return {"ok": True}
