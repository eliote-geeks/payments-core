"""Tests d'intégration pour les transferts P2P."""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest

from app.services.fraud import FraudResult
from tests.conftest import make_jwt, mock_conn_ctx


USER_A = "usr_sender_001"
USER_B = "usr_recipient_002"
TOKEN_A = make_jwt(user_id=USER_A, phone="+237600000001")


def _mock_auth(mock_cur, user_id=USER_A, phone="+237600000001"):
    """Configure le curseur pour passer la vérification JWT."""
    mock_cur.fetchone.return_value = {
        "id": user_id,
        "phone_e164": phone,
        "blocked": False,
        "revoked": False,
        "last_seen_at": None,
    }


# ── Validation d'entrée ────────────────────────────────────────────────────────

def test_p2p_requires_auth(app_client):
    resp = app_client.post("/p2p/transfer", json={
        "to_identifier": "+237600000002",
        "amount": 1000,
    })
    assert resp.status_code == 401


def test_p2p_amount_below_minimum_rejected(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {
        "id": USER_A, "phone_e164": "+237600000001",
        "blocked": False, "revoked": False, "last_seen_at": None,
    }

    with patch("app.core.security.get_conn", return_value=mock_conn), \
         patch("app.core.security._touch_session", return_value=True):
        resp = app_client.post(
            "/p2p/transfer",
            json={"to_identifier": "+237600000002", "amount": 50},  # < 100 FCFA min
            headers={"Authorization": f"Bearer {TOKEN_A}"},
        )
    assert resp.status_code == 400
    assert "100" in resp.json()["detail"]


def test_p2p_transfer_to_self_rejected(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {
        "id": USER_A, "phone_e164": "+237600000001",
        "blocked": False, "revoked": False, "last_seen_at": None,
    }

    recipient_row = {"id": USER_A, "phone": "+237600000001", "email": None, "username": None, "fullName": "Me"}

    with patch("app.core.security.get_conn", return_value=mock_conn), \
         patch("app.core.security._touch_session", return_value=True), \
         patch("app.routers.p2p.lookup_user", return_value=recipient_row):
        resp = app_client.post(
            "/p2p/transfer",
            json={"to_identifier": "+237600000001", "amount": 1000},
            headers={"Authorization": f"Bearer {TOKEN_A}"},
        )
    assert resp.status_code == 400
    assert "vous-même" in resp.json()["detail"].lower()


def test_p2p_unknown_recipient_returns_404(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {
        "id": USER_A, "phone_e164": "+237600000001",
        "blocked": False, "revoked": False, "last_seen_at": None,
    }

    with patch("app.core.security.get_conn", return_value=mock_conn), \
         patch("app.core.security._touch_session", return_value=True), \
         patch("app.routers.p2p.lookup_user", return_value=None):
        resp = app_client.post(
            "/p2p/transfer",
            json={"to_identifier": "+237699999999", "amount": 1000},
            headers={"Authorization": f"Bearer {TOKEN_A}"},
        )
    assert resp.status_code == 404


# ── Blocage fraude ─────────────────────────────────────────────────────────────

def test_p2p_blocked_by_fraud_returns_403(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {
        "id": USER_A, "phone_e164": "+237600000001",
        "blocked": False, "revoked": False, "last_seen_at": None,
    }
    recipient_row = {"id": USER_B, "phone": "+237600000002", "email": None, "username": None, "fullName": "Bob"}
    fraud_block = FraudResult("block", 90, ["daily_limit_exceeded"], "Transaction bloquée pour risque élevé")

    with patch("app.core.security.get_conn", return_value=mock_conn), \
         patch("app.core.security._touch_session", return_value=True), \
         patch("app.routers.p2p.lookup_user", return_value=recipient_row), \
         patch("app.routers.p2p.check_p2p_transfer", return_value=fraud_block):
        resp = app_client.post(
            "/p2p/transfer",
            json={"to_identifier": "+237600000002", "amount": 5000},
            headers={"Authorization": f"Bearer {TOKEN_A}"},
        )
    assert resp.status_code == 403
    assert "bloquée" in resp.json()["detail"].lower()


def test_p2p_fraud_warn_still_allows_transfer(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {
        "id": USER_A, "phone_e164": "+237600000001",
        "blocked": False, "revoked": False, "last_seen_at": None,
    }
    recipient_row = {"id": USER_B, "phone": "+237600000002", "email": None, "username": None, "fullName": "Bob"}
    fraud_warn = FraudResult("warn", 50, ["daily_limit_near_80pct"])
    transfer_result = {
        "id": "p2p_001",
        "sender": {"id": USER_A},
        "recipient": {"id": USER_B},
        "amount": 5000,
        "fee": 100,
        "net": 4900,
    }

    with patch("app.core.security.get_conn", return_value=mock_conn), \
         patch("app.core.security._touch_session", return_value=True), \
         patch("app.routers.p2p.lookup_user", return_value=recipient_row), \
         patch("app.routers.p2p.check_p2p_transfer", return_value=fraud_warn), \
         patch("app.routers.p2p.p2p_transfer_fcfa", return_value=transfer_result), \
         patch("app.routers.p2p.create_notification"):
        resp = app_client.post(
            "/p2p/transfer",
            json={"to_identifier": "+237600000002", "amount": 5000},
            headers={"Authorization": f"Bearer {TOKEN_A}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["fraud_warning"] is not None  # warning inclus dans la réponse


# ── Transfert réussi ───────────────────────────────────────────────────────────

def test_p2p_successful_transfer(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {
        "id": USER_A, "phone_e164": "+237600000001",
        "blocked": False, "revoked": False, "last_seen_at": None,
    }
    recipient_row = {"id": USER_B, "phone": "+237600000002", "email": None, "username": None, "fullName": "Bob"}
    fraud_ok = FraudResult("approve", 5, [])
    transfer_result = {
        "id": "p2p_ok_001",
        "sender": {"id": USER_A},
        "recipient": {"id": USER_B},
        "amount": 10000,
        "fee": 150,
        "net": 9850,
    }

    with patch("app.core.security.get_conn", return_value=mock_conn), \
         patch("app.core.security._touch_session", return_value=True), \
         patch("app.routers.p2p.lookup_user", return_value=recipient_row), \
         patch("app.routers.p2p.check_p2p_transfer", return_value=fraud_ok), \
         patch("app.routers.p2p.p2p_transfer_fcfa", return_value=transfer_result), \
         patch("app.routers.p2p.create_notification"):
        resp = app_client.post(
            "/p2p/transfer",
            json={"to_identifier": "+237600000002", "amount": 10000, "note": "remboursement"},
            headers={"Authorization": f"Bearer {TOKEN_A}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["fraud_warning"] is None  # pas de warning pour approve


# ── Idempotency ────────────────────────────────────────────────────────────────

def test_p2p_idempotent_request_returns_same_result(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {
        "id": USER_A, "phone_e164": "+237600000001",
        "blocked": False, "revoked": False, "last_seen_at": None,
    }
    recipient_row = {"id": USER_B, "phone": "+237600000002", "email": None, "username": None, "fullName": "Bob"}
    fraud_ok = FraudResult("approve", 5, [])
    transfer_result = {"id": "p2p_idem_001", "recipient": {"id": USER_B}}

    cached_resp = {"ok": True, "transfer": transfer_result, "fraud_warning": None}

    with patch("app.core.security.get_conn", return_value=mock_conn), \
         patch("app.core.security._touch_session", return_value=True), \
         patch("app.routers.p2p.lookup_user", return_value=recipient_row), \
         patch("app.routers.p2p.check_p2p_transfer", return_value=fraud_ok), \
         patch("app.routers.p2p.get_cached_response") as mock_cache, \
         patch("app.routers.p2p.store_response"):
        # Simule un hit de cache idempotency
        mock_cache_result = type("CachedResp", (), {"status_code": 200, "body": cached_resp})()
        mock_cache.return_value = mock_cache_result

        resp = app_client.post(
            "/p2p/transfer",
            json={"to_identifier": "+237600000002", "amount": 5000},
            headers={
                "Authorization": f"Bearer {TOKEN_A}",
                "Idempotency-Key": "idem-key-12345",
            },
        )

    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── Lookup utilisateur ─────────────────────────────────────────────────────────

def test_p2p_lookup_found(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {
        "id": USER_A, "phone_e164": "+237600000001",
        "blocked": False, "revoked": False, "last_seen_at": None,
    }
    found_user = {"id": USER_B, "phone": "+237600000002", "email": None, "username": "bob", "fullName": "Bob Dupont"}

    with patch("app.core.security.get_conn", return_value=mock_conn), \
         patch("app.core.security._touch_session", return_value=True), \
         patch("app.routers.p2p.lookup_user", return_value=found_user):
        resp = app_client.get(
            "/p2p/lookup?identifier=bob",
            headers={"Authorization": f"Bearer {TOKEN_A}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["found"] is True
    assert data["user"]["fullName"] == "Bob Dupont"


def test_p2p_lookup_not_found(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {
        "id": USER_A, "phone_e164": "+237600000001",
        "blocked": False, "revoked": False, "last_seen_at": None,
    }

    with patch("app.core.security.get_conn", return_value=mock_conn), \
         patch("app.core.security._touch_session", return_value=True), \
         patch("app.routers.p2p.lookup_user", return_value=None):
        resp = app_client.get(
            "/p2p/lookup?identifier=unknown",
            headers={"Authorization": f"Bearer {TOKEN_A}"},
        )

    assert resp.status_code == 200
    assert resp.json()["found"] is False
