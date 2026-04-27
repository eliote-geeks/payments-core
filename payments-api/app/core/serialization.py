
from datetime import datetime
from decimal import Decimal
from typing import Any


def json_ready(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: json_ready(inner) for key, inner in value.items()}
    if isinstance(value, list):
        return [json_ready(inner) for inner in value]
    return value
