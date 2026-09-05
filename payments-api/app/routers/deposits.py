from __future__ import annotations

import logging
import uuid
from contextlib import closing
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from psycopg.types.json import Json

log = logging.getLogger("notchpay_webhook")
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import AuthUser, require_user
from app.core.time import utcnow
from app.db.session import get_conn
from app.services import notchpay
from app.services import sharepay as sharepay_svc
from app.services.email import notify_admin
from app.services.fees import calculate_fee_fcfa, credit_platform_fee, get_min_amount_fcfa
from app.services.notifications import create_notification
from app.services.compliance import enforce_compliance

router = APIRouter(prefix="/deposits", tags=["deposits"])

# Channels NotchPay supportés
_CHANNELS = {"mtn": "cm.mtn", "orange": "cm.orange"}
# Currencies supportées pour dépôt mobile money
_MM_CURRENCIES = {"FCFA": "XAF"}
# Devises pour virement bancaire manuel
_BANK_CURRENCIES = {"EUR", "USD"}


# ── Schemas ────────────────────────────────────────────────────────────────────

class MobileMoneyInitReq(BaseModel):
    amount: Decimal = Field(..., gt=0)
    currency: str = Field(default="FCFA")
    provider: str = Field(default="mtn")   # non utilisé pour les flux redirect
    phone: str = Field(default="")


class BankTransferInitReq(BaseModel):
    amount: Decimal = Field(..., gt=0)
    currency: str  # 'EUR' | 'USD'
    sender_iban: str | None = Field(default=None, max_length=34)
    sender_name: str | None = Field(default=None, max_length=120)


# ── Config publique ────────────────────────────────────────────────────────────

