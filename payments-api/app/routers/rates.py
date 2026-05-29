from __future__ import annotations

from fastapi import APIRouter

from app.services.rates import list_rates

router = APIRouter(tags=["rates"])


@router.get("/rates")
async def rates() -> dict:
    return {"items": await list_rates()}

