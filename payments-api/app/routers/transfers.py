import uuid
from contextlib import closing

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Json

from app.core.security import AuthUser, require_user
from app.core.time import utcnow
from app.db.session import get_conn
from app.models.schemas import TransferRequest
from app.services.dependencies import payment_stack_dependencies
from app.services.email import notify_admin
from app.services.notifications import create_notification
from app.services.serializers import serialize_transfer
from app.services.compliance import enforce_compliance

router = APIRouter(tags=["transfers"])


def build_step(name: str, status: str, detail: dict) -> dict:
    return {
        "step": name,
        "status": status,
        "timestamp": utcnow().isoformat(),
        "detail": detail,
    }


@router.post("/transfers")
async def create_transfer(
    request: TransferRequest,
    user: AuthUser = Depends(require_user),
) -> dict:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM quotes WHERE id = %s", (request.quote_id,))
        quote = cur.fetchone()
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    if quote["expires_at"] <= utcnow():
        raise HTTPException(status_code=400, detail="Quote expired")
    compliance_amount_fcfa = quote["target_amount"] if quote["target_currency"] in ("XAF", "FCFA") else quote["source_amount"]
    enforce_compliance(user_id=user.id, amount_fcfa=compliance_amount_fcfa, flow="intl", allow_manual_review=True)
    enforce_compliance(
        user_id=user.id,
        amount_fcfa=compliance_amount_fcfa,
        flow="intl",
        allow_manual_review=True,
        country_override=quote["destination_country"],
    )

    dependencies = await payment_stack_dependencies()

    transfer_id = f"tr_{uuid.uuid4().hex[:16]}"
    funding_reference = f"fund_{uuid.uuid4().hex[:12]}"
    settlement_reference = f"stl_{uuid.uuid4().hex[:12]}"

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
        build_step(
            "funding_intent_prepared",
            "ok",
            {
                "reference": funding_reference,
                "funding_method": request.funding_method,
            },
        ),
        build_step(
            "settlement_intent_prepared",
            "ok",
            {
                "reference": settlement_reference,
                "rail": "stellar",
                "target_currency": quote["target_currency"],
            },
        ),
    ]

    # All intl transfers start pending_payment — admin confirms receipt
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO transfers (
                id, quote_id, user_id, source_currency, target_currency, source_amount, target_amount,
                fees_amount, sender, recipient, funding_method, payment_status,
                settlement_status, status, orchestration, dependencies,
                funding_reference, settlement_reference
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                transfer_id,
                request.quote_id,
                user.id,
                quote["source_currency"],
                quote["target_currency"],
                quote["source_amount"],
                quote["target_amount"],
                quote["fees_amount"],
                Json({**request.sender, "user_id": user.id}),
                Json(request.recipient),
                request.funding_method,
                "pending_payment",
                "pending_settlement",
                "pending_payment",
                Json(orchestration),
                Json(dependencies),
                funding_reference,
                settlement_reference,
            ),
        )
        row = cur.fetchone()
        conn.commit()

    src_amount = float(quote["source_amount"])
    tgt_amount = float(quote["target_amount"])
    src_cur = quote["source_currency"]
    tgt_cur = quote["target_currency"]
    recipient_name = (request.recipient or {}).get("name", "—")
    recipient_phone = (request.recipient or {}).get("phone", "—")
    method_label = "USDT (TRC-20)" if request.funding_method == "usdt" else "Virement bancaire"

    # Notification in-app utilisateur
    try:
        create_notification(
            user_id=user.id,
            notif_type="intl_transfer_created",
            title="Transfert international initié",
            body=(
                f"Votre transfert de {src_amount:,.2f} {src_cur} vers {recipient_name} "
                f"({tgt_amount:,.0f} {tgt_cur}) a bien été enregistré. "
                f"Envoyez votre paiement via {method_label} pour finaliser."
            ),
            metadata={"transfer_id": transfer_id},
        )
    except Exception:
        pass

    # Email admin
    try:
        notify_admin(
            f"Nouveau transfert international — {src_amount:,.2f} {src_cur} → {tgt_amount:,.0f} {tgt_cur}",
            f"<b>Référence :</b> {transfer_id}<br>"
            f"<b>Utilisateur :</b> {user.id}<br>"
            f"<b>Expéditeur :</b> {(request.sender or {}).get('name', '—')} — {(request.sender or {}).get('phone', '—')}<br>"
            f"<b>Destinataire :</b> {recipient_name} — {recipient_phone}<br>"
            f"<b>Montant :</b> {src_amount:,.2f} {src_cur} → {tgt_amount:,.0f} {tgt_cur}<br>"
            f"<b>Frais :</b> {float(quote['fees_amount']):,.2f} {src_cur}<br>"
            f"<b>Méthode de paiement :</b> {method_label}<br><br>"
            f"<b>Action requise :</b> Vérifiez la réception du paiement et confirmez dans le panel admin.",
        )
    except Exception:
        pass

    return serialize_transfer(row)


@router.get("/transfers/me/pending")
async def get_my_pending_transfer(
    user: AuthUser = Depends(require_user),
) -> dict:
    """Retourne le dernier transfert international non finalisé de l'utilisateur (s'il existe)."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT * FROM transfers
               WHERE user_id = %s
                 AND status NOT IN ('completed', 'failed', 'cancelled', 'rejected')
               ORDER BY created_at DESC LIMIT 1""",
            (user.id,),
        )
        row = cur.fetchone()
    return {"pending": serialize_transfer(row) if row else None}


@router.get("/transfers/{transfer_id}")
async def get_transfer(transfer_id: str) -> dict:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM transfers WHERE id = %s", (transfer_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Transfer not found")
    return serialize_transfer(row)
