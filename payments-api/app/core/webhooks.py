from __future__ import annotations

import uuid
from contextlib import closing
from typing import Any

import psycopg
from fastapi import APIRouter
from psycopg.types.json import Json

from app.core.time import utcnow
from app.db.session import get_conn
from app.services import stellar_sep

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _build_step(name: str, status: str, detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "step": name,
        "status": status,
        "timestamp": utcnow().isoformat(),
        "detail": detail,
    }


def _append_step_and_update(
    transfer_id: str,
    step: dict[str, Any],
    *,
    payment_status: str | None = None,
    settlement_status: str | None = None,
    status: str | None = None,
    settlement_reference: str | None = None,
) -> None:
    fields = ["orchestration = orchestration || %s::jsonb", "updated_at = %s"]
    values: list[Any] = [Json([step]), utcnow()]
    if payment_status is not None:
        fields.append("payment_status = %s")
        values.append(payment_status)
    if settlement_status is not None:
        fields.append("settlement_status = %s")
        values.append(settlement_status)
    if status is not None:
        fields.append("status = %s")
        values.append(status)
    if settlement_reference is not None:
        fields.append("settlement_reference = %s")
        values.append(settlement_reference)
    values.append(transfer_id)
    with closing(get_conn()) as conn:
        conn.cursor().execute(
            f"UPDATE transfers SET {', '.join(fields)} WHERE id = %s", values
        )
        conn.commit()


def _mark_webhook_processed(event_id: str, error: str | None = None) -> None:
    with closing(get_conn()) as conn:
        conn.cursor().execute(
            "UPDATE webhook_events SET processed_at = %s, processing_error = %s WHERE id = %s",
            (utcnow(), error, event_id),
        )
        conn.commit()