def _get_operator_fee_rate(active_provider: str) -> float:
    """Retourne le taux de frais opérateur selon le fournisseur actif (lu depuis app_settings si disponible)."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        key = "sharepay_fee_rate" if active_provider == "sharepay" else "notchpay_fee_rate"
        cur.execute("SELECT value FROM app_settings WHERE key = %s LIMIT 1", (key,))
        row = cur.fetchone()
    if row and isinstance(row["value"], (int, float)):
        return float(row["value"])
    if row and isinstance(row["value"], dict):
        return float(row["value"].get("rate", 1.6 if active_provider == "sharepay" else 1.5))
    return 1.6 if active_provider == "sharepay" else 1.5


@router.get("/config")
async def get_deposit_config() -> dict[str, Any]:
    """Retourne l'agrégateur actif et les taux de frais pour le formulaire de dépôt."""
    from app.services.fees import get_fee_config
    active_provider = _get_active_payment_provider()
    kobo_cfg = get_fee_config("mobile_money_deposit")
    operator_fee_rate = _get_operator_fee_rate(active_provider)
    return {
        "active_provider": active_provider,
        "operator_fee_rate": operator_fee_rate,
        "kobo_fee_rate": float(kobo_cfg.get("rate", 0)),
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_bank_settings() -> dict:
    """Récupère les coordonnées bancaires Kobo depuis app_settings."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'kobo_bank' LIMIT 1")
        row = cur.fetchone()
    if row:
        return row["value"]
    # Fallback defaults si non configuré
    return {
        "bank_name": "CCA Bank",
        "account_name": "KOBO FINTECH SARL",
        "iban": "CM21 0001 0000 0000 0000 0001 123",
        "bic": "CCMBCMCX",
        "currency": "EUR",
    }


def _deposit_confirmation_body(net_fcfa: Decimal, *, operator_fee: Decimal = Decimal("0"), kobo_fee: Decimal = Decimal("0")) -> str:
    def fr(n: Decimal) -> str:
        return f"{float(n):,.0f}".replace(",", " ")

    total_fee = Decimal(str(operator_fee or 0)) + Decimal(str(kobo_fee or 0))
    body = f"{fr(net_fcfa)} FCFA crédités sur votre compte Kobo."
    if total_fee > 0:
        body += f" Frais totaux : {fr(total_fee)} FCFA"
        details = []
        if operator_fee > 0:
            details.append(f"traitement {fr(operator_fee)}")
        if kobo_fee > 0:
            details.append(f"Kobo {fr(kobo_fee)}")
        if details:
            body += f" ({' + '.join(details)} FCFA)."
        else:
            body += "."
    return body


def _credit_user(conn, cur, *, user_id: str, amount_fcfa: Decimal, label: str, deposit_id: str, metadata_extra: dict[str, Any] | None = None) -> None:
    """Crédite le compte FCFA de l'utilisateur (à appeler dans une transaction ouverte)."""
    now = utcnow()
    cur.execute(
        "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
        (amount_fcfa, now, user_id),
    )
    tx_id = f"tx_{uuid.uuid4().hex}"
    metadata = {"deposit_id": deposit_id}
    if metadata_extra:
        metadata.update(metadata_extra)
    cur.execute(
        """INSERT INTO wallet_transactions
           (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
           VALUES (%s,%s,'credit','fiat_deposit',%s,'Kobo',%s,'FCFA','completed',%s,%s)""",
        (tx_id, user_id, label, amount_fcfa, Json(metadata), now),
    )


# ── Mobile Money ───────────────────────────────────────────────────────────────

_USSD_MSG = {
    "cm.orange": "Orange Money : composez #150*50# pour confirmer le paiement.",
    "cm.mtn":    "MTN MoMo : validez la demande de paiement sur votre téléphone.",
}


def _get_active_payment_provider() -> str:
    """Lit le fournisseur de paiement actif depuis app_settings (défaut: sharepay)."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'payment_provider' LIMIT 1")
        row = cur.fetchone()
    if row and isinstance(row["value"], dict):
        return row["value"].get("provider", "sharepay")
    return "sharepay"


async def _run_ussd_push(deposit_id: str, trx_ref: str, channel: str, phone: str) -> None:
    """Tâche background : déclenche le USSD push et met à jour la note en base."""
    try:
        np_data = await notchpay.trigger_ussd_push(trx_ref=trx_ref, channel=channel, phone=phone)
        note = np_data.get("message") or _USSD_MSG.get(channel, "Validez sur votre téléphone.")
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE fiat_deposits SET status='processing', note=%s, updated_at=%s WHERE id=%s",
                (note, utcnow(), deposit_id),
            )
            conn.commit()
    except Exception as exc:
        log.warning("USSD push échoué pour %s : %s", deposit_id, exc)
        # Ne pas marquer failed ici — NotchPay peut encore envoyer payment.complete/failed via webhook.
        # Orange notamment répond lentement mais la confirmation USSD peut quand même arriver.
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE fiat_deposits SET status='processing', note=%s, updated_at=%s WHERE id=%s",
                (f"En attente de confirmation (délai réseau) — {_USSD_MSG.get(channel, 'Validez sur votre téléphone.')}", utcnow(), deposit_id),
            )
            conn.commit()


@router.post("/mobile-money/init")
async def init_mobile_money(
    req: MobileMoneyInitReq,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:

    if req.currency.upper() not in _MM_CURRENCIES:
        raise HTTPException(400, f"Devise non supportée pour mobile money : {req.currency}")
    if req.provider.lower() not in _CHANNELS:
        raise HTTPException(400, f"Opérateur invalide : {req.provider}. Utiliser 'mtn' ou 'orange'")
    min_amount = get_min_amount_fcfa("mobile_money_deposit", 100)
    if req.amount < min_amount:
        raise HTTPException(400, f"Montant minimum : {int(min_amount)} FCFA")
    enforce_compliance(user_id=user.id, amount_fcfa=req.amount, flow="fiat", allow_manual_review=False)

    channel = _CHANNELS[req.provider.lower()]
    reference = f"dep_{uuid.uuid4().hex[:16]}"
    deposit_id = f"fd_{uuid.uuid4().hex}"
    amount_int = int(req.amount)
    now = utcnow()

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO fiat_deposits
               (id, user_id, currency, amount, method, provider, phone, reference, status, created_at, updated_at)
               VALUES (%s,%s,%s,%s,'mobile_money',%s,%s,%s,'pending',%s,%s)""",
            (deposit_id, user.id, req.currency.upper(), req.amount,
             req.provider.lower(), req.phone, reference, now, now),
        )
        conn.commit()

    effective_provider = _get_active_payment_provider()

    # ── SharePay : checkout redirect (pas de USSD push direct) ──────────────
    if effective_provider == "sharepay":
        try:
            sp_data = await sharepay_svc.create_checkout(
                reference=reference,
                amount=amount_int,
                description=f"Dépôt Kobo {req.provider.upper()} {amount_int} FCFA",
            )
        except Exception as exc:
            with closing(get_conn()) as conn, conn.cursor() as cur:
                cur.execute(
                    "UPDATE fiat_deposits SET status='failed', note=%s, updated_at=%s WHERE id=%s",
                    (str(exc), utcnow(), deposit_id),
                )
                conn.commit()
            raise HTTPException(502, f"Erreur du service de paiement : {exc}")

        sp_ref = sp_data.get("reference") or reference
        payment_url = sp_data.get("paymentUrl") or ""

        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE fiat_deposits SET notchpay_txid=%s, status='processing', updated_at=%s WHERE id=%s",
                (sp_ref, utcnow(), deposit_id),
            )
            conn.commit()

        create_notification(
            user_id=user.id,
            notif_type="deposit_started",
            title="Dépôt à finaliser",
            body=f"Votre dépôt de {amount_int:,.0f} FCFA a été préparé. Finalisez le paiement pour que le solde soit crédité.",
            metadata={"deposit_id": deposit_id, "reference": reference},
        )
        return {
            "deposit_id": deposit_id,
            "reference": reference,
            "status": "processing",
            "authorization_url": payment_url,
            "message": "Cliquez sur le bouton ci-dessous pour finaliser votre paiement.",
        }

    # ── NotchPay : hosted checkout redirect ──────────────────────────────────
    try:
        _uid = user.phone_e164 or ""
        _is_email = "@" in _uid
        np_data = await notchpay.create_checkout(
            reference=reference,
            amount=amount_int,
            currency=_MM_CURRENCIES[req.currency.upper()],
            description=f"Dépôt Kobo {amount_int} FCFA",
            phone=None if _is_email else _uid or None,
            email=_uid if _is_email else None,
        )
    except Exception as exc:
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE fiat_deposits SET status='failed', note=%s, updated_at=%s WHERE id=%s",
                (str(exc), utcnow(), deposit_id),
            )
            conn.commit()
        raise HTTPException(502, f"Erreur NotchPay : {exc}")

    trx_ref = (
        (np_data.get("transaction") or {}).get("reference")
        or np_data.get("reference")
        or reference
    )
    payment_url = np_data.get("authorization_url") or ""

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_deposits SET notchpay_txid=%s, status='processing', updated_at=%s WHERE id=%s",
            (trx_ref, utcnow(), deposit_id),
        )
        conn.commit()

    create_notification(
        user_id=user.id,
        notif_type="deposit_started",
        title="Dépôt à finaliser",
        body=f"Votre dépôt de {amount_int:,.0f} FCFA a été préparé. Finalisez le paiement pour que le solde soit crédité.",
        metadata={"deposit_id": deposit_id, "reference": reference},
    )
    return {
        "deposit_id": deposit_id,
        "reference": reference,
        "status": "processing",
        "authorization_url": payment_url,
        "message": "Cliquez pour finaliser votre paiement sur NotchPay.",
    }


