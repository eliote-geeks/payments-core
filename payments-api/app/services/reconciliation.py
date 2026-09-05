from __future__ import annotations

import logging
from contextlib import closing
from decimal import Decimal, ROUND_HALF_UP

import httpx
import psycopg
from psycopg.types.json import Json

from app.core.config import settings
from app.core.time import utcnow
from app.db.session import get_conn
from app.routers.deposits import (
    _credit_user,
    _deposit_confirmation_body,
    _get_operator_fee_rate,
    _handle_payment_link_webhook,
    _process_sharepay_deposit_success,
)
from app.routers.mobile_money_transfers import reconcile_mobile_money_transfers
from app.services.crypto_reconciliation import reconcile_crypto_deposits
from app.services import sharepay as sharepay_svc
from app.services.fees import calculate_fee_fcfa, credit_platform_fee
from app.services.fees import KOBO_PLATFORM_ACCOUNT
from app.services.notifications import create_notification

log = logging.getLogger("payment_reconciliation")

NOTCHPAY_API = "https://api.notchpay.co"
SUCCESS_STATUSES = {"complete", "completed", "success", "successful", "paid"}
FAILED_STATUSES = {"failed", "canceled", "cancelled", "expired", "rejected"}


async def _notchpay_get(path: str) -> dict:
    headers = {
        "Authorization": settings.notchpay_public_key,
        "X-Grant": settings.notchpay_private_key,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(f"{NOTCHPAY_API}{path}", headers=headers)
    try:
        data = resp.json()
    except Exception:
        data = {"raw": resp.text}
    data["_http_status"] = resp.status_code
    return data


def _nested_status(payload: dict, *keys: str) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            status = value.get("status") or value.get("state")
            if status:
                return str(status).lower()
    value = payload.get("data")
    if isinstance(value, dict):
        return str(value.get("status") or value.get("state") or "").lower()
    return ""


def _credit_notchpay_deposit(dep: dict, payload: dict) -> bool:
    gross_fcfa = Decimal(str(dep["amount"]))
    payment = payload.get("transaction") or payload.get("payment") or payload.get("data") or {}
    net_raw = payment.get("net_amount") or payment.get("netAmount") or payment.get("net")
    if net_raw is not None:
        try:
            candidate = Decimal(str(net_raw))
            net_after_operator = candidate if Decimal("0") < candidate <= gross_fcfa else gross_fcfa
        except Exception:
            net_after_operator = gross_fcfa
    else:
        op_rate = Decimal(str(_get_operator_fee_rate("notchpay")))
        op_fee = (gross_fcfa * op_rate / Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        net_after_operator = gross_fcfa - op_fee
    operator_fee = gross_fcfa - net_after_operator

    fee_fcfa = calculate_fee_fcfa("mobile_money_deposit", net_after_operator)
    net_fcfa = net_after_operator - fee_fcfa
    now = utcnow()

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_deposits SET status='completed', fee=%s, note=%s, updated_at=%s WHERE id=%s AND status='processing'",
            (fee_fcfa, "Paiement Mobile Money confirmé automatiquement", now, dep["id"]),
        )
        if cur.rowcount == 0:
            conn.rollback()
            return False
        cur.execute(
            "INSERT INTO wallet_accounts (user_id, currency, balance) VALUES (%s,'FCFA',0) ON CONFLICT (user_id, currency) DO NOTHING",
            (dep["user_id"],),
        )
        _credit_user(
            conn,
            cur,
            user_id=dep["user_id"],
            amount_fcfa=net_fcfa,
            label=f"Dépôt Mobile Money {dep.get('provider') or ''}",
            deposit_id=dep["id"],
            metadata_extra={
                "gross_fcfa": float(gross_fcfa),
                "operator_fee_fcfa": float(operator_fee),
                "kobo_fee_fcfa": float(fee_fcfa),
                "total_fee_fcfa": float(operator_fee + fee_fcfa),
                "reconciled": True,
            },
        )
        conn.commit()

    if fee_fcfa > 0:
        credit_platform_fee(fee_fcfa, source="mobile_money_deposit_reconcile", ref=dep["id"])
    create_notification(
        user_id=dep["user_id"],
        notif_type="deposit_confirmed",
        title="Dépôt confirmé",
        body=_deposit_confirmation_body(net_fcfa, operator_fee=operator_fee, kobo_fee=fee_fcfa),
    )
    return True


def _fail_notchpay_deposit(dep: dict, status: str) -> bool:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_deposits SET status='failed', note=%s, updated_at=%s WHERE id=%s AND status='processing'",
            (f"Paiement Mobile Money {status}", utcnow(), dep["id"]),
        )
        changed = cur.rowcount > 0
        conn.commit()
    return changed


