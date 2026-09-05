from __future__ import annotations

import uuid
from contextlib import closing
from datetime import timedelta
from decimal import ROUND_CEILING, Decimal
from typing import Any

import jwt
import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import AuthUser, require_user
from app.core.time import utcnow
from app.db.session import get_conn
from app.services import notchpay
from app.services import sharepay as sharepay_svc
from app.services.blockchain_verify import verify_tx
from app.services.compliance import enforce_compliance
from app.services.fees import get_fee_config, get_min_amount_fcfa
from app.services.notifications import create_notification
from app.services.otp import start_challenge, verify_challenge

router = APIRouter(prefix="/payment-links", tags=["payment-links"])

_WALLET_TOKEN_MINUTES = 10

_PHONE_PROVIDERS = {"mtn": "cm.mtn", "orange": "cm.orange"}
def _get_operator_collection_rate() -> Decimal:
    """Retourne le taux de collecte de l'opérateur actif (pour le gross-up)."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'payment_provider' LIMIT 1")
        row = cur.fetchone()
    provider = "sharepay"
    if row and isinstance(row["value"], dict):
        provider = row["value"].get("provider", "sharepay")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        key = "sharepay_fee_rate" if provider == "sharepay" else "notchpay_fee_rate"
        cur.execute("SELECT value FROM app_settings WHERE key = %s LIMIT 1", (key,))
        row = cur.fetchone()
    default = Decimal("1.6") if provider == "sharepay" else Decimal("1.5")
    if row and isinstance(row["value"], (int, float)):
        return Decimal(str(row["value"])) / Decimal("100")
    return default / Decimal("100")


def _compute_gross_amount(net_amount: Decimal) -> Decimal:
    """Montant facturé au payeur pour que le créateur reçoive exactement net_amount."""
    kobo_cfg = get_fee_config("payment_link")
    kobo_rate = Decimal(str(kobo_cfg.get("rate", 0))) / Decimal("100")
    kobo_min_fee = Decimal(str(kobo_cfg.get("min_fcfa", 0)))
    op_rate = _get_operator_collection_rate()
    after_operator = Decimal("1") - op_rate
    if after_operator <= 0:
        return net_amount
    gross_candidates = []
    percent_divisor = after_operator * (Decimal("1") - kobo_rate)
    if percent_divisor > 0:
        gross_candidates.append(net_amount / percent_divisor)
    if kobo_min_fee > 0:
        gross_candidates.append((net_amount + kobo_min_fee) / after_operator)
    if not gross_candidates:
        gross_candidates.append(net_amount / after_operator)
    return max(gross_candidates).quantize(Decimal("1"), rounding=ROUND_CEILING)


def _get_active_provider() -> str:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'payment_provider' LIMIT 1")
        row = cur.fetchone()
    if row and isinstance(row["value"], dict):
        return row["value"].get("provider", "sharepay")
    return "sharepay"


class CreateLinkReq(BaseModel):
    amount: Decimal = Field(..., gt=0)
    description: str = Field(..., min_length=2, max_length=200)
    max_uses: int | None = Field(default=None, ge=1)
    expires_in_hours: int | None = Field(default=None, ge=1, le=8760)


class PayLinkReq(BaseModel):
    phone: str | None = Field(default=None)   # requis NotchPay uniquement
    provider: str | None = Field(default=None)  # mtn | orange


@router.post("")
async def create_link(req: CreateLinkReq, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    min_amount = get_min_amount_fcfa("payment_link", 100)
    if req.amount < min_amount:
        raise HTTPException(400, f"Montant minimum : {int(min_amount)} FCFA")

    link_id = f"pl_{uuid.uuid4().hex[:16]}"
    now = utcnow()
    expires_at = (now + timedelta(hours=req.expires_in_hours)) if req.expires_in_hours else None
    gross_amount = _compute_gross_amount(req.amount)

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT email, phone_e164, profile FROM users WHERE id=%s LIMIT 1", (user.id,))
        u = cur.fetchone() or {}
        profile = u.get("profile") or {}
        creator_name = profile.get("fullName") or profile.get("full_name") or u.get("phone_e164") or "Utilisateur Kobo"
        cur.execute(
            """INSERT INTO payment_links
               (id, user_id, amount, currency, description, creator_name, status, max_uses, expires_at, gross_amount, created_at, updated_at)
               VALUES (%s,%s,%s,'FCFA',%s,%s,'active',%s,%s,%s,%s,%s)""",
            (link_id, user.id, req.amount, req.description, creator_name,
             req.max_uses, expires_at, gross_amount, now, now),
        )
        conn.commit()

    return {
        "id": link_id,
        "url": f"https://koboonline.com/pay/{link_id}",
        "amount": float(req.amount),
        "gross_amount": float(gross_amount),
        "currency": "FCFA",
        "description": req.description,
        "creator_name": creator_name,
        "status": "active",
        "max_uses": req.max_uses,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "created_at": now.isoformat(),
    }


@router.get("/me")
async def list_my_links(user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT pl.*,
                      COUNT(t.id) FILTER (WHERE t.status='completed') AS paid_count,
                      COALESCE(SUM(t.net_fcfa) FILTER (WHERE t.status='completed'), 0) AS total_collected
               FROM payment_links pl
               LEFT JOIN payment_link_txs t ON t.link_id = pl.id
               WHERE pl.user_id = %s AND pl.status != 'deleted'
               GROUP BY pl.id
               ORDER BY pl.created_at DESC""",
            (user.id,),
        )
        rows = cur.fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["url"] = f"https://koboonline.com/pay/{d['id']}"
        d["amount"] = float(d["amount"])
        d["total_collected"] = float(d["total_collected"])
        items.append(d)
    return {"items": items}


@router.get("/stats")
async def get_my_stats(user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT
                COUNT(DISTINCT pl.id)                                               AS total_links,
                COUNT(DISTINCT pl.id) FILTER (WHERE pl.status = 'active')           AS active_links,
                COALESCE(SUM(t.net_fcfa) FILTER (WHERE t.status='completed'), 0)    AS total_collected,
                COUNT(t.id) FILTER (WHERE t.status='completed')                     AS total_paid,
                COUNT(t.id) FILTER (WHERE t.status='failed')                        AS total_failed,
                COUNT(t.id)                                                          AS total_txs
               FROM payment_links pl
               LEFT JOIN payment_link_txs t ON t.link_id = pl.id
               WHERE pl.user_id = %s AND pl.status != 'deleted'""",
            (user.id,),
        )
        row = cur.fetchone()
        stats = dict(row) if row else {}

        cur.execute(
            """SELECT TO_CHAR(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
                      COALESCE(SUM(t.net_fcfa), 0)                        AS collected
               FROM payment_link_txs t
               JOIN payment_links pl ON pl.id = t.link_id
               WHERE pl.user_id = %s AND t.status = 'completed'
                 AND t.created_at >= NOW() - INTERVAL '6 months'
               GROUP BY month
               ORDER BY month ASC""",
            (user.id,),
        )
        monthly_rows = cur.fetchall()

        cur.execute(
            """SELECT pl.id, pl.description, pl.amount,
                      COUNT(t.id) FILTER (WHERE t.status='completed')                AS paid_count,
                      COALESCE(SUM(t.net_fcfa) FILTER (WHERE t.status='completed'), 0) AS total_collected
               FROM payment_links pl
               LEFT JOIN payment_link_txs t ON t.link_id = pl.id
               WHERE pl.user_id = %s AND pl.status != 'deleted'
               GROUP BY pl.id
               ORDER BY total_collected DESC
               LIMIT 5""",
            (user.id,),
        )
        top_rows = cur.fetchall()

    total_txs = int(stats.get("total_txs") or 0)
    total_paid = int(stats.get("total_paid") or 0)
    success_rate = round(total_paid / total_txs * 100, 1) if total_txs > 0 else 0.0

    monthly = [{"month": r["month"], "collected": float(r["collected"])} for r in monthly_rows]
    top_links = [
        {
            "id": r["id"],
            "description": r["description"],
            "amount": float(r["amount"]),
            "paid_count": int(r["paid_count"]),
            "total_collected": float(r["total_collected"]),
        }
        for r in top_rows
    ]

    return {
        "total_collected": float(stats.get("total_collected") or 0),
        "total_links": int(stats.get("total_links") or 0),
        "active_links": int(stats.get("active_links") or 0),
        "total_paid": total_paid,
        "total_failed": int(stats.get("total_failed") or 0),
        "total_txs": total_txs,
        "success_rate": success_rate,
        "monthly": monthly,
        "top_links": top_links,
    }


@router.get("/{link_id}")
async def get_my_link(link_id: str, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT pl.*,
                      COUNT(t.id) FILTER (WHERE t.status='completed') AS paid_count,
                      COALESCE(SUM(t.net_fcfa) FILTER (WHERE t.status='completed'), 0) AS total_collected
               FROM payment_links pl
               LEFT JOIN payment_link_txs t ON t.link_id = pl.id
               WHERE pl.id=%s AND pl.user_id=%s AND pl.status != 'deleted'
               GROUP BY pl.id""",
            (link_id, user.id),
        )
        link = cur.fetchone()
    if not link:
        raise HTTPException(404, "Introuvable")
    d = dict(link)
    d["url"] = f"https://koboonline.com/pay/{d['id']}"
    d["amount"] = float(d["amount"])
    d["gross_amount"] = float(d["gross_amount"]) if d.get("gross_amount") else None
    d["total_collected"] = float(d["total_collected"])
    d["paid_count"] = d["paid_count"] or 0
    d["created_at"] = d["created_at"].isoformat() if d.get("created_at") else None
    d["updated_at"] = d["updated_at"].isoformat() if d.get("updated_at") else None
    if d.get("expires_at"):
        d["expires_at"] = d["expires_at"].isoformat()
    return d


@router.get("/{link_id}/transactions")
async def list_link_transactions(link_id: str, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT user_id FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        row = cur.fetchone()
    if not row or row["user_id"] != user.id:
        raise HTTPException(404, "Introuvable")
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT payer_phone, provider, amount, net_fcfa, status, created_at
               FROM payment_link_txs
               WHERE link_id = %s
               ORDER BY created_at DESC
               LIMIT 100""",
            (link_id,),
        )
        rows = cur.fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["amount"] = float(d["amount"] or 0)
        d["net_fcfa"] = float(d["net_fcfa"] or 0)
        # masquer partiellement le numéro : 237691***257
        phone = d.get("payer_phone") or ""
        if len(phone) >= 6:
            d["payer_phone_display"] = phone[:6] + "***" + phone[-3:]
        else:
            d["payer_phone_display"] = phone or "—"
        items.append(d)
    return {"items": items}


@router.get("/{link_id}/public")
async def get_link_public(link_id: str) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT pl.*, u.profile AS creator_profile
               FROM payment_links pl
               LEFT JOIN users u ON u.id = pl.user_id
               WHERE pl.id=%s
               LIMIT 1""",
            (link_id,),
        )
        link = cur.fetchone()
    if not link:
        raise HTTPException(404, "Lien de paiement introuvable")
    now = utcnow()
    if link["status"] not in ("active",):
        raise HTTPException(410, "Ce lien de paiement n'est plus actif")
    if link["expires_at"] and link["expires_at"] < now:
        raise HTTPException(410, "Ce lien de paiement a expiré")
    if link["max_uses"] and link["use_count"] >= link["max_uses"]:
        raise HTTPException(410, "Ce lien a atteint son nombre maximum d'utilisations")
    gross = link.get("gross_amount") or link["amount"]
    profile = link.get("creator_profile") or {}
    avatar_url = (
        profile.get("avatar_url")
        or profile.get("avatarUrl")
        or profile.get("photo_url")
        or profile.get("photoUrl")
        or profile.get("profile_photo")
        or profile.get("profilePhoto")
        or ""
    )
    return {
        "id": link["id"],
        "amount": float(link["amount"]),
        "gross_amount": float(gross),
        "currency": link["currency"],
        "description": link["description"],
        "creator_name": link["creator_name"],
        "creator_avatar_url": avatar_url,
        "status": link["status"],
    }


@router.post("/{link_id}/pay")
async def pay_link(link_id: str, req: PayLinkReq, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if req.provider.lower() not in _PHONE_PROVIDERS:
        raise HTTPException(400, "Opérateur invalide : mtn ou orange")

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        link = cur.fetchone()
    if not link:
        raise HTTPException(404, "Lien introuvable")

    now = utcnow()
    if link["status"] == "suspended":
        raise HTTPException(410, "Ce lien de paiement a été suspendu.")
    if link["status"] != "active":
        raise HTTPException(410, "Ce lien n'est plus actif")
    if link["expires_at"] and link["expires_at"] < now:
        raise HTTPException(410, "Lien expiré")
    if link["max_uses"] and link["use_count"] >= link["max_uses"]:
        raise HTTPException(410, "Lien épuisé")

    # gross_amount = ce que le payeur paie ; amount = ce que le créateur reçoit
    gross_amount = Decimal(str(link["gross_amount"] or link["amount"]))
    enforce_compliance(user_id=link["user_id"], amount_fcfa=gross_amount, flow="fiat", allow_manual_review=False)
    amount = gross_amount  # montant facturé au payeur
    fee_fcfa = Decimal("0")
    net_fcfa = Decimal(str(link["amount"]))  # placeholder, recalculé au webhook

    tx_id = f"pltx_{uuid.uuid4().hex[:16]}"
    reference = f"PLX-{uuid.uuid4().hex[:12].upper()}"

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO payment_link_txs
               (id, link_id, payer_phone, provider, amount, fee_fcfa, net_fcfa, reference, status, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s,%s)""",
            (tx_id, link_id, req.phone.strip(), req.provider.lower(),
             amount, fee_fcfa, net_fcfa, reference, now, now),
        )
        conn.commit()

    active_provider = _get_active_provider()

    if active_provider == "sharepay":
        # SharePay : checkout redirect (pas de USSD — payer entre son numéro sur la page SharePay)
        success_url = f"https://koboonline.com/pay/{link_id}?status=success&ref={reference}"
        cancel_url  = f"https://koboonline.com/pay/{link_id}?status=cancelled"
        try:
            sp_data = await sharepay_svc.create_checkout(
                reference=reference,
                amount=int(amount),
                description=link["description"],
                success_url=success_url,
                cancel_url=cancel_url,
            )
            payment_url = sp_data.get("paymentUrl") or ""
            sp_ref = sp_data.get("reference") or reference
            with closing(get_conn()) as conn, conn.cursor() as cur:
                cur.execute(
                    "UPDATE payment_link_txs SET status='processing', aggregator_txid=%s, updated_at=%s WHERE id=%s",
                    (sp_ref, utcnow(), tx_id),
                )
                conn.commit()
        except Exception as exc:
            with closing(get_conn()) as conn, conn.cursor() as cur:
                cur.execute("UPDATE payment_link_txs SET status='failed', updated_at=%s WHERE id=%s", (utcnow(), tx_id))
                conn.commit()
            raise HTTPException(502, f"Erreur de paiement : {exc}")
        return {
            "reference": reference,
            "authorization_url": payment_url,
            "message": "Vous allez être redirigé vers la page de paiement sécurisée.",
        }

    # NotchPay : USSD push — phone obligatoire
    if not req.phone or not req.provider or req.provider.lower() not in _PHONE_PROVIDERS:
        raise HTTPException(400, "Numéro et opérateur requis pour NotchPay")
    channel = _PHONE_PROVIDERS[req.provider.lower()]
    try:
        np_data = await notchpay.create_payment(
            reference=reference,
            amount=int(amount),
            currency="XAF",
            phone=req.phone.strip(),
            description=f"Paiement : {link['description']}",
        )
        trx_ref = (
            np_data.get("transaction", {}).get("reference")
            or np_data.get("reference")
            or reference
        )
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE payment_link_txs SET aggregator_txid=%s, updated_at=%s WHERE id=%s",
                (trx_ref, utcnow(), tx_id),
            )
            conn.commit()
        background_tasks.add_task(
            notchpay.trigger_ussd_push,
            trx_ref=trx_ref,
            channel=channel,
            phone=req.phone.strip(),
        )
    except Exception as exc:
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute("UPDATE payment_link_txs SET status='failed', updated_at=%s WHERE id=%s", (utcnow(), tx_id))
            conn.commit()
        raise HTTPException(502, f"Erreur de paiement : {exc}")

    return {"reference": reference, "message": "Validez le paiement sur votre téléphone MTN/Orange."}


@router.get("/{link_id}/crypto-info")
async def crypto_info(link_id: str) -> dict[str, Any]:
    """Endpoint public — retourne l'adresse USDT TRC20 + montant à envoyer pour ce lien."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT gross_amount, amount, description, status, expires_at, max_uses, use_count FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        link = cur.fetchone()
    if not link or link["status"] not in ("active",):
        raise HTTPException(404, "Lien introuvable ou inactif")
    now = utcnow()
    if link["expires_at"] and link["expires_at"] < now:
        raise HTTPException(410, "Lien expiré")
    if link["max_uses"] and link["use_count"] >= link["max_uses"]:
        raise HTTPException(410, "Lien épuisé")

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT address, network FROM crypto_wallets WHERE active = TRUE AND network = 'TRC20' LIMIT 1")
        wallet = cur.fetchone()
    if not wallet:
        raise HTTPException(503, "Paiement crypto temporairement indisponible")

    gross = Decimal(str(link["gross_amount"] or link["amount"]))
    xaf_per_usdt = Decimal("550")
    usdt_amount = (gross / xaf_per_usdt).quantize(Decimal("0.01"), rounding=ROUND_CEILING)
    return {
        "address": wallet["address"],
        "network": wallet["network"],
        "usdt_amount": float(usdt_amount),
        "fcfa_amount": float(gross),
        "rate": float(xaf_per_usdt),
        "description": link["description"],
    }


@router.post("/{link_id}/crypto-start")
async def crypto_start(link_id: str) -> dict[str, Any]:
    """Public — prépare une attente blockchain USDT TRC20 pour confirmation automatique."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        link = cur.fetchone()
    if not link or link["status"] not in ("active",):
        raise HTTPException(404, "Lien introuvable ou inactif")
    now = utcnow()
    if link["expires_at"] and link["expires_at"] < now:
        raise HTTPException(410, "Lien expiré")
    if link["max_uses"] and link["use_count"] >= link["max_uses"]:
        raise HTTPException(410, "Lien épuisé")

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT address, network FROM crypto_wallets WHERE active=TRUE AND network='TRC20' LIMIT 1")
        wallet = cur.fetchone()
    if not wallet:
        raise HTTPException(503, "Paiement crypto temporairement indisponible")

    gross = Decimal(str(link["gross_amount"] or link["amount"]))
    net = Decimal(str(link["amount"]))
    expected_usdt = (gross / Decimal("550")).quantize(Decimal("0.01"), rounding=ROUND_CEILING)
    fee = gross - net
    compliance = enforce_compliance(user_id=link["user_id"], amount_fcfa=gross, flow="crypto", allow_manual_review=True)
    status = "pending" if compliance.review_required else "processing"

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT *
               FROM payment_link_txs
               WHERE link_id=%s AND provider='crypto_trc20'
                 AND status IN ('processing','pending')
                 AND (aggregator_txid IS NULL OR aggregator_txid='')
                 AND created_at >= now() - interval '20 minutes'
               ORDER BY created_at DESC
               LIMIT 1""",
            (link_id,),
        )
        existing = cur.fetchone()
        if existing:
            tx_id = existing["id"]
            reference = existing["reference"]
            tx_status = existing["status"]
        else:
            tx_id = f"pltx_{uuid.uuid4().hex[:16]}"
            reference = f"PLC-{uuid.uuid4().hex[:12].upper()}"
            cur.execute(
                """INSERT INTO payment_link_txs
                   (id, link_id, payer_phone, provider, amount, fee_fcfa, net_fcfa, reference, status,
                    aggregator_txid, created_at, updated_at)
                   VALUES (%s,%s,NULL,'crypto_trc20',%s,%s,%s,%s,%s,NULL,%s,%s)""",
                (tx_id, link_id, gross, fee, net, reference, status, now, now),
            )
            tx_status = status
        conn.commit()

    return {
        "tx_id": tx_id,
        "reference": reference,
        "status": tx_status,
        "address": wallet["address"],
        "network": wallet["network"],
        "usdt_amount": float(expected_usdt),
        "fcfa_amount": float(gross),
        "net_fcfa": float(net),
        "rate": 550,
        "description": link["description"],
        "message": (
            "Envoyez le montant exact. Kobo vérifie automatiquement la blockchain et crédite le bénéficiaire après confirmations."
            if tx_status == "processing"
            else "Ce paiement nécessite une revue conformité. Vous pouvez envoyer le hash pour accélérer la vérification."
        ),
    }


@router.get("/{link_id}/crypto-status/{tx_id}")
async def crypto_status(link_id: str, tx_id: str) -> dict[str, Any]:
    """Public — état d'un paiement crypto par lien."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT id, reference, status, aggregator_txid, amount, net_fcfa, updated_at
               FROM payment_link_txs
               WHERE id=%s AND link_id=%s AND provider='crypto_trc20'
               LIMIT 1""",
            (tx_id, link_id),
        )
        tx = cur.fetchone()
    if not tx:
        raise HTTPException(404, "Paiement crypto introuvable")
    tx_hash = tx.get("aggregator_txid") or ""
    return {
        "tx_id": tx["id"],
        "reference": tx["reference"],
        "status": tx["status"],
        "tx_hash": tx_hash or None,
        "explorer_url": f"https://tronscan.org/#/transaction/{tx_hash}" if tx_hash else None,
        "amount": float(tx["amount"] or 0),
        "net_fcfa": float(tx["net_fcfa"] or 0),
        "updated_at": tx["updated_at"].isoformat() if tx["updated_at"] else None,
    }


