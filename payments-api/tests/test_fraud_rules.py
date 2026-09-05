"""Tests unitaires pour le moteur de détection de fraude P2P."""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest

from app.services.fraud import (
    FraudResult,
    _KYC_DAILY_LIMITS,
    _NEW_ACCOUNT_MAX,
    check_p2p_transfer,
)

SENDER = "usr_sender"
RECIPIENT = "usr_recipient"

# ── Helpers ────────────────────────────────────────────────────────────────────

def _patch_fraud(
    *,
    sender_blocked=False,
    recipient_blocked=False,
    sender_kyc=1,
    sender_age=30,
    recipient_age=30,
    daily_sent=Decimal("0"),
    hourly_tx=0,
    distinct_recipients=0,
    round_trip=False,
    log_ok=True,
):
    """Patch toutes les fonctions DB du module fraud."""
    patches = {
        "app.services.fraud._is_blocked": lambda uid: (sender_blocked if uid == SENDER else recipient_blocked),
        "app.services.fraud._kyc_level": lambda uid: sender_kyc,
        "app.services.fraud._account_age_days": lambda uid: (sender_age if uid == SENDER else recipient_age),
        "app.services.fraud._daily_sent": lambda uid: daily_sent,
        "app.services.fraud._hourly_tx_count": lambda uid: hourly_tx,
        "app.services.fraud._hourly_distinct_recipients": lambda uid: distinct_recipients,
        "app.services.fraud._round_trip_exists": lambda s, r, a: round_trip,
        "app.services.fraud._log_fraud_event": lambda *a, **kw: None,
        "app.services.fraud.notify_admin": lambda *a, **kw: None,
        "app.services.fraud.create_notification": lambda *a, **kw: None,
    }
    return [patch(target, side_effect=fn) for target, fn in patches.items()]


# ── Tests blocage compte ───────────────────────────────────────────────────────

def test_blocked_sender_returns_block_immediately():
    with patch("app.services.fraud._is_blocked", side_effect=lambda uid: uid == SENDER):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("1000"))
    assert result.action == "block"
    assert result.risk_score == 100
    assert "sender_blocked" in result.rules_triggered


def test_blocked_recipient_returns_block_immediately():
    with patch("app.services.fraud._is_blocked", side_effect=lambda uid: uid == RECIPIENT):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("1000"))
    assert result.action == "block"
    assert "recipient_blocked" in result.rules_triggered


# ── Tests compte nouveau ───────────────────────────────────────────────────────

def test_new_account_large_amount_adds_high_score():
    patches = _patch_fraud(sender_age=2, daily_sent=Decimal("0"))
    with patch("app.services.fraud._is_blocked", return_value=False), \
         patch("app.services.fraud._kyc_level", return_value=1), \
         patch("app.services.fraud._account_age_days", return_value=2), \
         patch("app.services.fraud._daily_sent", return_value=Decimal("0")), \
         patch("app.services.fraud._hourly_tx_count", return_value=0), \
         patch("app.services.fraud._hourly_distinct_recipients", return_value=0), \
         patch("app.services.fraud._round_trip_exists", return_value=False), \
         patch("app.services.fraud._log_fraud_event", return_value=None), \
         patch("app.services.fraud.notify_admin", return_value=None), \
         patch("app.services.fraud.create_notification", return_value=None):
        result = check_p2p_transfer(SENDER, RECIPIENT, _NEW_ACCOUNT_MAX + Decimal("1"))
    assert any("new_account_limit_exceeded" in r for r in result.rules_triggered)
    assert result.risk_score >= 60


def test_new_account_small_amount_adds_low_score():
    with patch("app.services.fraud._is_blocked", return_value=False), \
         patch("app.services.fraud._kyc_level", return_value=1), \
         patch("app.services.fraud._account_age_days", return_value=3), \
         patch("app.services.fraud._daily_sent", return_value=Decimal("0")), \
         patch("app.services.fraud._hourly_tx_count", return_value=0), \
         patch("app.services.fraud._hourly_distinct_recipients", return_value=0), \
         patch("app.services.fraud._round_trip_exists", return_value=False), \
         patch("app.services.fraud._log_fraud_event", return_value=None), \
         patch("app.services.fraud.notify_admin", return_value=None), \
         patch("app.services.fraud.create_notification", return_value=None):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("5000"))
    assert any("new_account_low_risk" in r for r in result.rules_triggered)
    assert result.risk_score < 40


# ── Tests limite journalière ───────────────────────────────────────────────────

def test_daily_limit_exceeded_adds_score():
    kyc1_limit = _KYC_DAILY_LIMITS[1]  # 500 000 FCFA
    # déjà dépensé 490 000, on tente 20 000 → dépasse
    with patch("app.services.fraud._is_blocked", return_value=False), \
         patch("app.services.fraud._kyc_level", return_value=1), \
         patch("app.services.fraud._account_age_days", return_value=60), \
         patch("app.services.fraud._daily_sent", return_value=Decimal("490000")), \
         patch("app.services.fraud._hourly_tx_count", return_value=0), \
         patch("app.services.fraud._hourly_distinct_recipients", return_value=0), \
         patch("app.services.fraud._round_trip_exists", return_value=False), \
         patch("app.services.fraud._log_fraud_event", return_value=None), \
         patch("app.services.fraud.notify_admin", return_value=None), \
         patch("app.services.fraud.create_notification", return_value=None):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("20000"))
    assert any("daily_limit_exceeded" in r for r in result.rules_triggered)


