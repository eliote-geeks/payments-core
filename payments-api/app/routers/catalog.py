
from fastapi import APIRouter

from app.services.catalog import list_countries, list_payment_methods

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/countries")
async def countries() -> dict:
    return {"countries": list_countries()}


@router.get("/payment-methods")
async def payment_methods() -> dict:
    return {"payment_methods": list_payment_methods()}
