import uuid
from contextlib import closing

import psycopg
from fastapi import APIRouter, HTTPException
from psycopg.types.json import Json

from app.core.time import utcnow
from app.db.session import get_conn
from app.models.schemas import TransferRequest
from app.services.dependencies import payment_stack_dependencies
from app.services.serializers import serialize_transfer

router = APIRouter(tags=["transfers"])


def build_step(name: str, status: str, detail: dict) -> dict:
    return {
        "step": name,
        "status": status,
        "timestamp": utcnow().isoformat(),
        "detail": detail,
    }


@router.post("/transfers")
async def create_transfer(request: TransferRequest) -> dict:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM quotes WHERE id = %s", (request.quote_id,))
        quote = cur.fetchone()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    if quote["expires_at"] <= utcnow():
        raise HTTPException(status_code=400, detail="Quote expired")

    dependencies = await payment_stack_dependencies()
    orchestration = [
        build_step("quote_validated", "ok", {"quote_id": request.quote_id}),
        build_step(
            "funding_stack_checked",
            "ok" if dependencies["hyperswitch"]["ok"] else "degraded",
            dependencies["hyperswitch"],
        ),
        build_step(
            "settlement_stack_checked",
            "ok" if dependencies["stellar_sep"]["ok"] else "degraded",
            dependencies["stellar_sep"],
        ),
        build_step(
            "anchor_reference_checked",
            "ok" if dependencies["anchor_ref"]["ok"] else "degraded",
            dependencies["anchor_ref"],
        ),
    ]

    transfer_id = f"tr_{uuid.uuid4().hex[:16]}"
    funding_reference = f"fund_{uuid.uuid4().hex[:12]}"
    settlement_reference = f"stl_{uuid.uuid4().hex[:12]}"
    payment_status = "funding_ready" if dependencies["hyperswitch"]["ok"] else "funding_blocked"
    settlement_status = (
        "settlement_ready" if dependencies["stellar_sep"]["ok"] else "settlement_blocked"
    )
    status = "pending_funding" if payment_status == "funding_ready" else "manual_review"
    orchestration.extend(
        [
            build_step(
                "funding_intent_prepared",
                "ok" if payment_status == "funding_ready" else "blocked",
                {
                    "reference": funding_reference,
                    "funding_method": request.funding_method,
                    "connector": "hyperswitch",
                },
            ),
            build_step(
                "settlement_intent_prepared",
                "ok" if settlement_status == "settlement_ready" else "blocked",
                {
                    "reference": settlement_reference,
                    "rail": "stellar",
                    "target_currency": quote["target_currency"],
                },
            ),
        ]
    )

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO transfers (
                id, quote_id, source_currency, target_currency, source_amount, target_amount,
                fees_amount, sender, recipient, funding_method, payment_status,
                settlement_status, status, orchestration, dependencies,
                funding_reference, settlement_reference
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                Json(dependencies),
                funding_reference,
                settlement_reference,
            ),
        )
        row = cur.fetchone()
        conn.commit()
    return serialize_transfer(row)


@router.get("/transfers/{transfer_id}")
async def get_transfer(transfer_id: str) -> dict:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return serialize_transfer(row)
