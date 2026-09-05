from __future__ import annotations

import logging
import re
import uuid
import hashlib
import hmac
from contextlib import closing
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_user
from app.core.time import utcnow
from app.db.session import get_conn
from app.services import notchpay
from app.services import sharepay as sharepay_svc
from app.services.email import notify_admin
from app.services.fees import calculate_fee_fcfa, credit_platform_fee, get_min_amount_fcfa
from app.services.notifications import create_notification
from app.services.pin_security import verify_user_pin
from app.services.users import get_user
from app.services.compliance import enforce_compliance

log = logging.getLogger("fiat_withdrawals")

router = APIRouter(prefix="/fiat-withdrawals", tags=["fiat-withdrawals"])

_MIN_KYC_LEVEL = 1
_DEFAULT_APPROVAL_THRESHOLD = Decimal("10000")
_IBAN_RE = re.compile(r"^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,30}$")
_PHONE_PROVIDERS = {"mtn": "cm.mtn", "orange": "cm.orange"}


def _get_approval_threshold() -> Decimal:
    try:
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT value FROM app_settings WHERE key = 'withdrawal_approval_threshold' LIMIT 1")
            row = cur.fetchone()
        if row and isinstance(row["value"], dict):
            return Decimal(str(row["value"].get("amount_fcfa", _DEFAULT_APPROVAL_THRESHOLD)))
    except Exception:
        pass
    return _DEFAULT_APPROVAL_THRESHOLD


def _get_active_payment_provider() -> str:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'payment_provider' LIMIT 1")
        row = cur.fetchone()
    if row and isinstance(row["value"], dict):
        return row["value"].get("provider", "sharepay")
    return "sharepay"


def _check_withdrawals_enabled() -> None:
    try:
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT value FROM app_settings WHERE key = 'service_status' LIMIT 1")
            row = cur.fetchone()
        if row and isinstance(row["value"], dict):
            if not row["value"].get("withdrawals_enabled", True):
                msg = row["value"].get("withdrawals_message") or "Les retraits sont temporairement indisponibles. Veuillez réessayer ultérieurement."
                raise HTTPException(503, msg)
    except HTTPException:
        raise
    except Exception:
        pass


class FiatWithdrawReq(BaseModel):
    amount: Decimal = Field(..., gt=0)
    currency: str
    method: str = "bank_transfer"
    recipient_name: str = Field(..., min_length=2, max_length=120)
    recipient_iban: str | None = Field(default=None, max_length=40)
    recipient_phone: str | None = Field(default=None, max_length=20)
    provider: str | None = None
    pin: str | None = Field(default=None, min_length=4, max_length=8)


@router.get("/fee-preview")
async def fee_preview(
    amount: Decimal = Query(default=0, ge=0),
    currency: str = Query(default="FCFA", min_length=3, max_length=4),
    method: str = Query(default="bank_transfer"),
) -> dict[str, Any]:
    if method == "mobile_money":
        fee_category = "mobile_money_withdrawal"
    elif method == "bank_transfer":
        fee_category = f"bank_withdrawal_{currency.lower()}"
    else:
        raise HTTPException(400, f"Méthode inconnue : {method}")

    min_amount = get_min_amount_fcfa(fee_category, 500)
    fee = calculate_fee_fcfa(fee_category, amount) if amount > 0 else Decimal("0")
    return {
        "category": fee_category,
        "min_amount_fcfa": float(min_amount),
        "fee_fcfa": float(fee),
        "total_fcfa": float(amount + fee),
    }


def _get_kyc_level(user_id: str) -> int:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT level FROM kyc_profiles WHERE user_id = %s LIMIT 1", (user_id,))
        row = cur.fetchone()
    return (row["level"] if row else 0) or 0


def _hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def _verify_user_pin(user_id: str, pin: str | None) -> None:
    verify_user_pin(user_id, pin, purpose="fiat_withdrawal")


def _get_balance(user_id: str) -> Decimal:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id=%s AND currency='FCFA'",
            (user_id,),
        )
        row = cur.fetchone()
    return Decimal(str(row["balance"])) if row else Decimal("0")


