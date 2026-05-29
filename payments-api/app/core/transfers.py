from __future__ import annotations

import uuid
from contextlib import closing
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, HTTPException
from psycopg.types.json import Json

from app.core.time import utcnow
from app.db.session import get_conn
from app.models.schemas import TransferRequest
from app.services import hyperswitch, stellar_sep
from app.services.dependencies import payment_stack_dependencies
from app.services.serializers import serialize_transfer

router = APIRouter(tags=["transfers"])

_CANCELLABLE_STATUSES = {"pending_funding", "funding_pending"}


def _build_step(name: str, status: str, detail: dict[str, Any]) -> dict[str, Any]:
    return {
        "step": name,
        "status": status,
        "timestamp": utcnow().isoformat(),
        "detail": detail,
    }


def _append_step(conn: Any, transfer_id: str, step: dict[str, Any]) -> None:
    conn.cursor().execute(
        """
        UPDATE transfers
        SET orchestration = orchestration || %s::jsonb,
            updated_at    = %s
        WHERE id = %s
        """,
        (Json([step]), utcnow(), transfer_id),
    )


def _update_transfer(
    conn: Any,
    transfer_id: str,
    *,
    payment_status: str | None = None,
    settlement_status: str | None = None,
    status: str | None = None,
    funding_reference: str | None = None,
    settlement_reference: str | None = None,
) -> None:
    fields: list[str] = ["updated_at = %s"]
    values: list[Any] = [utcnow()]
    if payment_status is not None:
        fields.append("payment_status = %s")
        values.append(payment_status)
    if settlement_status is not None:
        fields.append("settlement_status = %s")
        values.append(settlement_status)
    if status is not None:
        fields.append("status = %s")
        values.append(status)
    if funding_reference is not None:
        fields.append("funding_reference = %s")
        values.append(funding_reference)
    if settlement_reference is not None:
        fields.append("settlement_reference = %s")
        values.append(settlement_reference)
    values.append(transfer_id)
    conn.cursor().execute(
        f"UPDATE transfers SET {', '.join(fields)} WHERE id = %s", values
    )


@router.post("/transfers")
async def create_transfer(request: TransferRequest) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM quotes WHERE id = %s", (request.quote_id,))
        quote = cur.fetchone()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    if quote["expires_at"] <= utcnow():
        raise HTTPException(status_code=400, detail="Quote expired")

    deps = await payment_stack_dependencies()
    hs_ok = deps["hyperswitch"]["ok"]
    sep_ok = deps["stellar_sep"]["ok"]

    orchestration: list[dict[str, Any]] = [
        _build_step("quote_validated", "ok", {"quote_id": request.quote_id}),
        _build_step(
            "funding_stack_checked",
            "ok" if hs_ok else "degraded",
            deps["hyperswitch"],
        ),
        _build_step(
            "settlement_stack_checked",
            "ok" if sep_ok else "degraded",
            deps["stellar_sep"],
        ),
    ]

    transfer_id = f"tr_{uuid.uuid4().hex[:16]}"
    payment_status = "funding_ready" if hs_ok else "funding_blocked"
    settlement_status = "settlement_ready" if sep_ok else "settlement_blocked"
    status = "pending_funding" if hs_ok else "manual_review"

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO transfers (
                id, quote_id, source_currency, target_currency,
                source_amount, target_amount, fees_amount,
                sender, recipient, funding_method,
                payment_status, settlement_status, status,
                orchestration, dependencies
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                transfer_id,
                request.quote_id,
                quote["source_currency"],
                quote["target_currency"],
                quote["source_amount"],
                quote["target_amount"],
                quote["fees_amount"],
                Json(request.sender),
                Json(request.recipient),
                request.funding_method,
                payment_status,
                settlement_status,
                status,
                Json(orchestration),
                Json(deps),
            ),
        )
        row = cur.fetchone()
        conn.commit()

    client_secret: str | None = None

    # --- Hyperswitch: create payment intent ---
    if hs_ok:
        try:
            hs = await hyperswitch.create_payment_intent(
                amount=Decimal(str(quote["source_amount"])),
                currency=quote["source_currency"],
                transfer_id=transfer_id,
            )
            payment_id: str = hs["payment_id"]
            client_secret = hs.get("client_secret")
            step = _build_step(
                "funding_intent_created",
                "ok",
                {
                    "payment_id": payment_id,
                    "connector": "hyperswitch",
                    "funding_method": request.funding_method,
                },
            )
            with closing(get_conn()) as conn:
                _update_transfer(
                    conn,
                    transfer_id,
                    payment_status="funding_pending",
                    funding_reference=payment_id,
                )
                _append_step(conn, transfer_id, step)
                conn.commit()
            row = {**row, "payment_status": "funding_pending", "funding_reference": payment_id}
        except Exception as exc:
            step = _build_step(
                "funding_intent_failed",
                "error",
                {"error": str(exc), "connector": "hyperswitch"},
            )
            with closing(get_conn()) as conn:
                _update_transfer(conn, transfer_id, payment_status="funding_blocked")
                _append_step(conn, transfer_id, step)
                conn.commit()
            row = {**row, "payment_status": "funding_blocked"}
    else:
        step = _build_step(
            "funding_intent_skipped",
            "blocked",
            {"reason": "hyperswitch_unavailable", "funding_method": request.funding_method},
        )
        with closing(get_conn()) as conn:
            _append_step(conn, transfer_id, step)
            conn.commit()

    result = serialize_transfer(row)
    if client_secret:
        result["client_secret"] = client_secret
    return result


@router.get("/transfers/{transfer_id}")
async def get_transfer(transfer_id: str) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return serialize_transfer(row)


@router.post("/transfers/{transfer_id}/cancel")
async def cancel_transfer(transfer_id: str) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if row["status"] not in _CANCELLABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot cancel transfer in status '{row['status']}'",
        )

    step = _build_step("cancellation_requested", "ok", {"by": "client"})
    hs_step: dict[str, Any] | None = None

    if row.get("funding_reference"):
        try:
            await hyperswitch.cancel_payment(row["funding_reference"])
            hs_step = _build_step(
                "hyperswitch_payment_cancelled",
                "ok",
                {"payment_id": row["funding_reference"]},
            )
        except Exception as exc:
            hs_step = _build_step(
                "hyperswitch_cancel_failed",
                "error",
                {"payment_id": row["funding_reference"], "error": str(exc)},
            )

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        _update_transfer(conn, transfer_id, status="cancelled", payment_status="cancelled")
        _append_step(conn, transfer_id, step)
        if hs_step:
            _append_step(conn, transfer_id, hs_step)
        conn.commit()
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        row = cur.fetchone()

    return serialize_transfer(row)