class CryptoSubmitReq(BaseModel):
    tx_hash: str = Field(min_length=10, max_length=128)


@router.post("/{link_id}/crypto-submit")
async def crypto_submit(link_id: str, req: CryptoSubmitReq) -> dict[str, Any]:
    """Public — soumet un hash TX USDT TRC20 et le vérifie sur TronScan."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        link = cur.fetchone()
    if not link or link["status"] not in ("active",):
        raise HTTPException(404, "Lien introuvable ou inactif")
    now = utcnow()
    if link["expires_at"] and link["expires_at"] < now:
        raise HTTPException(410, "Lien expiré")
    if link["max_uses"] and link["use_count"] >= link["max_uses"]:
        raise HTTPException(410, "Lien épuisé")

    tx_hash = req.tx_hash.strip()

    # Vérifier que ce hash n'est pas déjà utilisé
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT id, status FROM payment_link_txs WHERE aggregator_txid=%s LIMIT 1",
            (tx_hash,)
        )
        existing = cur.fetchone()
    if existing:
        if existing["status"] == "completed":
            raise HTTPException(409, "Ce hash de transaction a déjà été utilisé et confirmé")
        raise HTTPException(409, "Ce hash est déjà en cours de vérification")

    # Récupérer l'adresse USDT et calculer le montant attendu
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT address FROM crypto_wallets WHERE active=TRUE AND network='TRC20' LIMIT 1")
        wallet = cur.fetchone()
    if not wallet:
        raise HTTPException(503, "Paiement crypto temporairement indisponible")

    gross = Decimal(str(link["gross_amount"] or link["amount"]))
    net = Decimal(str(link["amount"]))
    xaf_per_usdt = Decimal("550")
    expected_usdt = (gross / xaf_per_usdt).quantize(Decimal("0.01"), rounding=ROUND_CEILING)
    compliance = enforce_compliance(user_id=link["user_id"], amount_fcfa=gross, flow="crypto", allow_manual_review=True)

    # Vérification TronScan
    result = verify_tx(
        tx_hash=tx_hash,
        network="TRC20",
        expected_to=wallet["address"],
        expected_usdt=expected_usdt,
    )

    if result.status == "invalid":
        raise HTTPException(400, result.reason or "Transaction invalide sur TronScan")
    if result.status == "needs_manual_review":
        raise HTTPException(
            503,
            "Verification blockchain temporairement indisponible. Reessayez dans quelques minutes : aucune transaction n'a ete creee.",
        )

    fee = gross - net

    # Statut selon la verification blockchain. Une transaction admin n'est creee
    # que si le hash existe, pointe vers l'adresse Kobo et couvre le montant attendu.
    tx_status = "completed" if result.status == "auto_confirmed" and not compliance.review_required else "pending"
    provider_status = result.status  # auto_confirmed | hash_verified | needs_manual_review

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT id, reference
               FROM payment_link_txs
               WHERE link_id=%s AND provider='crypto_trc20'
                 AND status IN ('processing','pending')
                 AND (aggregator_txid IS NULL OR aggregator_txid='')
                 AND created_at >= now() - interval '2 hours'
               ORDER BY created_at DESC
               LIMIT 1
               FOR UPDATE""",
            (link_id,),
        )
        existing_intent = cur.fetchone()
        if existing_intent:
            tx_id = existing_intent["id"]
            reference = existing_intent["reference"]
            cur.execute(
                """UPDATE payment_link_txs
                   SET amount=%s, fee_fcfa=%s, net_fcfa=%s, status=%s, aggregator_txid=%s, updated_at=%s
                   WHERE id=%s""",
                (gross, fee, net, tx_status, tx_hash, now, tx_id),
            )
        else:
            tx_id = f"pltx_{uuid.uuid4().hex[:16]}"
            reference = f"PLC-{uuid.uuid4().hex[:12].upper()}"
            cur.execute(
                """INSERT INTO payment_link_txs
                   (id, link_id, payer_phone, provider, amount, fee_fcfa, net_fcfa, reference, status,
                    aggregator_txid, created_at, updated_at)
                   VALUES (%s,%s,NULL,'crypto_trc20',%s,%s,%s,%s,%s,%s,%s,%s)""",
                (tx_id, link_id, gross, fee, net, reference, tx_status, tx_hash, now, now),
            )
        if tx_status == "completed":
            cur.execute(
                """INSERT INTO wallet_accounts (user_id, currency, balance, address, metadata, created_at, updated_at)
                   VALUES (%s,'FCFA',%s,NULL,'{}'::jsonb,%s,%s)
                   ON CONFLICT (user_id, currency)
                   DO UPDATE SET balance = wallet_accounts.balance + EXCLUDED.balance, updated_at = EXCLUDED.updated_at""",
                (link["user_id"], net, now, now)
            )
            cur.execute(
                """INSERT INTO wallet_transactions
                   (id,user_id,direction,category,label,counterpart,amount,currency,status,metadata,created_at)
                   VALUES (%s,%s,'credit','payment_link',%s,%s,%s,'FCFA','completed',%s,%s)""",
                (f"wt_{uuid.uuid4().hex[:16]}", link["user_id"],
                 f"Paiement lien crypto : {link['description']}", "USDT TRC20",
                 net, Json({"link_id": link_id, "reference": reference, "tx_hash": tx_hash,
                            "amount_usdt": float(result.amount_usdt or 0)}), now)
            )
            cur.execute(
                "UPDATE payment_links SET use_count=use_count+1, updated_at=%s WHERE id=%s",
                (now, link_id)
            )
        conn.commit()

    # Notification au créateur si confirmé automatiquement
    if tx_status == "completed":
        try:
            create_notification(
                link["user_id"], "payment_received",
                "Paiement crypto reçu 🪙",
                f"Vous avez reçu {float(net):,.0f} FCFA via USDT TRC20 ({link['description']}).",
                {"link_id": link_id, "amount": float(net), "tx_hash": tx_hash},
            )
        except Exception:
            pass

    tron_explorer = f"https://tronscan.org/#/transaction/{tx_hash}"

    if result.status == "auto_confirmed":
        return {
            "status": "confirmed",
            "message": f"Transaction vérifiée sur TronScan ({result.confirmations} confirmations). Paiement crédité.",
            "reference": reference,
            "amount_usdt": float(result.amount_usdt or 0),
            "confirmations": result.confirmations,
            "explorer_url": tron_explorer,
        }
    if result.status == "hash_verified":
        return {
            "status": "pending",
            "message": f"Transaction trouvée mais pas encore assez confirmée ({result.confirmations}/20). Vérification dans quelques minutes.",
            "reference": reference,
            "confirmations": result.confirmations,
            "explorer_url": tron_explorer,
        }
    return {
        "status": "manual_review",
        "message": "Transaction soumise. TronScan temporairement indisponible — un admin va vérifier manuellement.",
        "reference": reference,
        "explorer_url": tron_explorer,
    }


