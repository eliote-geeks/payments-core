from decimal import Decimal

from app.services.pricing import calculate_quote_amounts


def test_calculate_quote_amounts_applies_fixed_variable_and_min_fee() -> None:
    rule = {
        "fixed_fee": Decimal("1.20"),
        "variable_fee_bps": 120,
        "min_fee": Decimal("2.50"),
    }

    amounts = calculate_quote_amounts(Decimal("100.00"), rule, Decimal("655.957"))

    assert amounts["fees"] == Decimal("2.50")
    assert amounts["target_amount"] == Decimal("63955.807500")


def test_calculate_quote_amounts_uses_variable_fee_when_above_min() -> None:
    rule = {
        "fixed_fee": Decimal("1.20"),
        "variable_fee_bps": 120,
        "min_fee": Decimal("2.50"),
    }

    amounts = calculate_quote_amounts(Decimal("1000.00"), rule, Decimal("655.957"))

    assert amounts["fees"] == Decimal("13.20")
    assert amounts["target_amount"] == Decimal("647298.367600")
