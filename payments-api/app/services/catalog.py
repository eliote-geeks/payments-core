
COUNTRIES = [
    {
        "code": "CM",
        "name": "Cameroon",
        "region": "Central Africa",
        "currency": "XAF",
        "payout_methods": ["mobile_money", "bank", "cash_pickup"],
        "mobile_money_providers": ["mtn_momo", "orange_money"],
    },
    {
        "code": "FR",
        "name": "France",
        "region": "Europe",
        "currency": "EUR",
        "payout_methods": ["bank", "card"],
        "mobile_money_providers": [],
    },
    {
        "code": "US",
        "name": "United States",
        "region": "North America",
        "currency": "USD",
        "payout_methods": ["bank", "card"],
        "mobile_money_providers": [],
    },
    {
        "code": "GB",
        "name": "United Kingdom",
        "region": "Europe",
        "currency": "GBP",
        "payout_methods": ["bank", "card"],
        "mobile_money_providers": [],
    },
    {
        "code": "CA",
        "name": "Canada",
        "region": "North America",
        "currency": "CAD",
        "payout_methods": ["bank", "card"],
        "mobile_money_providers": [],
    },
]


PAYMENT_METHODS = [
    {
        "code": "mobile_money",
        "label": "Mobile money",
        "direction": "payout",
        "regions": ["Central Africa", "West Africa"],
        "providers": ["mtn_momo", "orange_money"],
    },
    {
        "code": "bank",
        "label": "Bank transfer",
        "direction": "funding_and_payout",
        "regions": ["Africa", "Europe", "North America"],
        "providers": ["hyperswitch", "stellar_anchor"],
    },
    {
        "code": "card",
        "label": "Card payment",
        "direction": "funding",
        "regions": ["Europe", "North America"],
        "providers": ["hyperswitch"],
    },
    {
        "code": "cash_pickup",
        "label": "Cash pickup",
        "direction": "payout",
        "regions": ["Africa"],
        "providers": [],
    },
]


def list_countries() -> list[dict]:
    return COUNTRIES


def list_payment_methods() -> list[dict]:
    return PAYMENT_METHODS