# ── Bank Transfer ──────────────────────────────────────────────────────────────

@router.post("/bank/init")
async def init_bank_transfer(
    req: BankTransferInitReq,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:

    if req.currency.upper() not in _BANK_CURRENCIES:
        raise HTTPException(400, f"Devise non supportée pour virement : {req.currency}")
    min_amount = get_min_amount_fcfa("fiat_deposit", 1)
    if req.amount < min_amount:
        raise HTTPException(400, f"Montant minimum : {int(min_amount)} {req.currency.upper()}")
    enforce_compliance(user_id=user.id, amount_fcfa=req.amount, flow="fiat", allow_manual_review=True)

    bank_info = _get_bank_settings()
    reference = f"KOB-{uuid.uuid4().hex[:10].upper()}"
    deposit_id = f"fd_{uuid.uuid4().hex}"
    now = utcnow()

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO fiat_deposits
               (id, user_id, currency, amount, method, reference, sender_iban, sender_name, status, created_at, updated_at)
               VALUES (%s,%s,%s,%s,'bank_transfer',%s,%s,%s,'pending',%s,%s)""",
            (deposit_id, user.id, req.currency.upper(), req.amount, reference,
             req.sender_iban, req.sender_name, now, now),
        )
        conn.commit()

    notify_admin(
        "Nouveau virement bancaire en attente",
        f"<b>Référence :</b> {reference}<br>"
        f"<b>Utilisateur ID :</b> {user.id}<br>"
        f"<b>Montant :</b> {float(req.amount):,.2f} {req.currency.upper()}<br>"
        f"<b>Nom émetteur :</b> {req.sender_name or '—'}<br>"
        f"<b>IBAN émetteur :</b> {req.sender_iban or '—'}<br><br>"
        f"Ce dépôt sera crédité manuellement après confirmation de réception.",
    )
    create_notification(
        user_id=user.id,
        notif_type="deposit_pending",
        title="Dépôt bancaire enregistré",
        body=(
            f"Votre dépôt bancaire de {float(req.amount):,.2f} {req.currency.upper()} est enregistré. "
            f"Utilisez la référence {reference}; le solde sera crédité après confirmation."
        ),
        metadata={"deposit_id": deposit_id, "reference": reference},
    )
    return {
        "deposit_id": deposit_id,
        "reference": reference,
        "status": "pending",
        "message": "Effectuez votre virement avec la référence indiquée. Crédit sous 1-3 jours ouvrés après confirmation.",
        "bank_details": {
            **bank_info,
            "amount": float(req.amount),
            "currency": req.currency.upper(),
            "reference": reference,
        },
    }


# ── Status ─────────────────────────────────────────────────────────────────────

@router.get("/{deposit_id}/status")
async def get_deposit_status(
    deposit_id: str,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM fiat_deposits WHERE id=%s AND user_id=%s LIMIT 1",
            (deposit_id, user.id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Dépôt introuvable")
    return {
        "id": row["id"],
        "currency": row["currency"],
        "amount": float(row["amount"]),
        "method": row["method"],
        "provider": row["provider"],
        "status": row["status"],
        "reference": row["reference"],
        "note": row.get("note") or "",
        "created_at": row["created_at"].isoformat(),
    }


# ── NotchPay Webhook ────────────────────────────────────────────────────────────

@router.get("/webhooks/notchpay")
async def notchpay_redirect(reference: str | None = None, trxref: str | None = None):
    """NotchPay redirige le navigateur ici après paiement — on renvoie vers le frontend."""
    from fastapi.responses import RedirectResponse
    ref = reference or trxref or ""
    # Chercher le dépôt pour connaître son statut
    try:
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                "SELECT status FROM fiat_deposits WHERE notchpay_txid=%s OR reference=%s LIMIT 1",
                (ref, ref),
            )
            dep = cur.fetchone()
        status = dep["status"] if dep else "pending"
    except Exception:
        status = "pending"

    if status == "completed":
        return RedirectResponse("https://koboonline.com/dashboard?deposit=success", status_code=302)
    elif status == "failed":
        return RedirectResponse("https://koboonline.com/fiat-deposit?status=failed", status_code=302)
    else:
        return RedirectResponse("https://koboonline.com/dashboard?deposit=pending", status_code=302)


@router.post("/webhooks/notchpay")
async def notchpay_webhook(request: Request) -> dict[str, Any]:
    body = await request.body()

    headers_dict = dict(request.headers)
    log.info("NotchPay webhook received content_length=%s", request.headers.get("content-length", "0"))

    # NotchPay may use 'hash' or 'x-notch-signature' — try both
    sig = (
        request.headers.get("hash")
        or request.headers.get("x-notch-signature")
        or request.headers.get("x-notchpay-signature")
        or ""
    )
    # Strip potential prefix like "sha256="
    if sig.startswith("sha256="):
        sig = sig[7:]

    if not notchpay.verify_webhook_signature(body, sig):
        log.warning("NotchPay webhook signature FAILED. header_keys=%s", list(headers_dict.keys()))
        # Return 200 so NotchPay doesn't retry, but don't process — allows us to at least see headers
        event_raw = {}
        try:
            import json as _json
            event_raw = _json.loads(body)
        except Exception:
            pass
        event_type_raw = event_raw.get("event") or event_raw.get("type") or ""
        if event_type_raw not in ("payment.complete", "payment.failed", "transfer.complete", "transfer.failed"):
            return {"status": "sig_ignored"}
        raise HTTPException(400, "Signature invalide")

    event = await request.json()
    event_type = event.get("event") or event.get("type") or ""
    # NotchPay uses "payment" key for payment events, "transfer" key for transfer events
    payment = event.get("payment") or event.get("transfer") or event.get("data") or {}
    log.warning("NotchPay webhook event_type=%s payment_keys=%s", event_type, list(payment.keys()) if payment else [])
    # NotchPay sends our ref in merchant_reference/trxref; "reference" is their internal trx.xxx
    reference = (
        payment.get("merchant_reference")
        or payment.get("trxref")
        or payment.get("reference")
        or event.get("merchant_reference")
        or event.get("trxref")
        or event.get("reference")
        or ""
    )
    log.warning("NotchPay webhook resolved reference=%r event_type=%s", reference, event_type)

    if not reference:
        return {"status": "no_reference"}

    # Routing : liens de paiement (PLX-) vs retraits NotchPay (WIT-) vs dépôts
    if reference.startswith("PLX-"):
        if event_type == "payment.complete":
            return await _handle_payment_link_webhook(reference, success=True, webhook_data=payment, provider="notchpay")
        if event_type == "payment.failed":
            return await _handle_payment_link_webhook(reference, success=False, provider="notchpay")
        return {"status": "ignored"}

    if event_type == "transfer.complete":
        return await _handle_notchpay_transfer_webhook(reference, success=True)
    if event_type == "transfer.failed":
        return await _handle_notchpay_transfer_webhook(reference, success=False)

    if event_type not in ("payment.complete", "payment.failed"):
        return {"status": "ignored"}

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM fiat_deposits WHERE reference=%s LIMIT 1",
            (reference,),
        )
        dep = cur.fetchone()

    if not dep:
        return {"status": "not_found"}

    if dep["status"] in ("completed", "rejected"):
        return {"status": "already_processed"}
    # "failed" peut être dû à un timeout USSD — on retraite si payment.complete arrive

    if event_type == "payment.complete":
        gross_fcfa = Decimal(str(dep["amount"]))

        # NotchPay prélève ses frais avant versement — chercher le montant net dans le webhook
        net_raw = payment.get("net_amount") or payment.get("netAmount") or payment.get("net")
        if net_raw is not None:
            try:
                net_candidate = Decimal(str(net_raw))
                net_after_operator = net_candidate if Decimal("0") < net_candidate <= gross_fcfa else gross_fcfa
            except Exception:
                net_after_operator = gross_fcfa
        else:
            # Fallback : déduire le taux opérateur configuré (défaut 1.5 %)
            op_rate = Decimal(str(_get_operator_fee_rate("notchpay")))
            op_fee = (gross_fcfa * op_rate / Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            net_after_operator = gross_fcfa - op_fee
            log.warning("NotchPay deposit: netAmount absent — fallback taux %.2f%% gross=%s net=%s", op_rate, gross_fcfa, net_after_operator)

        kobo_fee = calculate_fee_fcfa("mobile_money_deposit", net_after_operator)
        fee_fcfa = kobo_fee
        net_fcfa = net_after_operator - kobo_fee
        operator_fee = gross_fcfa - net_after_operator

        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE fiat_deposits SET status='completed', fee=%s, updated_at=%s WHERE id=%s",
                (fee_fcfa, utcnow(), dep["id"]),
            )
            cur.execute(
                """INSERT INTO wallet_accounts (user_id, currency, balance)
                   VALUES (%s, 'FCFA', 0)
                   ON CONFLICT (user_id, currency) DO NOTHING""",
                (dep["user_id"],),
            )
            _credit_user(conn, cur,
                user_id=dep["user_id"],
                amount_fcfa=net_fcfa,
                label=f"Dépôt Mobile Money {dep['provider'] or ''}",
                deposit_id=dep["id"],
                metadata_extra={
                    "gross_fcfa": float(gross_fcfa),
                    "operator_fee_fcfa": float(operator_fee),
                    "kobo_fee_fcfa": float(kobo_fee),
                    "total_fee_fcfa": float(operator_fee + kobo_fee),
                },
            )
            conn.commit()

        credit_platform_fee(fee_fcfa, source="mobile_money_deposit", ref=dep["id"])

        body_msg = _deposit_confirmation_body(net_fcfa, operator_fee=operator_fee, kobo_fee=kobo_fee)
        create_notification(
            user_id=dep["user_id"],
            notif_type="deposit_confirmed",
            title="Dépôt confirmé",
            body=body_msg,
        )
        return {"status": "credited", "net_fcfa": float(net_fcfa), "fee_fcfa": float(fee_fcfa)}

    # payment.failed
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_deposits SET status='failed', updated_at=%s WHERE id=%s",
            (utcnow(), dep["id"]),
        )
        conn.commit()
    return {"status": "marked_failed"}


# ── NotchPay Transfer Webhook (retraits) ────────────────────────────────────────

async def _handle_notchpay_transfer_webhook(reference: str, success: bool) -> dict[str, Any]:
    """Finalise un retrait MoMo NotchPay sur webhook transfer.complete / transfer.failed."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_withdrawals WHERE reference=%s LIMIT 1", (reference,))
        w = cur.fetchone()
    if not w:
        log.warning("NotchPay transfer webhook: retrait introuvable ref=%s", reference)
        return {"status": "not_found"}
    if w["status"] in ("completed", "failed"):
        return {"status": "already_processed"}
    now = utcnow()
    if success:
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                "UPDATE fiat_withdrawals SET status='completed', updated_at=%s WHERE id=%s RETURNING fee_fcfa",
                (now, w["id"]),
            )
            row = cur.fetchone()
            cur.execute(
                "UPDATE wallet_transactions SET status='completed' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
                (w["id"],),
            )
            conn.commit()
        if row and row.get("fee_fcfa"):
            credit_platform_fee(Decimal(str(row["fee_fcfa"])), source="fiat_withdrawal_notchpay", ref=w["id"])
        create_notification(
            user_id=w["user_id"], notif_type="withdrawal_completed",
            title="Retrait effectué",
            body=f"Votre retrait de {float(w['amount']):,.0f} FCFA a été envoyé sur votre compte Mobile Money.",
        )
        return {"status": "payout_completed"}
    # transfer.failed — remboursement
    total_debit = Decimal(str(w.get("total_debit") or w["amount"]))
    refund_id = f"tx_{uuid.uuid4().hex[:16]}"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_withdrawals SET status='failed', reject_reason=%s, updated_at=%s WHERE id=%s",
            ("Paiement NotchPay échoué", now, w["id"]),
        )
        cur.execute(
            "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
            (total_debit, now, w["user_id"]),
        )
        cur.execute(
            """INSERT INTO wallet_transactions
               (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
               VALUES (%s,%s,'credit','fiat_withdrawal_refund','Retrait annulé — remboursé automatiquement','Kobo',%s,'FCFA','completed',%s,%s)""",
            (refund_id, w["user_id"], total_debit, Json({"withdrawal_id": w["id"]}), now),
        )
        cur.execute(
            "UPDATE wallet_transactions SET status='failed' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
            (w["id"],),
        )
        conn.commit()
    create_notification(
        user_id=w["user_id"], notif_type="withdrawal_failed",
        title="Retrait échoué",
        body="Votre retrait a échoué. Les fonds ont été remboursés sur votre compte Kobo.",
    )
    return {"status": "payout_failed_refunded"}


