from __future__ import annotations

from typing import Any

import httpx

from app.core.config import settings


async def initiate_withdrawal(
    *,
    asset_code: str,
    amount: str,
    dest: str,
    dest_extra: str = "",
    transfer_id: str = "",
) -> dict[str, Any]:
    """Initiate a SEP-6 withdrawal — the anchor sends XAF to mobile money."""
    params: dict[str, str] = {
        "asset_code": asset_code,
        "amount": amount,
        "type": "mobile_money",
        "dest": dest,
    }
    if dest_extra:
        params["dest_extra"] = dest_extra
    if transfer_id:
        params["refund_memo"] = transfer_id
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        resp = await client.get(
            f"{settings.stellar_sep_base_url}/sep6/withdraw",
            params=params,
        )
        resp.raise_for_status()
    return resp.json()


async def get_transaction(stellar_tx_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        resp = await client.get(
            f"{settings.stellar_sep_base_url}/sep6/transaction",
            params={"id": stellar_tx_id},
        )
        resp.raise_for_status()
    return resp.json()