def _complete_notchpay_withdrawal(w: dict) -> bool:
    now = utcnow()
    fee = Decimal(str(w.get("fee_fcfa") or 0))
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE fiat_withdrawals SET status='completed', note=%s, updated_at=%s WHERE id=%s AND status='processing'",
            ("Transfert Mobile Money confirmé automatiquement", now, w["id"]),
        )
        if cur.rowcount == 0:
            conn.rollback()
            return False
        cur.execute(
            "UPDATE wallet_transactions SET status='completed' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
            (w["id"],),
        )
        conn.commit()

    if fee > 0:
        credit_platform_fee(fee, source="fiat_withdrawal_notchpay_reconcile", ref=w["id"])
    create_notification(
        user_id=w["user_id"],
        notif_type="withdrawal_completed",
        title="Retrait effectué",
        body=f"Votre retrait de {float(w['amount']):,.0f} FCFA a été envoyé sur votre compte Mobile Money.",
    )
    return True


def _reverse_platform_fee(ref: str) -> Decimal:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS credited
            FROM wallet_transactions
            WHERE user_id=%s
              AND category='platform_fee'
              AND metadata->>'ref'=%s
            """,
            (KOBO_PLATFORM_ACCOUNT, ref),
        )
        credited = Decimal(str((cur.fetchone() or {}).get("credited") or 0))
        cur.execute(
            """
            SELECT COALESCE(SUM(amount), 0) AS reversed
            FROM wallet_transactions
            WHERE user_id=%s
              AND category='platform_fee_reversal'
              AND metadata->>'ref'=%s
            """,
            (KOBO_PLATFORM_ACCOUNT, ref),
        )
        reversed_amount = Decimal(str((cur.fetchone() or {}).get("reversed") or 0))
        due = credited - reversed_amount
        if due <= 0:
            return Decimal("0")
        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id=%s AND currency='FCFA' FOR UPDATE",
            (KOBO_PLATFORM_ACCOUNT,),
        )
        platform_wallet = cur.fetchone()
        platform_balance = Decimal(str((platform_wallet or {}).get("balance") or 0))
        if platform_balance < due:
            raise RuntimeError("Solde plateforme insuffisant pour contrepasser les frais")
        now = utcnow()
        cur.execute(
            "UPDATE wallet_accounts SET balance=balance-%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
            (due, now, KOBO_PLATFORM_ACCOUNT),
        )
        cur.execute(
            """INSERT INTO wallet_transactions
               (id,user_id,direction,category,label,counterpart,amount,currency,status,metadata,created_at)
               VALUES (%s,%s,'debit','platform_fee_reversal','Frais retrait annulés','Kobo Platform',%s,'FCFA','completed',%s,%s)""",
            (f"fee_rev_{ref[-12:]}", KOBO_PLATFORM_ACCOUNT, due, Json({"source": "fiat_withdrawal_failed_reversal", "ref": ref}), now),
        )
        conn.commit()
        return due


def _fail_notchpay_withdrawal(w: dict, status: str) -> bool:
    total_debit = Decimal(str(w.get("total_debit") or w["amount"]))
    now = utcnow()
    refund_id = f"tx_recon_{w['id'][-12:]}"
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(amount), 0)
            FROM wallet_transactions
            WHERE category='fiat_withdrawal_refund'
              AND metadata->>'withdrawal_id'=%s
            """,
            (w["id"],),
        )
        refunded = Decimal(str((cur.fetchone() or [0])[0] or 0))
        cur.execute(
            "UPDATE fiat_withdrawals SET status='failed', reject_reason=%s, updated_at=%s WHERE id=%s AND status IN ('processing','completed')",
            (f"Transfert Mobile Money {status}", now, w["id"]),
        )
        if cur.rowcount == 0:
            conn.rollback()
            return False
        refund_due = total_debit - refunded
        if refund_due > 0:
            cur.execute(
                "UPDATE wallet_accounts SET balance=balance+%s, updated_at=%s WHERE user_id=%s AND currency='FCFA'",
                (refund_due, now, w["user_id"]),
            )
            cur.execute(
                """INSERT INTO wallet_transactions
                   (id,user_id,direction,category,label,counterpart,amount,currency,status,metadata,created_at)
                   VALUES (%s,%s,'credit','fiat_withdrawal_refund','Retrait annulé - remboursé automatiquement','Kobo',%s,'FCFA','completed',%s,%s)
                   ON CONFLICT (id) DO NOTHING""",
                (refund_id, w["user_id"], refund_due, Json({"withdrawal_id": w["id"], "reason": status}), now),
            )
        cur.execute(
            "UPDATE wallet_transactions SET status='failed' WHERE category='fiat_withdrawal' AND metadata->>'withdrawal_id'=%s",
            (w["id"],),
        )
        conn.commit()
    _reverse_platform_fee(w["id"])
    create_notification(
        user_id=w["user_id"],
        notif_type="withdrawal_failed",
        title="Retrait échoué",
        body="Votre retrait a échoué chez l'opérateur. Les fonds ont été remboursés sur votre compte Kobo.",
        metadata={"withdrawal_id": w["id"], "provider_reference": w.get("notchpay_txid")},
    )
    return True


