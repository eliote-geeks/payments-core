from __future__ import annotations

from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_user
from app.services.idempotency import get_cached_response, store_response
from app.services.ledger import lookup_user, p2p_transfer_fcfa

router = APIRouter(prefix="/p2p", tags=["p2p"])


class P2PTransferRequest(BaseModel):
    to_phone_e164: str = Field(min_length=8, max_length=32)
    amount: Decimal = Field(gt=0)
    note: str | None = Field(default=None, max_length=240)
    pin: str | None = Field(default=None, max_length=12)  # reserved for later


@router.get("/lookup")
async def lookup(phone_e164: str = Query(min_length=8, max_length=32), user: AuthUser = Depends(require_user)) -> dict[str, Any]:
    found = lookup_user(phone_e164=phone_e164)
    return {"found": bool(found), "user": found}


@router.post("/transfer")
async def transfer(
    req: P2PTransferRequest,
    request: Request,
    user: AuthUser = Depends(require_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    body = req.model_dump()
    if idempotency_key:
        cached = get_cached_response(
            key=idempotency_key,
            user_id=user.id,
            method=request.method,
            path=str(request.url.path),
            body=body,
        )
        if cached:
            if cached.status_code != 200:
                raise HTTPException(status_code=cached.status_code, detail=cached.body.get("detail"))
            return cached.body

    try:
        out = p2p_transfer_fcfa(
            sender_user_id=user.id,
            sender_phone=user.phone_e164,
            recipient_phone_e164=req.to_phone_e164,
            amount_fcfa=req.amount,
            note=req.note or "",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    resp = {"ok": True, "transfer": out}
    if idempotency_key:
        store_response(
            key=idempotency_key,
            user_id=user.id,
            method=request.method,
            path=str(request.url.path),
            body=body,
            status_code=200,
            response_body=resp,
        )
    return resp