async def _run_notchpay_payout(
    withdrawal_id: str,
    user_id: str,
    reference: str,
    amount_int: int,
    total_debit: Decimal,
    phone: str,
    name: str,
    provider: str,
) -> None:
    """Background task : envoie le paiement Mobile Money via NotchPay et met à jour le statut."""
    try:
        np_data = await notchpay.initiate_transfer(
            reference=reference,
            amount=amount_int,
            phone=phone,
            name=name,
            provider=provider,
            description=f"Retrait Kobo {reference}",
        )
        np_tx = np_data.get("transfer") or np_data.get("transaction") or {}
        np_txid = np_tx.get("reference") or ""
        note = f"NotchPay: {np_txid}" if np_txid else "Paiement envoyé"
        now = utcnow()
        fee_fcfa_row: dict | None = None
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE fiat_withdrawals SET status='processing', note=%s, notchpay_txid=%s, updated_at=%s WHERE id=%s",
                (note, np_txid, now, withdrawal_id),
            )
            cur.execute(
                "UPDATE wallet_transactions SET status='processing' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
                (withdrawal_id,),
            )
            conn.commit()
        log.info("NotchPay payout initié: %s → %s (en attente webhook)", withdrawal_id, np_txid)
    except Exception as exc:
        log.warning("Payout échoué pour %s : %s", withdrawal_id, exc)
        now = utcnow()
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                "UPDATE fiat_withdrawals SET status='failed', reject_reason=%s, updated_at=%s WHERE id=%s",
                (f"Paiement mobile échoué : {exc}", now, withdrawal_id),
            )
            # Remboursement : re-crédit du montant total débité
            cur.execute(
                "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
                (total_debit, now, user_id),
            )
            refund_id = f"tx_{uuid.uuid4().hex[:16]}"
            cur.execute(
                """INSERT INTO wallet_transactions
                   (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
                   VALUES (%s,%s,'credit','fiat_withdrawal_refund','Retrait annulé — remboursé automatiquement','Kobo',%s,'FCFA','completed',%s,%s)""",
                (refund_id, user_id, total_debit, Json({"withdrawal_id": withdrawal_id, "reason": str(exc)}), now),
            )
            cur.execute(
                "UPDATE wallet_transactions SET status='failed' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
                (withdrawal_id,),
            )
            conn.commit()
        create_notification(
            user_id=user_id,
            notif_type="withdrawal_failed",
            title="Retrait échoué",
            body=f"Votre retrait a échoué. Les fonds ont été remboursés sur votre compte Kobo.",
            metadata={"withdrawal_id": withdrawal_id},
        )


async def _run_sharepay_payout(
    withdrawal_id: str,
    user_id: str,
    reference: str,
    amount_int: int,
    total_debit: Decimal,
    phone: str,
    name: str,
    provider: str,
) -> None:
    """Background task : payout Mobile Money.

    SharePay renvoie les refus techniques immédiatement. La décision finale est
    ensuite récupérée par le job de réconciliation via check_status/{PO-*}.
    """
    try:
        sp_data = await sharepay_svc.create_transfer(
            reference=reference,
            amount=amount_int,
            phone=phone,
            name=name,
            provider=provider,
            description=f"Retrait Kobo {reference}",
        )
        sp_ref = sp_data.get("reference") or ""
        now = utcnow()
        note = f"Paiement mobile money envoyé ({sp_ref})" if sp_ref else "Paiement mobile money envoyé"
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE fiat_withdrawals SET status='processing', note=%s, notchpay_txid=%s, updated_at=%s WHERE id=%s",
                (note, sp_ref, now, withdrawal_id),
            )
            cur.execute(
                "UPDATE wallet_transactions SET status='processing' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
                (withdrawal_id,),
            )
            conn.commit()
        create_notification(
            user_id=user_id,
            notif_type="withdrawal_processing",
            title="Retrait en traitement",
            body=f"Votre retrait de {amount_int:,.0f} FCFA est en cours de traitement Mobile Money.",
            metadata={"withdrawal_id": withdrawal_id, "provider_reference": sp_ref},
        )
        log.info("Payout mobile money initié: %s → %s", withdrawal_id, sp_ref)
    except Exception as exc:
        log.warning("SharePay payout échoué pour %s : %s", withdrawal_id, exc)
        now = utcnow()
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                "UPDATE fiat_withdrawals SET status='failed', reject_reason=%s, updated_at=%s WHERE id=%s",
                (f"Paiement mobile money échoué : {exc}", now, withdrawal_id),
            )
            cur.execute(
                "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
                (total_debit, now, user_id),
            )
            refund_id = f"tx_{uuid.uuid4().hex[:16]}"
            cur.execute(
                """INSERT INTO wallet_transactions
                   (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
                   VALUES (%s,%s,'credit','fiat_withdrawal_refund','Retrait annulé — remboursé automatiquement','Kobo',%s,'FCFA','completed',%s,%s)""",
                (refund_id, user_id, total_debit, Json({"withdrawal_id": withdrawal_id, "reason": str(exc)}), now),
            )
            cur.execute(
                "UPDATE wallet_transactions SET status='failed' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
                (withdrawal_id,),
            )
            conn.commit()
        create_notification(
            user_id=user_id,
            notif_type="withdrawal_failed",
            title="Retrait échoué",
            body="Votre retrait a échoué. Les fonds ont été remboursés sur votre compte Kobo.",
            metadata={"withdrawal_id": withdrawal_id},
        )


