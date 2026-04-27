
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field, field_validator


class QuoteRequest(BaseModel):
    source_currency: str = Field(min_length=3, max_length=3)
    target_currency: str = Field(min_length=3, max_length=3)
    source_amount: Decimal = Field(gt=0)
    destination_country: str = Field(min_length=2, max_length=3)
    payout_method: str = Field(min_length=3, max_length=32)

    @field_validator("source_currency", "target_currency", "destination_country")
    @classmethod
    def uppercase(cls, value: str) -> str:
        return value.upper()

    @field_validator("payout_method")
    @classmethod
    def normalize_method(cls, value: str) -> str:
        return value.lower()


class TransferRequest(BaseModel):
    quote_id: str
    sender: dict[str, Any]
    recipient: dict[str, Any]
    funding_method: str = Field(min_length=3, max_length=32)

    @field_validator("funding_method")
    @classmethod
    def normalize_method(cls, value: str) -> str:
        return value.lower()