# ── Payment Link Webhook ─────────────────────────────────────────────────────────

async def _handle_payment_link_webhook(
    reference: str,
    success: bool,
    webhook_data: dict | None = None,
    provider: str = "sharepay",
) -> dict[str, Any]:
    """Finalise un paiement de lien (PLX-...) sur webhook NotchPay ou SharePay."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_link_txs WHERE reference=%s LIMIT 1", (reference,))
        tx = cur.fetchone()
    if not tx:
        log.warning("Payment link webhook: transaction introuvable ref=%s", reference)
        return {"status": "not_found"}
    if tx["status"] in ("completed", "failed"):
        return {"status": "already_processed"}
    now = utcnow()
    if not success:
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE payment_link_txs SET status='failed', fee_fcfa=0, net_fcfa=0, updated_at=%s WHERE id=%s",
                (now, tx["id"]),
            )
            conn.commit()
        return {"status": "link_payment_failed"}

    gross_fcfa = Decimal(str(tx["amount"]))

    # Recalculer depuis le netAmount du webhook — évite de créditer plus que reçu de l'agrégateur
    net_raw = None
    if webhook_data:
        net_raw = (
            webhook_data.get("netAmount")
            or webhook_data.get("net_amount")
            or webhook_data.get("net")
        )
    if net_raw is not None:
        try:
            net_candidate = Decimal(str(net_raw))
            net_after_operator = net_candidate if Decimal("0") < net_candidate <= gross_fcfa else gross_fcfa
        except Exception:
            net_after_operator = gross_fcfa
    else:
        # Fallback : déduire le taux opérateur configuré
        op_rate = Decimal(str(_get_operator_fee_rate(provider)))
        op_fee = (gross_fcfa * op_rate / Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        net_after_operator = gross_fcfa - op_fee
        log.warning("PayLink webhook: netAmount absent — fallback %s taux %.2f%% gross=%s net=%s", provider, op_rate, gross_fcfa, net_after_operator)

    # Frais Kobo : selon la catégorie du lien (api_payment pour API, mobile_money_deposit pour dashboard)
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_links WHERE id=%s LIMIT 1", (tx["link_id"],))
        link = cur.fetchone()
    if not link:
        return {"status": "link_not_found"}
    link_origin = link.get("origin", "internal")

    fee_category = "api_payment" if link_origin == "api" else "payment_link"
    expected_net_fcfa = Decimal(str(link["amount"]))
    kobo_fee = calculate_fee_fcfa(fee_category, net_after_operator)
    net_fcfa = net_after_operator - kobo_fee
    if net_fcfa > expected_net_fcfa:
        net_fcfa = expected_net_fcfa
        kobo_fee = net_after_operator - net_fcfa
    fee_fcfa = kobo_fee
    link_id = tx["link_id"]

    tx_id = f"tx_{uuid.uuid4().hex}"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE payment_link_txs SET status='completed', fee_fcfa=%s, net_fcfa=%s, updated_at=%s WHERE id=%s",
            (fee_fcfa, net_fcfa, now, tx["id"]),
        )
        cur.execute(
            "UPDATE payment_links SET use_count=use_count+1, updated_at=%s WHERE id=%s",
            (now, link_id),
        )
        cur.execute(
            """INSERT INTO wallet_accounts (user_id, currency, balance)
               VALUES (%s, 'FCFA', 0) ON CONFLICT (user_id, currency) DO NOTHING""",
            (link["user_id"],),
        )
        cur.execute(
            "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
            (net_fcfa, now, link["user_id"]),
        )
        cur.execute(
            """INSERT INTO wallet_transactions
               (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
               VALUES (%s,%s,'credit','payment_link',%s,%s,%s,'FCFA','completed',%s,%s)""",
            (tx_id, link["user_id"],
             f"Paiement via lien : {link['description']}",
             tx["payer_phone"] or "Payeur",
             net_fcfa,
             Json({"link_id": link_id, "tx_id": tx["id"], "fee_fcfa": float(fee_fcfa)}),
             now),
        )
        conn.commit()

    credit_platform_fee(fee_fcfa, source="payment_link", ref=tx["id"])
    create_notification(
        user_id=link["user_id"], notif_type="payment_received",
        title="Paiement reçu",
        body=f"{float(net_fcfa):,.0f} FCFA reçus via votre lien « {link['description']} ».",
        metadata={"link_id": link_id},
    )

    # Webhook sortant marchand (API publique)
    try:
        from app.services.webhook_delivery import dispatch as _wh_dispatch
        import asyncio
        asyncio.create_task(_wh_dispatch(
            user_id=link["user_id"],
            event_type="payment.success",
            payload={
                "payment_request_id": link_id,
                "reference":          tx["reference"],
                "amount":             float(tx["amount"]),
                "net_fcfa":           float(net_fcfa),
                "kobo_fee":           float(fee_fcfa),
                "payer_phone":        tx.get("payer_phone"),
                "provider":           tx.get("provider"),
            },
        ))
    except Exception:
        pass  # ne jamais bloquer la confirmation principale

    return {"status": "link_payment_completed", "net_fcfa": float(net_fcfa)}


# ── SharePay Redirect (GET) ────────────────────────────────────────────────────

@router.get("/webhooks/sharepay")
async def sharepay_redirect(
    reference: str | None = None,
    merchantReference: str | None = None,
    status: str | None = None,
):
    """SharePay redirige le navigateur ici après paiement (successUrl).
    Synchronise le statut via l'API SharePay puis redirige vers le frontend."""
    from fastapi.responses import RedirectResponse

    dep = None
    sp_ref = reference or ""
    merch_ref = merchantReference or ""

    for lookup_col, lookup_val in [
        ("notchpay_txid", sp_ref),
        ("reference", merch_ref),
        ("notchpay_txid", merch_ref),
        ("reference", sp_ref),
    ]:
        if not lookup_val:
            continue
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(f"SELECT * FROM fiat_deposits WHERE {lookup_col}=%s LIMIT 1", (lookup_val,))
            dep = cur.fetchone()
        if dep:
            break

    if not dep:
        log.warning("SharePay redirect: dépôt introuvable sp_ref=%s merch_ref=%s", sp_ref, merch_ref)
        return RedirectResponse("https://koboonline.com/dashboard?deposit=pending", status_code=302)

    if dep["status"] == "completed":
        return RedirectResponse("https://koboonline.com/dashboard?deposit=success", status_code=302)
    if dep["status"] == "failed":
        return RedirectResponse("https://koboonline.com/fiat-deposit?status=failed", status_code=302)

    # Synchroniser depuis SharePay
    try:
        sp_lookup_ref = dep.get("notchpay_txid") or sp_ref or dep["reference"]
        sp_data = await sharepay_svc.get_payment_status(sp_lookup_ref)
        log.warning("SharePay redirect sync ref=%s sp_data=%s", sp_lookup_ref, sp_data)
        sp_status = (sp_data.get("status") or "").lower()
        if sp_status in ("success", "completed", "paid", "successful"):
            await _process_sharepay_deposit_success(dep, sp_data)
            return RedirectResponse("https://koboonline.com/dashboard?deposit=success", status_code=302)
    except Exception as exc:
        log.warning("SharePay redirect: sync échoué ref=%s : %s", dep.get("reference"), exc)

    return RedirectResponse("https://koboonline.com/dashboard?deposit=pending", status_code=302)


async def _process_sharepay_deposit_success(dep: dict, data: dict) -> None:
    """Crédite l'utilisateur pour un dépôt SharePay confirmé (idempotent)."""
    if dep["status"] in ("completed", "rejected"):
        return

    gross_fcfa = Decimal(str(dep["amount"]))
    net_from_sp = data.get("netAmount")
    if net_from_sp is not None:
        try:
            candidate = Decimal(str(net_from_sp))
            net_after_sp = candidate if Decimal("0") < candidate <= gross_fcfa else gross_fcfa
        except Exception:
            net_after_sp = gross_fcfa
        sp_fee = gross_fcfa - net_after_sp
        kobo_fee = calculate_fee_fcfa("mobile_money_deposit", net_after_sp)
        net_fcfa = net_after_sp - kobo_fee
        fee_fcfa = kobo_fee
        log.warning("_process_sharepay: gross=%s sp_fee=%s kobo_fee=%s net=%s", gross_fcfa, sp_fee, kobo_fee, net_fcfa)
    else:
        op_rate = Decimal(str(_get_operator_fee_rate("sharepay")))
        op_fee = (gross_fcfa * op_rate / Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        net_after_sp = gross_fcfa - op_fee
        sp_fee = op_fee
        kobo_fee = calculate_fee_fcfa("mobile_money_deposit", net_after_sp)
        net_fcfa = net_after_sp - kobo_fee
        fee_fcfa = kobo_fee

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_deposits SET status='completed', fee=%s, updated_at=%s WHERE id=%s AND status NOT IN ('completed','rejected')",
            (fee_fcfa, utcnow(), dep["id"]),
        )
        if cur.rowcount == 0:
            return  # déjà traité (idempotent)
        cur.execute(
            "INSERT INTO wallet_accounts (user_id, currency, balance) VALUES (%s,'FCFA',0) ON CONFLICT (user_id, currency) DO NOTHING",
            (dep["user_id"],),
        )
        _credit_user(conn, cur,
            user_id=dep["user_id"],
            amount_fcfa=net_fcfa,
            label=f"Dépôt Mobile Money {dep.get('provider') or ''}",
            deposit_id=dep["id"],
            metadata_extra={
                "gross_fcfa": float(gross_fcfa),
                "operator_fee_fcfa": float(sp_fee),
                "kobo_fee_fcfa": float(kobo_fee),
                "total_fee_fcfa": float(sp_fee + kobo_fee),
                "sharepay_net_amount": float(net_after_sp),
            },
        )
        conn.commit()

    if fee_fcfa > 0:
        credit_platform_fee(fee_fcfa, source="mobile_money_deposit", ref=dep["id"])

    body_msg = _deposit_confirmation_body(net_fcfa, operator_fee=sp_fee, kobo_fee=fee_fcfa)
    create_notification(
        user_id=dep["user_id"],
        notif_type="deposit_confirmed",
        title="Dépôt confirmé",
        body=body_msg,
    )


# ── SharePay Webhook ────────────────────────────────────────────────────────────

async def _handle_sharepay_payout_webhook(event_type: str, data: dict, sp_reference: str) -> dict[str, Any]:
    """Traite payout.success / payout.failed pour les retraits SharePay."""
    if not sp_reference:
        return {"status": "no_reference"}

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_withdrawals WHERE notchpay_txid=%s LIMIT 1", (sp_reference,))
        dep = cur.fetchone()

    if not dep:
        merch_ref = data.get("merchantReference") or ""
        if merch_ref:
            with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                cur.execute("SELECT * FROM fiat_withdrawals WHERE reference=%s LIMIT 1", (merch_ref,))
                dep = cur.fetchone()

    if not dep:
        log.warning("SharePay payout webhook: retrait introuvable sp_ref=%s", sp_reference)
        return {"status": "not_found"}

    if dep["status"] in ("completed", "failed"):
        return {"status": "already_processed"}

    payout_success_events = {"payout.success", "payout.completed", "payout.successful", "transfer.success", "transfer.completed"}
    payout_failed_events = {"payout.failed", "payout.cancelled", "payout.rejected", "transfer.failed", "transfer.cancelled"}

    if event_type in payout_success_events:
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE fiat_withdrawals SET status='completed', updated_at=%s WHERE id=%s",
                (utcnow(), dep["id"]),
            )
            cur.execute(
                "UPDATE wallet_transactions SET status='completed' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
                (dep["id"],),
            )
            conn.commit()
        if dep.get("fee_fcfa"):
            credit_platform_fee(
                Decimal(str(dep["fee_fcfa"])),
                source="fiat_withdrawal_sharepay",
                ref=dep["id"],
            )
        create_notification(
            user_id=dep["user_id"],
            notif_type="withdrawal_completed",
            title="Retrait effectué",
            body=f"Votre retrait de {float(dep['amount']):,.0f} FCFA a été envoyé sur votre compte Mobile Money.",
        )
        return {"status": "payout_completed"}

    if event_type not in payout_failed_events:
        return {"status": "ignored_payout_event", "event": event_type}

    # payout.failed — remboursement
    total_debit = Decimal(str(dep.get("total_debit") or dep["amount"]))
    now = utcnow()
    refund_id = f"tx_{uuid.uuid4().hex[:16]}"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_withdrawals SET status='failed', reject_reason=%s, updated_at=%s WHERE id=%s",
                ("Paiement mobile money échoué", now, dep["id"]),
        )
        cur.execute(
            "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
            (total_debit, now, dep["user_id"]),
        )
        cur.execute(
            """INSERT INTO wallet_transactions
               (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
               VALUES (%s,%s,'credit','fiat_withdrawal_refund','Retrait annulé — remboursé automatiquement','Kobo',%s,'FCFA','completed',%s,%s)""",
            (refund_id, dep["user_id"], total_debit, Json({"withdrawal_id": dep["id"]}), now),
        )
        cur.execute(
            "UPDATE wallet_transactions SET status='failed' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
            (dep["id"],),
        )
        conn.commit()
    create_notification(
        user_id=dep["user_id"],
        notif_type="withdrawal_failed",
        title="Retrait échoué",
        body="Votre retrait a échoué. Les fonds ont été remboursés sur votre compte Kobo.",
    )
    return {"status": "payout_failed_refunded"}