async def run_payment_reconciliation() -> dict[str, int]:
    result = {
        "deposits_checked": 0,
        "deposits_completed": 0,
        "deposits_failed": 0,
        "withdrawals_checked": 0,
        "withdrawals_completed": 0,
        "withdrawals_failed": 0,
        "payment_links_checked": 0,
        "payment_links_completed": 0,
        "payment_links_failed": 0,
        "mm_checked": 0,
        "mm_payins_completed": 0,
        "mm_payouts_completed": 0,
        "mm_failed": 0,
        "crypto_wallets_checked": 0,
        "crypto_events_checked": 0,
        "crypto_deposits_matched": 0,
        "crypto_deposits_credited": 0,
        "crypto_manual_review": 0,
        "crypto_failed": 0,
    }
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT * FROM fiat_deposits
            WHERE status='processing'
              AND created_at >= now() - interval '7 days'
              AND (
                coalesce(notchpay_txid, '') LIKE 'trx.%'
                OR coalesce(notchpay_txid, '') LIKE 'PI-%'
              )
            ORDER BY created_at DESC
            LIMIT 50
            """
        )
        deposits = [dict(r) for r in cur.fetchall()]
        cur.execute(
            """
            SELECT * FROM fiat_withdrawals
            WHERE status IN ('processing','completed')
              AND created_at >= now() - interval '7 days'
              AND (
                coalesce(notchpay_txid, '') LIKE 'trf.%'
                OR coalesce(notchpay_txid, '') LIKE 'PO-%'
              )
            ORDER BY created_at DESC
            LIMIT 50
            """
        )
        withdrawals = [dict(r) for r in cur.fetchall()]
        cur.execute(
            """
            SELECT t.id, t.reference, t.aggregator_txid, t.status
            FROM payment_link_txs t
            WHERE t.status IN ('pending','processing')
              AND t.created_at >= now() - interval '7 days'
              AND (
                coalesce(t.aggregator_txid, '') LIKE 'PI-%'
                OR coalesce(t.reference, '') LIKE 'PLX-%'
              )
            ORDER BY t.created_at DESC
            LIMIT 50
            """
        )
        payment_link_txs = [dict(r) for r in cur.fetchall()]

    for dep in deposits:
        result["deposits_checked"] += 1
        try:
            provider_ref = str(dep.get("notchpay_txid") or "")
            if provider_ref.startswith("PI-"):
                payload = await sharepay_svc.get_payment_status(provider_ref)
                status = str(payload.get("status") or "").lower()
                if status in SUCCESS_STATUSES:
                    await _process_sharepay_deposit_success(dep, payload)
                    result["deposits_completed"] += 1
                elif status in FAILED_STATUSES and _fail_notchpay_deposit(dep, status):
                    result["deposits_failed"] += 1
            else:
                payload = await _notchpay_get(f"/payments/{provider_ref}")
                status = _nested_status(payload, "transaction", "payment")
                if status in SUCCESS_STATUSES and _credit_notchpay_deposit(dep, payload):
                    result["deposits_completed"] += 1
                elif status in FAILED_STATUSES and _fail_notchpay_deposit(dep, status):
                    result["deposits_failed"] += 1
        except Exception as exc:
            log.warning("Deposit reconciliation failed dep=%s: %s", dep.get("id"), exc)

    for w in withdrawals:
        result["withdrawals_checked"] += 1
        try:
            provider_ref = str(w.get("notchpay_txid") or "")
            if provider_ref.startswith("PO-"):
                payload = await sharepay_svc.get_payout_status(provider_ref)
                status = str(payload.get("status") or "").lower()
            else:
                payload = await _notchpay_get(f"/transfers/{provider_ref}")
                status = _nested_status(payload, "transfer")
            if status in SUCCESS_STATUSES and _complete_notchpay_withdrawal(w):
                result["withdrawals_completed"] += 1
            elif status in FAILED_STATUSES and _fail_notchpay_withdrawal(w, status):
                result["withdrawals_failed"] += 1
        except Exception as exc:
            log.warning("Withdrawal reconciliation failed withdrawal=%s: %s", w.get("id"), exc)

    for tx in payment_link_txs:
        result["payment_links_checked"] += 1
        try:
            provider_ref = str(tx.get("aggregator_txid") or "")
            if not provider_ref.startswith("PI-"):
                continue
            payload = await sharepay_svc.get_payment_status(provider_ref)
            status = str(payload.get("status") or "").lower()
            if status in SUCCESS_STATUSES:
                handled = await _handle_payment_link_webhook(
                    str(tx["reference"]),
                    success=True,
                    webhook_data=payload,
                    provider="sharepay",
                )
                if handled.get("status") in ("link_payment_completed", "already_processed"):
                    result["payment_links_completed"] += 1
            elif status in FAILED_STATUSES:
                handled = await _handle_payment_link_webhook(
                    str(tx["reference"]),
                    success=False,
                    webhook_data=payload,
                    provider="sharepay",
                )
                if handled.get("status") in ("link_payment_failed", "already_processed"):
                    result["payment_links_failed"] += 1
        except Exception as exc:
            log.warning("Payment link reconciliation failed tx=%s ref=%s: %s", tx.get("id"), tx.get("reference"), exc)

    try:
        result.update(await reconcile_mobile_money_transfers())
    except Exception as exc:
        log.warning("Mobile Money direct reconciliation failed: %s", exc)

    try:
        result.update(reconcile_crypto_deposits())
    except Exception as exc:
        log.warning("Crypto reconciliation failed: %s", exc)

    return result