@router.post("/init")
async def init_fiat_withdrawal(
    req: FiatWithdrawReq,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    _check_withdrawals_enabled()
    _verify_user_pin(user.id, req.pin)

    kyc_level = _get_kyc_level(user.id)
    if kyc_level < _MIN_KYC_LEVEL:
        raise HTTPException(
            403,
            "Vérification d'identité (KYC) requise avant tout retrait. "
            "Complétez votre KYC dans l'application.",
        )

    if req.method == "bank_transfer":
        if not req.recipient_iban:
            raise HTTPException(400, "IBAN requis pour un virement bancaire")
        iban_clean = req.recipient_iban.replace(" ", "").upper()
        if not _IBAN_RE.match(iban_clean):
            raise HTTPException(400, "Format IBAN invalide")
    elif req.method == "mobile_money":
        if not req.recipient_phone:
            raise HTTPException(400, "Numéro de téléphone requis pour Mobile Money")
        if not req.provider or req.provider.lower() not in _PHONE_PROVIDERS:
            raise HTTPException(400, "Opérateur invalide (mtn ou orange)")
    else:
        raise HTTPException(400, f"Méthode inconnue : {req.method}")

    if req.method == "mobile_money":
        fee_category = "mobile_money_withdrawal"
    else:
        fee_category = f"bank_withdrawal_{req.currency.lower()}"

    min_amount = get_min_amount_fcfa(fee_category, 500)
    if req.amount < min_amount:
        raise HTTPException(400, f"Montant minimum : {int(min_amount)} FCFA")

    fee_fcfa = calculate_fee_fcfa(fee_category, req.amount)

    total_debit = req.amount + fee_fcfa
    compliance = enforce_compliance(user_id=user.id, amount_fcfa=total_debit, flow="fiat", allow_manual_review=True)

    balance = _get_balance(user.id)
    if balance < total_debit:
        raise HTTPException(
            400,
            f"Solde insuffisant. Disponible : {float(balance):,.0f} FCFA"
            + (f" (dont {float(fee_fcfa):,.0f} FCFA de frais)" if fee_fcfa > 0 else ""),
        )

    withdrawal_id = f"fw_{uuid.uuid4().hex}"
    reference = f"WIT-{uuid.uuid4().hex[:10].upper()}"
    now = utcnow()
    iban_clean = (req.recipient_iban or "").replace(" ", "").upper() or None

    approval_threshold = _get_approval_threshold()
    needs_approval = compliance.review_required or (req.method == "mobile_money" and approval_threshold > 0 and req.amount > approval_threshold)
    initial_status = "pending_approval" if needs_approval else "pending"

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id=%s AND currency='FCFA' FOR UPDATE",
            (user.id,),
        )
        locked_wallet = cur.fetchone()
        locked_balance = Decimal(str(locked_wallet[0] if locked_wallet else 0))
        if locked_balance < total_debit:
            raise HTTPException(
                400,
                f"Solde insuffisant. Disponible : {float(locked_balance):,.0f} FCFA",
            )
        cur.execute(
            "UPDATE wallet_accounts SET balance=balance-%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
            (total_debit, now, user.id),
        )
        cur.execute(
            """INSERT INTO fiat_withdrawals
               (id, user_id, currency, amount, fee_fcfa, total_debit, method,
                recipient_iban, recipient_name, recipient_phone, provider,
                reference, status, kyc_level_at_request, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (withdrawal_id, user.id, req.currency.upper(), req.amount,
             fee_fcfa, total_debit, req.method,
             iban_clean, req.recipient_name, req.recipient_phone, req.provider,
             reference, initial_status, kyc_level, now, now),
        )
        tx_id = f"tx_{uuid.uuid4().hex}"
        label = f"Retrait {req.method.replace('_', ' ').title()} — {req.currency}"
        if fee_fcfa > 0:
            label += f" (frais {float(fee_fcfa):,.0f} FCFA)"
        cur.execute(
            """INSERT INTO wallet_transactions
               (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
               VALUES (%s,%s,'debit','fiat_withdrawal',%s,%s,%s,'FCFA','pending',%s,%s)""",
            (tx_id, user.id, label, req.recipient_name, total_debit,
             Json({"withdrawal_id": withdrawal_id, "fee_fcfa": float(fee_fcfa)}), now),
        )
        conn.commit()

    if needs_approval:
        create_notification(
            user_id=user.id,
            notif_type="withdrawal_pending_approval",
            title="Retrait en attente de validation",
            body=f"Votre demande de retrait de {float(req.amount):,.0f} FCFA est en attente de validation par notre équipe. "
                 f"Les fonds ont été réservés sur votre compte. Vous serez notifié dès validation.",
            metadata={"withdrawal_id": withdrawal_id},
        )
        notify_admin(
            f"Retrait Mobile Money > {int(approval_threshold):,} FCFA — validation requise",
            f"<b>Référence :</b> {reference}<br>"
            f"<b>Utilisateur :</b> {user.id}<br>"
            f"<b>Montant :</b> {float(req.amount):,.0f} FCFA<br>"
            f"<b>Frais :</b> {float(fee_fcfa):,.0f} FCFA<br>"
            f"<b>Bénéficiaire :</b> {req.recipient_name} — {req.recipient_phone}<br>"
            f"<b>Opérateur :</b> {req.provider}<br><br>"
            f"<b>Action requise :</b> Approuver ou rejeter dans le panel admin.",
        )
        message = (
            f"Votre demande de retrait de {float(req.amount):,.0f} FCFA est en attente de validation. "
            f"Notre équipe la traitera sous peu. Vous serez notifié."
        )
    elif req.method == "mobile_money":
        active_provider = _get_active_payment_provider()
        if active_provider == "sharepay":
            background_tasks.add_task(
                _run_sharepay_payout,
                withdrawal_id, user.id, reference,
                int(req.amount), total_debit,
                req.recipient_phone, req.recipient_name, req.provider.lower(),
            )
            message = "Paiement en cours. Vous recevrez une confirmation sous quelques minutes."
        else:
            background_tasks.add_task(
                _run_notchpay_payout,
                withdrawal_id, user.id, reference,
                int(req.amount), total_debit,
                req.recipient_phone, req.recipient_name, req.provider.lower(),
            )
            create_notification(
                user_id=user.id,
                notif_type="withdrawal_processing",
                title="Retrait en traitement",
                body=f"Votre retrait de {float(req.amount):,.0f} FCFA est en cours de traitement Mobile Money.",
                metadata={"withdrawal_id": withdrawal_id, "reference": reference},
            )
            message = "Paiement Mobile Money en cours. Vous recevrez une confirmation sous quelques minutes."
    else:
        notify_admin(
            "Nouvelle demande de retrait fiat",
            f"<b>Référence :</b> {reference}<br>"
            f"<b>Utilisateur :</b> {user.id}<br>"
            f"<b>Montant :</b> {float(req.amount):,.0f} {req.currency}<br>"
            f"<b>Frais :</b> {float(fee_fcfa):,.0f} FCFA<br>"
            f"<b>Total débité :</b> {float(total_debit):,.0f} FCFA<br>"
            f"<b>Méthode :</b> {req.method}<br>"
            f"<b>Bénéficiaire :</b> {req.recipient_name}<br>"
            f"<b>IBAN :</b> {iban_clean or '—'}<br>"
            f"Fonds débités. À traiter dans le panel admin.",
        )
        create_notification(
            user_id=user.id,
            notif_type="withdrawal_submitted",
            title="Retrait enregistré",
            body=(
                f"Votre retrait de {float(req.amount):,.0f} {req.currency.upper()} vers {req.recipient_name} "
                f"est enregistré. Les fonds ont été réservés et notre équipe traite la demande."
            ),
            metadata={"withdrawal_id": withdrawal_id, "reference": reference},
        )
        message = "Demande de retrait soumise. Traitement sous 1–3 jours ouvrés."

    return {
        "withdrawal_id": withdrawal_id,
        "reference": reference,
        "status": initial_status,
        "fee_fcfa": float(fee_fcfa),
        "total_debited_fcfa": float(total_debit),
        "message": message,
    }


async def trigger_approved_payout(withdrawal_id: str, background_tasks: Any) -> None:
    """Called by admin after approving a pending_approval withdrawal."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_withdrawals WHERE id=%s LIMIT 1", (withdrawal_id,))
        w = cur.fetchone()
    if not w or w["status"] not in ("pending_approval", "processing"):
        raise ValueError(f"Cannot trigger payout for withdrawal {withdrawal_id}: status={w and w['status']}")
    active_provider = _get_active_payment_provider()
    if active_provider == "sharepay":
        background_tasks.add_task(
            _run_sharepay_payout,
            withdrawal_id, w["user_id"], w["reference"],
            int(w["amount"]), Decimal(str(w["total_debit"])),
            w["recipient_phone"], w["recipient_name"], (w["provider"] or "mtn").lower(),
        )
    else:
        background_tasks.add_task(
            _run_notchpay_payout,
            withdrawal_id, w["user_id"], w["reference"],
            int(w["amount"]), Decimal(str(w["total_debit"])),
            w["recipient_phone"], w["recipient_name"], (w["provider"] or "mtn").lower(),
        )


async def trigger_payout_retry(withdrawal_id: str, background_tasks: Any, new_reference: str) -> None:
    """Re-déclenche un paiement Mobile Money pour un retrait coincé ou mal complété."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM fiat_withdrawals WHERE id=%s LIMIT 1", (withdrawal_id,))
        w = cur.fetchone()
    if not w:
        raise ValueError(f"Withdrawal {withdrawal_id} introuvable")
    active_provider = _get_active_payment_provider()
    if active_provider == "sharepay":
        background_tasks.add_task(
            _run_sharepay_payout,
            withdrawal_id, w["user_id"], new_reference,
            int(w["amount"]), Decimal(str(w["total_debit"])),
            w["recipient_phone"], w["recipient_name"], (w["provider"] or "mtn").lower(),
        )
    else:
        background_tasks.add_task(
            _run_notchpay_payout,
            withdrawal_id, w["user_id"], new_reference,
            int(w["amount"]), Decimal(str(w["total_debit"])),
            w["recipient_phone"], w["recipient_name"], (w["provider"] or "mtn").lower(),
        )


@router.get("/{withdrawal_id}/status")
async def get_withdrawal_status(
    withdrawal_id: str,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM fiat_withdrawals WHERE id=%s AND user_id=%s LIMIT 1",
            (withdrawal_id, user.id),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Retrait introuvable")
    return {
        "id": row["id"],
        "currency": row["currency"],
        "amount": float(row["amount"]),
        "fee_fcfa": float(row.get("fee_fcfa") or 0),
        "total_debit": float(row.get("total_debit") or 0),
        "method": row["method"],
        "status": row["status"],
        "reference": row["reference"],
        "reject_reason": row["reject_reason"],
        "note": row.get("note") or "",
        "created_at": row["created_at"].isoformat(),
    }
