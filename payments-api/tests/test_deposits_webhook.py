"""Tests d'intégration pour le webhook NotchPay et les dépôts Mobile Money."""
from __future__ import annotations

import hashlib
import hmac
import json
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from tests.conftest import mock_conn_ctx


def _make_sig(payload: bytes, key: str = "hsk.test_dummy_hash_key_for_tests") -> str:
    return hmac.new(key.encode(), payload, hashlib.sha256).hexdigest()


def _webhook_headers(payload: bytes) -> dict:
    return {
        "Content-Type": "application/json",
        "x-notch-signature": _make_sig(payload),
    }


def _pending_deposit(ref="dep_abc123", user_id="usr_001", amount="5000"):
    return {
        "id": "dep_abc123",
        "user_id": user_id,
        "reference": ref,
        "amount": Decimal(amount),
        "provider": "orange",
        "status": "pending",
        "currency": "FCFA",
    }


# ── payment.complete ───────────────────────────────────────────────────────────

def test_webhook_payment_complete_credits_user(app_client):
    dep = _pending_deposit()
    payload = json.dumps({
        "id": "whc.001",
        "event": "payment.complete",
        "data": {
            "merchant_reference": "dep_abc123",
            "trxref": "dep_abc123",
            "reference": "trx.internal",
            "status": "complete",
            "amount": 5000,
        },
    }).encode()

    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.side_effect = [dep, None]

    with patch("app.routers.deposits.get_conn", return_value=mock_conn), \
         patch("app.services.notchpay.settings") as mock_settings, \
         patch("app.routers.deposits.credit_platform_fee"), \
         patch("app.routers.deposits.create_notification"):
        mock_settings.notchpay_hash_key = "hsk.test_dummy_hash_key_for_tests"

        resp = app_client.post(
            "/deposits/webhooks/notchpay",
            content=payload,
            headers=_webhook_headers(payload),
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "credited"
    assert "net_fcfa" in data


def test_webhook_payment_failed_marks_deposit(app_client):
    dep = _pending_deposit()
    payload = json.dumps({
        "id": "whc.002",
        "event": "payment.failed",
        "data": {
            "merchant_reference": "dep_abc123",
            "trxref": "dep_abc123",
            "status": "failed",
        },
    }).encode()

    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.side_effect = [dep, None]

    with patch("app.routers.deposits.get_conn", return_value=mock_conn), \
         patch("app.services.notchpay.settings") as mock_settings:
        mock_settings.notchpay_hash_key = "hsk.test_dummy_hash_key_for_tests"

        resp = app_client.post(
            "/deposits/webhooks/notchpay",
            content=payload,
            headers=_webhook_headers(payload),
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "marked_failed"


def test_webhook_unknown_reference_returns_not_found(app_client):
    payload = json.dumps({
        "event": "payment.complete",
        "data": {"merchant_reference": "dep_unknown_999", "status": "complete"},
    }).encode()

    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = None  # deposit not found

    with patch("app.routers.deposits.get_conn", return_value=mock_conn), \
         patch("app.services.notchpay.settings") as mock_settings:
        mock_settings.notchpay_hash_key = "hsk.test_dummy_hash_key_for_tests"

        resp = app_client.post(
            "/deposits/webhooks/notchpay",
            content=payload,
            headers=_webhook_headers(payload),
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "not_found"


def test_webhook_already_processed_deposit_is_ignored(app_client):
    dep = {**_pending_deposit(), "status": "completed"}
    payload = json.dumps({
        "event": "payment.complete",
        "data": {"merchant_reference": "dep_abc123", "status": "complete"},
    }).encode()

    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = dep

    with patch("app.routers.deposits.get_conn", return_value=mock_conn), \
         patch("app.services.notchpay.settings") as mock_settings:
        mock_settings.notchpay_hash_key = "hsk.test_dummy_hash_key_for_tests"

        resp = app_client.post(
            "/deposits/webhooks/notchpay",
            content=payload,
            headers=_webhook_headers(payload),
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "already_processed"


def test_webhook_ignored_event_type_returns_ignored(app_client):
    payload = json.dumps({
        "event": "payment.created",
        "data": {"merchant_reference": "dep_abc123"},
    }).encode()

    with patch("app.services.notchpay.settings") as mock_settings:
        mock_settings.notchpay_hash_key = "hsk.test_dummy_hash_key_for_tests"

        resp = app_client.post(
            "/deposits/webhooks/notchpay",
            content=payload,
            headers=_webhook_headers(payload),
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "ignored"


def test_webhook_invalid_signature_on_payment_event_rejected(app_client):
    payload = json.dumps({
        "event": "payment.complete",
        "data": {"merchant_reference": "dep_abc123"},
    }).encode()

    with patch("app.services.notchpay.settings") as mock_settings:
        mock_settings.notchpay_hash_key = "hsk.test_dummy_hash_key_for_tests"

        resp = app_client.post(
            "/deposits/webhooks/notchpay",
            content=payload,
            headers={
                "Content-Type": "application/json",
                "x-notch-signature": "bad_sig_xxxxxxxx",
            },
        )

    assert resp.status_code == 400


def test_webhook_missing_reference_returns_no_reference(app_client):
    payload = json.dumps({
        "event": "payment.complete",
        "data": {"status": "complete"},  # pas de référence
    }).encode()

    with patch("app.services.notchpay.settings") as mock_settings:
        mock_settings.notchpay_hash_key = "hsk.test_dummy_hash_key_for_tests"

        resp = app_client.post(
            "/deposits/webhooks/notchpay",
            content=payload,
            headers=_webhook_headers(payload),
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "no_reference"


# ── Référence lookup priority (merchant_reference > trxref > reference) ────────

def test_webhook_uses_merchant_reference_over_internal_ref(app_client):
    """merchant_reference (notre dep_xxx) est préféré à reference (trx.xxx interne NotchPay)."""
    dep = _pending_deposit(ref="dep_merchant_001")
    payload = json.dumps({
        "event": "payment.failed",
        "data": {
            "merchant_reference": "dep_merchant_001",  # notre ref
            "reference": "trx.internal_notchpay_ref",  # leur ref interne
            "status": "failed",
        },
    }).encode()

    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.side_effect = [dep, None]

    with patch("app.routers.deposits.get_conn", return_value=mock_conn), \
         patch("app.services.notchpay.settings") as mock_settings:
        mock_settings.notchpay_hash_key = "hsk.test_dummy_hash_key_for_tests"

        resp = app_client.post(
            "/deposits/webhooks/notchpay",
            content=payload,
            headers=_webhook_headers(payload),
        )

    assert resp.status_code == 200
    assert resp.json()["status"] in ("marked_failed", "not_found")
    # Vérifie que le handler a bien utilisé merchant_reference pour la requête DB
    execute_calls = [str(c) for c in mock_cur.execute.call_args_list]
    assert any("dep_merchant_001" in c for c in execute_calls)


# ── Initiation dépôt Mobile Money ─────────────────────────────────────────────

def test_initiate_mobile_money_deposit_requires_auth(app_client):
    resp = app_client.post("/deposits/mobile-money/init", json={
        "amount": 1000,
        "currency": "FCFA",
        "provider": "orange",
        "phone": "+237691754257",
    })
    assert resp.status_code == 401


def test_initiate_deposit_invalid_provider_rejected(app_client, user_token):
    with patch("app.routers.deposits.get_conn") as mock_gc, \
         patch("app.core.security._touch_session", return_value=True), \
         patch("app.core.security.get_conn") as mock_sec_gc:

        mock_conn, mock_cur = mock_conn_ctx()
        mock_gc.return_value = mock_conn
        mock_sec_gc.return_value = mock_conn
        mock_cur.fetchone.return_value = {"id": "usr_test", "phone_e164": "+237600000000", "blocked": False}

        resp = app_client.post(
            "/deposits/mobile-money/init",
            json={"amount": 1000, "currency": "FCFA", "provider": "invalid", "phone": "+237691754257"},
            headers={"Authorization": f"Bearer {user_token}"},
        )

    assert resp.status_code in (400, 422)
