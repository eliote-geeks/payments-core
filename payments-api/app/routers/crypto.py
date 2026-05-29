from __future__ import annotations

import uuid
from contextlib import closing
from decimal import Decimal, ROUND_UP
from typing import Any

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.security import AuthUser, require_user
from app.core.time import utcnow
from app.db.session import get_conn
from app.services.wallets import append_transaction

router = APIRouter(prefix="/crypto", tags=["crypto"])

# ── Config ────────────────────────────────────────────────────────────────────
XAF_PER_USDT = Decimal("550")

EXPLORERS = {
    "TRC20": "https://tronscan.org/#/transaction/",
    "BEP20": "https://bscscan.com/tx/",
    "ERC20": "https://etherscan.io/tx/",
}


def get_wallet(network: str):
    """Retourne le wallet actif pour un réseau donné depuis la DB."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM crypto_wallets WHERE network = %s AND active = TRUE",
            (network.upper(),),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=400, detail=f"Réseau {network} non supporté ou non configuré")
    return row


def get_active_wallets():
    """Retourne tous les wallets actifs."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM crypto_wallets WHERE active = TRUE ORDER BY network")
        return cur.fetchall() or []


def xaf_to_usdt(amount_xaf: Decimal) -> Decimal:
    return (amount_xaf / XAF_PER_USDT).quantize(Decimal("0.01"), rounding=ROUND_UP)


# ── Schemas ───────────────────────────────────────────────────────────────────

class DepositInitRequest(BaseModel):
    amount_xaf: Decimal = Field(gt=0, description="Montant à créditer en XAF")
    network: str | None = Field(default="TRC20", max_length=16)
    note: str | None = Field(default=None, max_length=240)


class SubmitHashRequest(BaseModel):
    tx_hash: str = Field(min_length=10, max_length=128)


# ── Endpoints utilisateur ─────────────────────────────────────────────────────

@router.post("/deposit/init")
async def init_deposit(
    req: DepositInitRequest,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    """Initie un dépôt crypto manuel. Retourne l'adresse et le montant USDT à envoyer."""
    network = (req.network or "TRC20").upper()
    wallet = get_wallet(network)
    amount_usdt = xaf_to_usdt(req.amount_xaf)
    deposit_id = f"cdep_{uuid.uuid4().hex[:16]}"

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crypto_deposits
              (id, user_id, amount_xaf, amount_usdt, network, wallet_address, status, note, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,'pending',%s,%s,%s)
            """,
            (
                deposit_id, user.id, req.amount_xaf, amount_usdt,
                network, wallet["address"], req.note or "", utcnow(), utcnow(),
            ),
        )
        conn.commit()

    return {
        "deposit_id": deposit_id,
        "status": "pending",
        "wallet_address": wallet["address"],
        "network": network,
        "network_label": wallet.get("label") or network,
        "amount_usdt": float(amount_usdt),
        "amount_xaf": float(req.amount_xaf),
        "rate": float(XAF_PER_USDT),
        "instructions": (
            f"Envoie exactement {amount_usdt} USDT (réseau {network}) "
            f"à l'adresse {wallet['address']}, puis soumets le hash de ta transaction."
        ),
        "explorer": wallet.get("explorer_url_prefix") or EXPLORERS.get(network, ""),
    }


@router.post("/deposit/{deposit_id}/hash")
async def submit_hash(
    deposit_id: str,
    req: SubmitHashRequest,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    """L'utilisateur soumet le hash de sa transaction après envoi."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM crypto_deposits WHERE id = %s AND user_id = %s",
            (deposit_id, user.id),
        )
        dep = cur.fetchone()
        if not dep:
            raise HTTPException(status_code=404, detail="Dépôt introuvable")
        if dep["status"] != "pending":
            raise HTTPException(
                status_code=409,
                detail=f"Ce dépôt est déjà en statut '{dep['status']}'",
            )
        # Vérifier qu'un hash n'est pas déjà utilisé
        cur.execute(
            "SELECT id FROM crypto_deposits WHERE tx_hash = %s AND id != %s",
            (req.tx_hash, deposit_id),
        )
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="Ce hash est déjà utilisé pour un autre dépôt")

        cur.execute(
            """
            UPDATE crypto_deposits
            SET tx_hash = %s, status = 'submitted', updated_at = %s
            WHERE id = %s
            """,
            (req.tx_hash, utcnow(), deposit_id),
        )
        conn.commit()

    network = dep["network"]
    explorer_url = EXPLORERS.get(network, "") + req.tx_hash

    return {
        "deposit_id": deposit_id,
        "status": "submitted",
        "tx_hash": req.tx_hash,
        "explorer_url": explorer_url,
        "message": "Transaction soumise. Un admin va vérifier et créditer ton compte sous peu.",
    }