@router.post("/webhooks/sharepay")
async def sharepay_webhook(request: Request) -> dict[str, Any]:
    body = await request.body()
    sig = request.headers.get("x-sharepay-signature") or ""
    log.info("SharePay webhook received has_signature=%s content_length=%s", bool(sig), request.headers.get("content-length", "0"))

    if not sharepay_svc.verify_webhook_signature(body, sig):
        raise HTTPException(400, "Signature invalide")

    event = await request.json()
    event_type = event.get("event") or ""
    data = event.get("data") or {}
    sp_reference = data.get("reference") or ""

    log.warning("SharePay webhook event=%s sp_ref=%s", event_type, sp_reference)

    merch_ref = data.get("merchantReference") or ""
    try:
        from app.routers.mobile_money_transfers import handle_sharepay_webhook as _handle_mobile_money_transfer_webhook
        mm_result = await _handle_mobile_money_transfer_webhook(event_type, data, sp_reference, merch_ref)
        if mm_result.get("status") != "not_found":
            return mm_result
    except Exception as exc:
        log.warning("SharePay mobile money direct webhook routing failed: %s", exc)

    if event_type in (
        "payout.success", "payout.completed", "payout.successful",
        "payout.failed", "payout.cancelled", "payout.rejected",
        "transfer.success", "transfer.completed", "transfer.failed", "transfer.cancelled",
    ):
        return await _handle_sharepay_payout_webhook(event_type, data, sp_reference)

    if event_type not in ("payment.success", "payment.failed", "payment.cancelled"):
        return {"status": "ignored"}

    # Résoudre la référence marchande
    effective_ref = merch_ref or sp_reference

    # Routing : liens de paiement
    if effective_ref.startswith("PLX-"):
        success = (event_type == "payment.success")
        return await _handle_payment_link_webhook(effective_ref, success=success, webhook_data=data, provider="sharepay")

    if not sp_reference:
        return {"status": "no_reference"}

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_deposits WHERE notchpay_txid=%s LIMIT 1", (sp_reference,))
        dep = cur.fetchone()

    if not dep and merch_ref:
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT * FROM fiat_deposits WHERE reference=%s LIMIT 1", (merch_ref,))
            dep = cur.fetchone()

    if not dep:
        # Fallback : SharePay n'envoie pas toujours merchantReference — chercher dans payment_link_txs par aggregator_txid
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                "SELECT reference FROM payment_link_txs WHERE aggregator_txid=%s LIMIT 1",
                (sp_reference,),
            )
            pltx = cur.fetchone()
        if pltx:
            success = (event_type == "payment.success")
            log.warning("SharePay webhook: payment link found via aggregator_txid sp_ref=%s plx_ref=%s", sp_reference, pltx["reference"])
            return await _handle_payment_link_webhook(pltx["reference"], success=success, webhook_data=data, provider="sharepay")
        log.warning("SharePay deposit webhook: dépôt introuvable sp_ref=%s", sp_reference)
        return {"status": "not_found"}

    if dep["status"] in ("completed", "rejected"):
        return {"status": "already_processed"}

    if event_type in ("payment.failed", "payment.cancelled"):
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE fiat_deposits SET status='failed', updated_at=%s WHERE id=%s",
                (utcnow(), dep["id"]),
            )
            conn.commit()
        return {"status": "marked_failed"}

    # payment.success
    await _process_sharepay_deposit_success(dep, data)
    return {"status": "credited"}