def test_daily_limit_near_80pct_warns():
    kyc1_limit = _KYC_DAILY_LIMITS[1]
    near_80 = kyc1_limit * Decimal("0.75")  # just below 80%
    with patch("app.services.fraud._is_blocked", return_value=False), \
         patch("app.services.fraud._kyc_level", return_value=1), \
         patch("app.services.fraud._account_age_days", return_value=60), \
         patch("app.services.fraud._daily_sent", return_value=near_80), \
         patch("app.services.fraud._hourly_tx_count", return_value=0), \
         patch("app.services.fraud._hourly_distinct_recipients", return_value=0), \
         patch("app.services.fraud._round_trip_exists", return_value=False), \
         patch("app.services.fraud._log_fraud_event", return_value=None), \
         patch("app.services.fraud.notify_admin", return_value=None), \
         patch("app.services.fraud.create_notification", return_value=None):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("30000"))
    assert any("daily_limit_near_80pct" in r for r in result.rules_triggered)


# ── Tests round-trip ───────────────────────────────────────────────────────────

def test_round_trip_adds_score():
    with patch("app.services.fraud._is_blocked", return_value=False), \
         patch("app.services.fraud._kyc_level", return_value=1), \
         patch("app.services.fraud._account_age_days", return_value=60), \
         patch("app.services.fraud._daily_sent", return_value=Decimal("0")), \
         patch("app.services.fraud._hourly_tx_count", return_value=0), \
         patch("app.services.fraud._hourly_distinct_recipients", return_value=0), \
         patch("app.services.fraud._round_trip_exists", return_value=True), \
         patch("app.services.fraud._log_fraud_event", return_value=None), \
         patch("app.services.fraud.notify_admin", return_value=None), \
         patch("app.services.fraud.create_notification", return_value=None):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("10000"))
    assert any("round_trip" in r for r in result.rules_triggered)
    assert result.risk_score >= 45


# ── Tests fan-out ──────────────────────────────────────────────────────────────

def test_fan_out_adds_score():
    with patch("app.services.fraud._is_blocked", return_value=False), \
         patch("app.services.fraud._kyc_level", return_value=1), \
         patch("app.services.fraud._account_age_days", return_value=60), \
         patch("app.services.fraud._daily_sent", return_value=Decimal("0")), \
         patch("app.services.fraud._hourly_tx_count", return_value=0), \
         patch("app.services.fraud._hourly_distinct_recipients", return_value=6), \
         patch("app.services.fraud._round_trip_exists", return_value=False), \
         patch("app.services.fraud._log_fraud_event", return_value=None), \
         patch("app.services.fraud.notify_admin", return_value=None), \
         patch("app.services.fraud.create_notification", return_value=None):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("5000"))
    assert any("fan_out" in r for r in result.rules_triggered)


# ── Tests no-KYC ──────────────────────────────────────────────────────────────

def test_no_kyc_large_amount_adds_score():
    with patch("app.services.fraud._is_blocked", return_value=False), \
         patch("app.services.fraud._kyc_level", return_value=0), \
         patch("app.services.fraud._account_age_days", return_value=60), \
         patch("app.services.fraud._daily_sent", return_value=Decimal("0")), \
         patch("app.services.fraud._hourly_tx_count", return_value=0), \
         patch("app.services.fraud._hourly_distinct_recipients", return_value=0), \
         patch("app.services.fraud._round_trip_exists", return_value=False), \
         patch("app.services.fraud._log_fraud_event", return_value=None), \
         patch("app.services.fraud.notify_admin", return_value=None), \
         patch("app.services.fraud.create_notification", return_value=None):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("25000"))
    assert any("no_kyc_large_amount" in r for r in result.rules_triggered)


# ── Tests approbation normale ──────────────────────────────────────────────────

def test_clean_transfer_is_approved():
    with patch("app.services.fraud._is_blocked", return_value=False), \
         patch("app.services.fraud._kyc_level", return_value=1), \
         patch("app.services.fraud._account_age_days", return_value=60), \
         patch("app.services.fraud._daily_sent", return_value=Decimal("0")), \
         patch("app.services.fraud._hourly_tx_count", return_value=0), \
         patch("app.services.fraud._hourly_distinct_recipients", return_value=0), \
         patch("app.services.fraud._round_trip_exists", return_value=False), \
         patch("app.services.fraud._log_fraud_event", return_value=None), \
         patch("app.services.fraud.notify_admin", return_value=None), \
         patch("app.services.fraud.create_notification", return_value=None):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("5000"))
    assert result.action == "approve"
    assert result.risk_score < 40


# ── Tests score capping ────────────────────────────────────────────────────────

def test_score_never_exceeds_100():
    """Plusieurs règles cumulées ne dépassent pas 100."""
    with patch("app.services.fraud._is_blocked", return_value=False), \
         patch("app.services.fraud._kyc_level", return_value=0), \
         patch("app.services.fraud._account_age_days", return_value=1), \
         patch("app.services.fraud._daily_sent", return_value=Decimal("45000")), \
         patch("app.services.fraud._hourly_tx_count", return_value=10), \
         patch("app.services.fraud._hourly_distinct_recipients", return_value=6), \
         patch("app.services.fraud._round_trip_exists", return_value=True), \
         patch("app.services.fraud._log_fraud_event", return_value=None), \
         patch("app.services.fraud.notify_admin", return_value=None), \
         patch("app.services.fraud.create_notification", return_value=None):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("40000"))
    assert result.risk_score <= 100


def test_block_sets_block_reason():
    """Un résultat block doit toujours avoir un block_reason."""
    with patch("app.services.fraud._is_blocked", side_effect=lambda uid: uid == SENDER):
        result = check_p2p_transfer(SENDER, RECIPIENT, Decimal("1000"))
    assert result.action == "block"
    assert result.block_reason is not None
    assert len(result.block_reason) > 0