@router.get("/deposit/{deposit_id}")
async def get_deposit(
    deposit_id: str,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    """Vérifie le statut d'un dépôt crypto."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM crypto_deposits WHERE id = %s AND user_id = %s",
            (deposit_id, user.id),
        )
        dep = cur.fetchone()
    if not dep:
        raise HTTPException(status_code=404, detail="Dépôt introuvable")

    network = dep["network"]
    tx_hash = dep.get("tx_hash") or ""
    return {
        "deposit_id": dep["id"],
        "status": dep["status"],
        "amount_usdt": float(dep["amount_usdt"]),
        "amount_xaf": float(dep["amount_xaf"]),
        "network": network,
        "wallet_address": dep["wallet_address"],
        "tx_hash": tx_hash,
        "explorer_url": (EXPLORERS.get(network, "") + tx_hash) if tx_hash else None,
        "note": dep.get("note") or "",
        "created_at": dep["created_at"].isoformat(),
        "updated_at": dep["updated_at"].isoformat(),
        "reject_reason": dep.get("reject_reason") or None,
    }


@router.get("/deposits")
async def list_deposits(
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    """Liste tous les dépôts crypto de l'utilisateur."""
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT id, status, amount_usdt, amount_xaf, network, tx_hash, created_at, updated_at
            FROM crypto_deposits
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (user.id,),
        )
        rows = cur.fetchall() or []

    return {
        "items": [
            {
                "deposit_id": r["id"],
                "status": r["status"],
                "amount_usdt": float(r["amount_usdt"]),
                "amount_xaf": float(r["amount_xaf"]),
                "network": r["network"],
                "tx_hash": r.get("tx_hash") or None,
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }



@router.get("/wallets")
async def list_wallets() -> dict:
    """Retourne les réseaux/adresses actifs pour les dépôts."""
    wallets = get_active_wallets()
    return {
        "items": [
            {
                "network": w["network"],
                "address": w["address"],
                "label": w.get("label") or w["network"],
                "explorer_url_prefix": w.get("explorer_url_prefix") or EXPLORERS.get(w["network"], ""),
            }
            for w in wallets
        ]
    }


# ── Retrait crypto (FCFA → USDT) ──────────────────────────────────────────────

class WithdrawInitRequest(BaseModel):
    amount_xaf: Decimal = Field(gt=0, description="Montant en XAF à convertir en USDT")
    destination_address: str = Field(min_length=20, max_length=128, description="Adresse USDT de destination")
    network: str = Field(default="TRC20", description="Réseau blockchain")
    note: str | None = Field(default=None, max_length=240)


@router.post("/withdraw/init")
async def init_withdrawal(
    req: WithdrawInitRequest,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    """Initie un retrait crypto. Débite immédiatement le solde FCFA."""
    amount_usdt = xaf_to_usdt(req.amount_xaf)
    withdrawal_id = f"cwit_{uuid.uuid4().hex[:16]}"

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        # Vérifier le solde FCFA
        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA'",
            (user.id,),
        )
        row = cur.fetchone()
        balance = Decimal(str(row["balance"])) if row else Decimal("0")
        if balance < req.amount_xaf:
            raise HTTPException(status_code=400, detail=f"Solde insuffisant ({float(balance):.0f} FCFA disponible)")

        # Débiter le solde FCFA
        cur.execute(
            "UPDATE wallet_accounts SET balance = balance - %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
            (req.amount_xaf, utcnow(), user.id),
        )
        # Créer l'entrée retrait
        cur.execute(
            """INSERT INTO crypto_withdrawals
               (id, user_id, amount_xaf, amount_usdt, network, destination_address, status, note, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,'pending',%s,%s,%s)""",
            (withdrawal_id, user.id, req.amount_xaf, amount_usdt,
             req.network, req.destination_address, req.note or "", utcnow(), utcnow()),
        )
        # Enregistrer la transaction de débit
        tx_id = f"tx_{uuid.uuid4().hex[:16]}"
        cur.execute(
            """INSERT INTO wallet_transactions
               (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
               VALUES (%s,%s,'debit','crypto_withdraw','Retrait crypto USDT',%s,%s,'FCFA','pending',%s,NOW())""",
            (tx_id, user.id, req.destination_address, req.amount_xaf,
             Json({"withdrawal_id": withdrawal_id, "network": req.network, "amount_usdt": float(amount_usdt)})),
        )
        conn.commit()

    return {
        "withdrawal_id": withdrawal_id,
        "status": "pending",
        "amount_xaf": float(req.amount_xaf),
        "amount_usdt": float(amount_usdt),
        "network": req.network,
        "destination_address": req.destination_address,
        "message": "Retrait initié. Un admin va envoyer les USDT sous peu.",
    }


@router.get("/withdraw/{withdrawal_id}")
async def get_withdrawal(
    withdrawal_id: str,
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT * FROM crypto_withdrawals WHERE id = %s AND user_id = %s",
            (withdrawal_id, user.id),
        )
        w = cur.fetchone()
    if not w:
        raise HTTPException(status_code=404, detail="Retrait introuvable")
    tx_hash = w.get("tx_hash") or ""
    return {
        "withdrawal_id": w["id"],
        "status": w["status"],
        "amount_xaf": float(w["amount_xaf"]),
        "amount_usdt": float(w["amount_usdt"]),
        "network": w["network"],
        "destination_address": w["destination_address"],
        "tx_hash": tx_hash,
        "explorer_url": (EXPLORERS.get(w["network"], "") + tx_hash) if tx_hash else None,
        "reject_reason": w.get("reject_reason"),
        "created_at": w["created_at"].isoformat(),
    }


@router.get("/withdrawals")
async def list_withdrawals(
    user: AuthUser = Depends(require_user),
) -> dict[str, Any]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """SELECT id, status, amount_xaf, amount_usdt, network, destination_address, tx_hash, created_at
               FROM crypto_withdrawals WHERE user_id = %s ORDER BY created_at DESC LIMIT 50""",
            (user.id,),
        )
        rows = cur.fetchall() or []
    return {
        "items": [
            {
                "withdrawal_id": r["id"],
                "status": r["status"],
                "amount_xaf": float(r["amount_xaf"]),
                "amount_usdt": float(r["amount_usdt"]),
                "network": r["network"],
                "destination_address": r["destination_address"],
                "tx_hash": r.get("tx_hash"),
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }
