"""Tests unitaires pour le calcul des frais."""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest

from app.services.fees import (
    calculate_fee_fcfa,
    calculate_fee_flat,
    get_fee_config,
)


# ── get_fee_config ─────────────────────────────────────────────────────────────

def test_get_fee_config_returns_default_for_p2p():
    with patch("app.services.fees._load_stored", return_value={}):
        cfg = get_fee_config("p2p_transfer")
    assert cfg["type"] == "percent"
    assert cfg["rate"] == 1.5
    assert cfg["min_fcfa"] == 100


def test_get_fee_config_db_overrides_default():
    stored = {"p2p_transfer": {"rate": 2.0, "min_fcfa": 200}}
    with patch("app.services.fees._load_stored", return_value=stored):
        cfg = get_fee_config("p2p_transfer")
    assert cfg["rate"] == 2.0
    assert cfg["min_fcfa"] == 200


def test_get_fee_config_unknown_category_returns_empty():
    with patch("app.services.fees._load_stored", return_value={}):
        cfg = get_fee_config("nonexistent_category")
    assert cfg == {}


# ── calculate_fee_fcfa ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("amount,expected_fee", [
    (Decimal("1000"),  Decimal("100")),   # 1.5% = 15 < min 100 → 100
    (Decimal("10000"), Decimal("150")),   # 1.5% = 150 >= 100 → 150
    (Decimal("50000"), Decimal("750")),   # 1.5% = 750
    (Decimal("100"),   Decimal("100")),   # 1.5% = 2 < min 100 → 100
])
def test_p2p_fee_percent_with_minimum(amount: Decimal, expected_fee: Decimal):
    with patch("app.services.fees._load_stored", return_value={}):
        fee = calculate_fee_fcfa("p2p_transfer", amount)
    assert fee == expected_fee


def test_mobile_money_deposit_fee_is_zero():
    with patch("app.services.fees._load_stored", return_value={}):
        fee = calculate_fee_fcfa("mobile_money_deposit", Decimal("50000"))
    assert fee == Decimal("0")


def test_fiat_deposit_fee_is_zero():
    with patch("app.services.fees._load_stored", return_value={}):
        fee = calculate_fee_fcfa("fiat_deposit", Decimal("100000"))
    assert fee == Decimal("0")


def test_mobile_money_withdrawal_applies_minimum():
    with patch("app.services.fees._load_stored", return_value={}):
        # 500 * 1.5% = 7.5 → arrondi 8, min=100 → 100
        fee = calculate_fee_fcfa("mobile_money_withdrawal", Decimal("500"))
    assert fee == Decimal("100")


def test_bank_withdrawal_flat_eur_returns_zero_fcfa():
    # Les frais flat en devise étrangère ne sont pas convertis ici → 0 FCFA
    with patch("app.services.fees._load_stored", return_value={}):
        fee = calculate_fee_fcfa("bank_withdrawal_eur", Decimal("1000"))
    assert fee == Decimal("0")


def test_unknown_category_returns_zero():
    with patch("app.services.fees._load_stored", return_value={}):
        fee = calculate_fee_fcfa("nonexistent", Decimal("1000"))
    assert fee == Decimal("0")


def test_zero_rate_returns_zero():
    stored = {"p2p_transfer": {"type": "percent", "rate": 0.0, "min_fcfa": 0}}
    with patch("app.services.fees._load_stored", return_value=stored):
        fee = calculate_fee_fcfa("p2p_transfer", Decimal("100000"))
    assert fee == Decimal("0")


# ── calculate_fee_flat ─────────────────────────────────────────────────────────

def test_bank_withdrawal_eur_flat_returns_5_eur():
    with patch("app.services.fees._load_stored", return_value={}):
        amount, currency = calculate_fee_flat("bank_withdrawal_eur")
    assert amount == Decimal("5")
    assert currency == "EUR"


def test_bank_withdrawal_usd_flat_returns_5_usd():
    with patch("app.services.fees._load_stored", return_value={}):
        amount, currency = calculate_fee_flat("bank_withdrawal_usd")
    assert amount == Decimal("5")
    assert currency == "USD"


def test_crypto_withdrawal_usdt_flat():
    with patch("app.services.fees._load_stored", return_value={}):
        amount, currency = calculate_fee_flat("crypto_withdrawal_usdt")
    assert amount == Decimal("1")
    assert currency == "USDT"


def test_percent_type_returns_zero_flat():
    with patch("app.services.fees._load_stored", return_value={}):
        amount, currency = calculate_fee_flat("p2p_transfer")
    assert amount == Decimal("0")
    assert currency == "FCFA"
