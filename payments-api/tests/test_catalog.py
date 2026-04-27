
from app.services.catalog import list_countries, list_payment_methods


def test_cameroon_is_primary_supported_country() -> None:
    countries = {country["code"]: country for country in list_countries()}

    assert countries["CM"]["currency"] == "XAF"
    assert "mobile_money" in countries["CM"]["payout_methods"]
    assert "mtn_momo" in countries["CM"]["mobile_money_providers"]
    assert "orange_money" in countries["CM"]["mobile_money_providers"]


def test_payment_method_catalog_includes_funding_and_payout_rails() -> None:
    methods = {method["code"]: method for method in list_payment_methods()}

    assert methods["card"]["direction"] == "funding"
    assert methods["mobile_money"]["direction"] == "payout"
    assert methods["bank"]["direction"] == "funding_and_payout"