def _store_event(provider: str, payload: dict[str, Any]) -> tuple[str, str | None]:
    """Persist the raw event and return (event_id, transfer_id)."""
    event_type = payload.get("type") or (
        payload.get("content", {}).get("type", "unknown")
        if isinstance(payload.get("content"), dict)
        else "unknown"
    )
    transfer_id: str | None = (
        payload.get("transfer_id")
        or payload.get("metadata", {}).get("transfer_id")
        or (
            payload.get("content", {}).get("object", {}).get("metadata", {}).get("transfer_id")
            if isinstance(payload.get("content"), dict)
            else None
        )
    )
    event_id = f"evt_{uuid.uuid4().hex[:16]}"
    with closing(get_conn()) as conn:
        conn.cursor().execute(
            """
            INSERT INTO webhook_events (id, provider, event_type, transfer_id, payload)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (event_id, provider, event_type, transfer_id, Json(payload)),
        )
        conn.commit()
    return event_id, transfer_id


def _get_transfer_by_funding_ref(payment_id: str) -> dict[str, Any] | None:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM transfers WHERE funding_reference = %s", (payment_id,)
        )
        return cur.fetchone()


def _get_transfer_by_settlement_ref(stellar_id: str) -> dict[str, Any] | None:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM transfers WHERE settlement_reference = %s", (stellar_id,)
        )
        return cur.fetchone()


# ---------------------------------------------------------------------------
# Hyperswitch event processing
# ---------------------------------------------------------------------------


async def _process_hyperswitch_event(
    event_id: str, event_type: str, obj: dict[str, Any]
) -> None:
    payment_id: str = obj.get("payment_id", "")
    if not payment_id:
        _mark_webhook_processed(event_id, "missing payment_id in object")
        return

    transfer = _get_transfer_by_funding_ref(payment_id)
    if not transfer:
        _mark_webhook_processed(event_id, f"no transfer for payment_id={payment_id}")
        return

    transfer_id: str = transfer["id"]

    if event_type == "payment.succeeded":
        step = _build_step(
            "hyperswitch_payment_succeeded",
            "ok",
            {"payment_id": payment_id, "amount": obj.get("amount"), "currency": obj.get("currency")},
        )
        _append_step_and_update(
            transfer_id,
            step,
            payment_status="funded",
            status="pending_settlement",
        )
        await _trigger_stellar_settlement(transfer_id, transfer)

    elif event_type in ("payment.failed", "payment.cancelled"):
        mapped = "payment_failed" if event_type == "payment.failed" else "payment_cancelled"
        step = _build_step(
            "hyperswitch_payment_failed",
            "error",
            {"payment_id": payment_id, "event_type": event_type, "error_code": obj.get("error_code")},
        )
        _append_step_and_update(transfer_id, step, payment_status=mapped, status="failed")

    elif event_type == "payment.processing":
        step = _build_step(
            "hyperswitch_payment_processing",
            "ok",
            {"payment_id": payment_id},
        )
        _append_step_and_update(transfer_id, step, payment_status="funding_processing")

    _mark_webhook_processed(event_id)


async def _trigger_stellar_settlement(transfer_id: str, transfer: dict[str, Any]) -> None:
    """After funding, initiate SEP-6 withdrawal to mobile money."""
    recipient = transfer.get("recipient") or {}
    dest_phone: str = (
        recipient.get("phone") or recipient.get("phone_e164") or recipient.get("mobile") or ""
    )
    target_currency: str = transfer.get("target_currency", "XAF")
    target_amount: str = str(transfer.get("target_amount", "0"))

    # Asset the anchor accepts (USDC on testnet, adapt for prod)
    asset_code = "USDC" if target_currency == "XAF" else target_currency

    try:
        sep_resp = await stellar_sep.initiate_withdrawal(
            asset_code=asset_code,
            amount=target_amount,
            dest=dest_phone,
            dest_extra=target_currency,
            transfer_id=transfer_id,
        )
        stellar_tx_id: str = sep_resp.get("id", "")
        step = _build_step(
            "stellar_withdrawal_initiated",
            "ok",
            {"stellar_tx_id": stellar_tx_id, "asset_code": asset_code, "dest": dest_phone},
        )
        _append_step_and_update(
            transfer_id,
            step,
            settlement_status="settlement_pending",
            settlement_reference=stellar_tx_id or None,
        )
    except Exception as exc:
        step = _build_step(
            "stellar_withdrawal_failed",
            "error",
            {"error": str(exc), "asset_code": asset_code},
        )
        _append_step_and_update(transfer_id, step, settlement_status="settlement_blocked")


# ---------------------------------------------------------------------------
# Stellar event processing
# ---------------------------------------------------------------------------


def _process_stellar_event(event_id: str, payload: dict[str, Any]) -> None:
    tx = payload.get("transaction") or payload
    stellar_id: str = tx.get("id", "")
    stellar_status: str = tx.get("status", "")

    if not stellar_id:
        _mark_webhook_processed(event_id, "missing transaction id")
        return

    transfer = _get_transfer_by_settlement_ref(stellar_id)
    if not transfer:
        _mark_webhook_processed(event_id, f"no transfer for stellar_id={stellar_id}")
        return

    transfer_id: str = transfer["id"]

    if stellar_status == "completed":
        step = _build_step(
            "stellar_settlement_completed",
            "ok",
            {"stellar_tx_id": stellar_id, "external_transaction_id": tx.get("external_transaction_id")},
        )
        _append_step_and_update(
            transfer_id,
            step,
            settlement_status="settled",
            status="completed",
        )
    elif stellar_status in ("error", "expired", "refunded"):
        step = _build_step(
            "stellar_settlement_failed",
            "error",
            {"stellar_tx_id": stellar_id, "status": stellar_status, "message": tx.get("message")},
        )
        _append_step_and_update(
            transfer_id,
            step,
            settlement_status="settlement_failed",
            status="settlement_failed",
        )
    elif stellar_status == "pending_external":
        step = _build_step(
            "stellar_settlement_pending_external",
            "ok",
            {"stellar_tx_id": stellar_id},
        )
        _append_step_and_update(transfer_id, step, settlement_status="settlement_processing")

    _mark_webhook_processed(event_id)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/hyperswitch")
async def hyperswitch_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    event_id, _ = _store_event("hyperswitch", payload)

    # Hyperswitch wraps events in a content envelope
    content = payload.get("content", {})
    event_type: str = content.get("type", payload.get("type", "unknown"))
    obj: dict[str, Any] = content.get("object", payload)

    await _process_hyperswitch_event(event_id, event_type, obj)
    return {"status": "accepted", "event_id": event_id, "event_type": event_type}


@router.post("/stellar")
async def stellar_webhook(payload: dict[str, Any]) -> dict[str, Any]:
    event_id, _ = _store_event("stellar", payload)
    _process_stellar_event(event_id, payload)
    return {"status": "accepted", "event_id": event_id}
