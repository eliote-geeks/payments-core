
def serialize_quote(row: dict) -> dict:
    return {
        "quote_id": row["id"],
        "source_currency": row["source_currency"],
        "target_currency": row["target_currency"],
        "source_amount": float(row["source_amount"]),
        "fees": float(row["fees_amount"]),
        "fx_rate": float(row["fx_rate"]),
        "target_amount": float(row["target_amount"]),
        "destination_country": row["destination_country"],
        "payout_method": row["payout_method"],
        "pricing_provider": row["pricing_provider"],
        "pricing_timestamp": row["pricing_timestamp"].isoformat(),
        "expires_at": row["expires_at"].isoformat(),
        "metadata": row["metadata"],
    }


def serialize_transfer(row: dict) -> dict:
    return {
        "transfer_id": row["id"],
        "quote_id": row["quote_id"],
        "source_currency": row["source_currency"],
        "target_currency": row["target_currency"],
        "source_amount": float(row["source_amount"]),
        "target_amount": float(row["target_amount"]),
        "fees_amount": float(row["fees_amount"]),
        "funding_method": row["funding_method"],
        "payment_status": row["payment_status"],
        "settlement_status": row["settlement_status"],
        "status": row["status"],
        "orchestration": row["orchestration"],
        "dependencies": row["dependencies"],
        "funding_reference": row["funding_reference"],
        "settlement_reference": row["settlement_reference"],
        "sender": row["sender"],
        "recipient": row["recipient"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }
