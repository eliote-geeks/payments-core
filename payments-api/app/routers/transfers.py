from __future__ import annotations

import uuid
from contextlib import closing
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Json

from app.core.security import AuthUser, require_user
from app.core.time import utcnow
from app.db.session import get_conn
from app.models.schemas import TransferRequest
from app.services.serializers import serialize_transfer

router = APIRouter(tags=["transfers"])

_CANCELLABLE_STATUSES = {"pending_payment", "pending_settlement"}


def _get_kobo_bank() -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'kobo_bank'")
        row = cur.fetchone()
    if row:
        return dict(row["value"])
    return {"beneficiary": "KOBO ONLINE SAS", "iban": "", "bic": "", "bank": "Afriland First Bank"}


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
async def create_transfer(
    request: TransferRequest,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM quotes WHERE id = %s", (request.quote_id,))
        quote = cur.fetchone()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote introuvable")
    if quote["expires_at"] <= utcnow():
        raise HTTPException(status_code=400, detail="Devis expiré — veuillez en créer un nouveau")

    source_currency = quote["source_currency"]
    is_xaf_source = source_currency == "XAF"
    transfer_id = f"tr_{uuid.uuid4().hex[:16]}"

    # ── XAF → EUR/USD : débit immédiat du solde FCFA ─────────────────────────
    if is_xaf_source:
        total_debit = Decimal(str(quote["source_amount"]))
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute(
                "SELECT balance FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA'",
                (user.id,),
            )
            bal_row = cur.fetchone()
            balance = Decimal(str(bal_row["balance"])) if bal_row else Decimal("0")
            if balance < total_debit:
                raise HTTPException(
                    status_code=400,
                    detail=f"Solde insuffisant ({float(balance):,.0f} FCFA disponible)",
                )
            cur.execute(
                "UPDATE wallet_accounts SET balance = balance - %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
                (total_debit, utcnow(), user.id),
            )
            conn.commit()

        payment_status = "paid"
        settlement_status = "pending_settlement"
        status = "pending_settlement"
        payment_instructions = None
        orchestration = [
            _build_step("quote_validated", "ok", {"quote_id": request.quote_id}),
            _build_step("balance_debited", "ok", {
                "amount": float(total_debit),
                "currency": "FCFA",
                "user_id": user.id,
            }),
        ]

    # ── EUR/USD/GBP → XAF : instructions de paiement bancaire ───────────────
    else:
        payment_status = "pending_payment"
        settlement_status = "pending_credit"
        status = "pending_payment"
        payment_instructions = {
            **_get_kobo_bank(),
            "amount": float(quote["source_amount"]),
            "currency": source_currency,
            "reference": transfer_id,
            "note": f"Après réception, le destinataire recevra {float(quote['target_amount']):,.0f} FCFA sur son Mobile Money ou compte bancaire sous 24h.",
        }
        orchestration = [
            _build_step("quote_validated", "ok", {"quote_id": request.quote_id}),
            _build_step("payment_instructions_sent", "ok", {"method": "bank_transfer"}),
        ]

    sender_data = {**dict(request.sender), "user_id": user.id}

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO transfers (
                id, quote_id, source_currency, target_currency,
                source_amount, target_amount, fees_amount,
                sender, recipient, funding_method,
                payment_status, settlement_status, status,
                orchestration, dependencies, user_id
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING *
            """,
            (
                transfer_id,
                request.quote_id,
                source_currency,
                quote["target_currency"],
                quote["source_amount"],
                quote["target_amount"],
                quote["fees_amount"],
                Json(sender_data),
                Json(dict(request.recipient)),
                request.funding_method,
                payment_status,
                settlement_status,
                status,
                Json(orchestration),
                Json({}),
                user.id,
            ),
        )
        row = cur.fetchone()
        conn.commit()

    result = serialize_transfer(row)
    if payment_instructions:
        result["payment_instructions"] = payment_instructions
    return result


@router.get("/transfers/{transfer_id}")
async def get_transfer(
    transfer_id: str,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return serialize_transfer(row)


@router.post("/transfers/{transfer_id}/cancel")
async def cancel_transfer(
    transfer_id: str,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id = %s AND user_id = %s", (transfer_id, user.id))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if row["status"] not in _CANCELLABLE_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Impossible d'annuler un transfert en statut '{row['status']}'",
        )

    # Rembourser si FCFA déjà débité
    if row["source_currency"] == "XAF" and row["payment_status"] == "paid":
        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE wallet_accounts SET balance = balance + %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
                (row["source_amount"], utcnow(), user.id),
            )
            conn.commit()

    step = _build_step("cancelled_by_user", "ok", {"user_id": user.id})
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        _update_transfer(conn, transfer_id, status="cancelled", payment_status="cancelled")
        _append_step(conn, transfer_id, step)
        conn.commit()
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        row = cur.fetchone()

    return serialize_transfer(row)