class WalletOtpReq(BaseModel):
    identifier: str = Field(min_length=6, max_length=128)


class WalletOtpVerifyReq(BaseModel):
    challenge_id: str
    code: str = Field(min_length=6, max_length=6)


class PayWalletReq(BaseModel):
    payment_token: str


@router.post("/{link_id}/wallet-otp")
async def wallet_otp_start(link_id: str, req: WalletOtpReq) -> dict[str, Any]:
    """Public — envoie un OTP au payeur pour payer avec son solde Kobo."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT status, expires_at, max_uses, use_count FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        link = cur.fetchone()
    if not link or link["status"] != "active":
        raise HTTPException(404, "Lien introuvable ou inactif")
    if link["expires_at"] and link["expires_at"] < utcnow():
        raise HTTPException(410, "Lien expiré")
    if link["max_uses"] and link["use_count"] >= link["max_uses"]:
        raise HTTPException(410, "Lien épuisé")

    identifier = req.identifier.strip().lower()
    is_email = "@" in identifier

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if is_email:
            cur.execute("SELECT id FROM users WHERE email = %s LIMIT 1", (identifier,))
        else:
            cur.execute("SELECT id FROM users WHERE phone_e164 = %s LIMIT 1", (identifier,))
        user = cur.fetchone()
    if not user:
        raise HTTPException(404, "Aucun compte Kobo trouvé avec cet identifiant")

    phone_e164 = None if is_email else identifier
    email = identifier if is_email else None
    challenge_id, _ = start_challenge(phone_e164=phone_e164, email=email)
    return {"challenge_id": challenge_id, "ok": True}


@router.post("/{link_id}/wallet-otp/verify")
async def wallet_otp_verify(link_id: str, req: WalletOtpVerifyReq) -> dict[str, Any]:
    """Public — vérifie OTP et retourne le solde + token court de paiement."""
    try:
        identifier, _verification_token = verify_challenge(
            challenge_id=req.challenge_id,
            code=req.code,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))

    is_email = "@" in identifier
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        if is_email:
            cur.execute(
                "SELECT u.id, u.phone_e164, u.profile, wa.balance FROM users u "
                "LEFT JOIN wallet_accounts wa ON wa.user_id = u.id AND wa.currency = 'FCFA' "
                "WHERE u.email = %s LIMIT 1", (identifier,)
            )
        else:
            cur.execute(
                "SELECT u.id, u.phone_e164, u.profile, wa.balance FROM users u "
                "LEFT JOIN wallet_accounts wa ON wa.user_id = u.id AND wa.currency = 'FCFA' "
                "WHERE u.phone_e164 = %s LIMIT 1", (identifier,)
            )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Compte introuvable")

    profile = row.get("profile") or {}
    display_name = profile.get("fullName") or profile.get("full_name") or row.get("phone_e164") or "Utilisateur"
    balance = float(row["balance"] or 0)

    now = utcnow()
    authorization_id = f"pauth_{uuid.uuid4().hex}"
    authorization_expires_at = now + timedelta(minutes=_WALLET_TOKEN_MINUTES)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO payment_authorizations (id, user_id, link_id, expires_at, created_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (authorization_id, row["id"], link_id, authorization_expires_at, now),
        )
        conn.commit()
    payload = {
        "sub": row["id"],
        "link_id": link_id,
        "jti": authorization_id,
        "purpose": "pay_link_wallet",
        "exp": int(authorization_expires_at.timestamp()),
        "iat": int(now.timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return {"payment_token": token, "balance_fcfa": balance, "display_name": display_name}


@router.post("/{link_id}/pay-wallet")
async def pay_with_wallet(link_id: str, req: PayWalletReq) -> dict[str, Any]:
    """Public (token-auth) — paie un lien avec le solde Kobo du payeur."""
    try:
        payload = jwt.decode(req.payment_token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Token invalide ou expiré")
    if payload.get("purpose") != "pay_link_wallet" or payload.get("link_id") != link_id:
        raise HTTPException(401, "Token non valide pour ce lien")

    payer_id = payload.get("sub")
    authorization_id = payload.get("jti")
    if not payer_id or not authorization_id:
        raise HTTPException(401, "Autorisation de paiement invalide")

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        link = cur.fetchone()
    if not link or link["status"] != "active":
        raise HTTPException(410, "Lien inactif ou expiré")
    if link["expires_at"] and link["expires_at"] < utcnow():
        raise HTTPException(410, "Lien expiré")
    if link["max_uses"] and link["use_count"] >= link["max_uses"]:
        raise HTTPException(410, "Lien épuisé")
    if link["user_id"] == payer_id:
        raise HTTPException(400, "Vous ne pouvez pas payer votre propre lien")

    gross = Decimal(str(link["gross_amount"] or link["amount"]))
    net = Decimal(str(link["amount"]))
    fee = gross - net
    enforce_compliance(user_id=payer_id, amount_fcfa=gross, flow="fiat", allow_manual_review=False)
    enforce_compliance(user_id=link["user_id"], amount_fcfa=net, flow="fiat", allow_manual_review=False)
    reference = f"PLW-{uuid.uuid4().hex[:12].upper()}"
    tx_id = f"pltx_{uuid.uuid4().hex[:16]}"
    now = utcnow()

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        conn.autocommit = False
        try:
            cur.execute(
                """
                UPDATE payment_authorizations
                SET used_at = %s
                WHERE id = %s AND user_id = %s AND link_id = %s
                  AND used_at IS NULL AND expires_at > %s
                RETURNING id
                """,
                (now, authorization_id, payer_id, link_id, now),
            )
            if not cur.fetchone():
                raise HTTPException(401, "Cette autorisation a expiré ou a déjà été utilisée")
            cur.execute(
                "SELECT balance FROM wallet_accounts WHERE user_id=%s AND currency='FCFA' FOR UPDATE",
                (payer_id,)
            )
            payer_wallet = cur.fetchone()
            if not payer_wallet or Decimal(str(payer_wallet["balance"])) < gross:
                raise HTTPException(400, f"Solde insuffisant. Disponible : {float(payer_wallet['balance'] if payer_wallet else 0):,.0f} FCFA")

            cur.execute(
                "UPDATE wallet_accounts SET balance = balance - %s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
                (gross, now, payer_id)
            )
            cur.execute(
                "UPDATE wallet_accounts SET balance = balance + %s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
                (net, now, link["user_id"])
            )
            cur.execute(
                """INSERT INTO payment_link_txs
                   (id, link_id, payer_phone, provider, amount, fee_fcfa, net_fcfa, reference, status, created_at, updated_at)
                   VALUES (%s,%s,%s,'kobo_wallet',%s,%s,%s,%s,'completed',%s,%s)""",
                (tx_id, link_id, payer_id, gross, fee, net, reference, now, now)
            )
            cur.execute(
                "UPDATE payment_links SET use_count = use_count + 1, updated_at=%s WHERE id=%s",
                (now, link_id)
            )
            cur.execute(
                """INSERT INTO wallet_transactions (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
                   VALUES (%s,%s,'debit','payment_link',%s,%s,%s,'FCFA','completed',%s,%s)""",
                (f"wt_{uuid.uuid4().hex[:16]}", payer_id,
                 f"Paiement lien : {link['description']}", link["creator_name"],
                 gross, Json({"link_id": link_id, "reference": reference}), now)
            )
            cur.execute(
                """INSERT INTO wallet_transactions (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
                   VALUES (%s,%s,'credit','payment_link',%s,%s,%s,'FCFA','completed',%s,%s)""",
                (f"wt_{uuid.uuid4().hex[:16]}", link["user_id"],
                 f"Paiement reçu : {link['description']}", payer_id,
                 net, Json({"link_id": link_id, "reference": reference}), now)
            )
            conn.commit()
        except HTTPException:
            conn.rollback()
            raise
        except Exception as exc:
            conn.rollback()
            raise HTTPException(500, f"Erreur lors du paiement : {exc}")
        finally:
            conn.autocommit = True

    return {"ok": True, "reference": reference, "amount": float(net), "message": "Paiement effectué avec succès"}


@router.get("/tx/{reference}/status")
async def tx_status(reference: str) -> dict[str, Any]:
    """Endpoint public — vérifie le statut réel d'une transaction de lien de paiement."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT status, amount FROM payment_link_txs WHERE reference=%s LIMIT 1",
            (reference,),
        )
        tx = cur.fetchone()
    if not tx:
        raise HTTPException(404, "Transaction introuvable")
    return {"status": tx["status"], "amount": float(tx["amount"]), "reference": reference}


class EditLinkReq(BaseModel):
    description: str | None = Field(default=None, min_length=2, max_length=200)
    max_uses: int | None = Field(default=None, ge=1)


@router.put("/{link_id}")
async def edit_link(link_id: str, req: EditLinkReq, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT user_id FROM payment_links WHERE id=%s AND status!='deleted' LIMIT 1", (link_id,))
        row = cur.fetchone()
    if not row or row["user_id"] != user.id:
        raise HTTPException(404, "Introuvable")
    updates, vals = [], []
    if req.description is not None:
        updates.append("description=%s"); vals.append(req.description)
    if req.max_uses is not None:
        updates.append("max_uses=%s"); vals.append(req.max_uses)
    if not updates:
        raise HTTPException(400, "Rien à mettre à jour")
    updates.append("updated_at=%s"); vals.append(utcnow()); vals.append(link_id)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(f"UPDATE payment_links SET {', '.join(updates)} WHERE id=%s", vals)
        conn.commit()
    return {"ok": True}


@router.post("/{link_id}/duplicate")
async def duplicate_link(link_id: str, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_links WHERE id=%s AND status!='deleted' LIMIT 1", (link_id,))
        src = cur.fetchone()
    if not src or src["user_id"] != user.id:
        raise HTTPException(404, "Introuvable")
    new_id = f"pl_{uuid.uuid4().hex[:16]}"
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO payment_links
               (id, user_id, amount, currency, description, creator_name, status, max_uses, expires_at, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,'active',%s,NULL,%s,%s)""",
            (new_id, user.id, src["amount"], src["currency"],
             f"{src['description']} (copie)", src["creator_name"],
             src["max_uses"], now, now),
        )
        conn.commit()
    return {
        "id": new_id,
        "url": f"https://koboonline.com/pay/{new_id}",
        "amount": float(src["amount"]),
        "description": f"{src['description']} (copie)",
        "status": "active",
    }


@router.patch("/{link_id}/pause")
async def pause_link(link_id: str, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT user_id, status FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        row = cur.fetchone()
    if not row or row["user_id"] != user.id:
        raise HTTPException(404, "Introuvable")
    if row["status"] == "suspended":
        raise HTTPException(403, "Ce lien a été suspendu par l'administration et ne peut pas être modifié.")
    new_status = "active" if row["status"] == "paused" else "paused"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE payment_links SET status=%s, updated_at=%s WHERE id=%s", (new_status, utcnow(), link_id))
        conn.commit()
    return {"ok": True, "status": new_status}


@router.delete("/{link_id}")
async def delete_link(link_id: str, user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT user_id FROM payment_links WHERE id=%s LIMIT 1", (link_id,))
        row = cur.fetchone()
    if not row or row["user_id"] != user.id:
        raise HTTPException(404, "Introuvable")
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("UPDATE payment_links SET status='deleted', updated_at=%s WHERE id=%s", (utcnow(), link_id))
        conn.commit()
    return {"ok": True}
