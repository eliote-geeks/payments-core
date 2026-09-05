"""Tests d'intégration pour les endpoints admin."""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from tests.conftest import mock_conn_ctx

ADMIN_TOKEN = "test-admin-token"
WRONG_TOKEN = "wrong-token"


# ── Authentification admin ─────────────────────────────────────────────────────

def test_admin_without_token_returns_401(app_client):
    resp = app_client.get("/admin/analytics")
    assert resp.status_code == 401


def test_admin_wrong_token_returns_401(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = None  # pas de session admin correspondante

    with patch("app.routers.admin.get_conn", return_value=mock_conn):
        resp = app_client.get(
            "/admin/analytics",
            headers={"X-Admin-Token": WRONG_TOKEN},
        )
    assert resp.status_code == 401


# ── Analytics summary ──────────────────────────────────────────────────────────

def test_analytics_summary_returns_data(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    # analytics appelle fetchone plusieurs fois avec COUNT(*) as n
    mock_cur.fetchone.side_effect = [
        {"n": 42},       # total_users
        {"n": 150},      # total_p2p
        {"n": 500000},   # total_volume (SUM as n)
        {"n": 15},       # active_sessions
        {"bal": 75000},  # platform_revenue_fcfa
        {"total": 5000}, # total_fees_collected
        {"total": 500},  # fees_this_month
    ]
    mock_cur.fetchall.return_value = []

    with patch("app.routers.admin.get_conn", return_value=mock_conn):
        resp = app_client.get(
            "/admin/analytics",
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

    assert resp.status_code == 200
    assert isinstance(resp.json(), dict)


# ── Liste utilisateurs ─────────────────────────────────────────────────────────

def test_admin_users_list(app_client):
    from datetime import datetime, timezone
    users = [
        {"id": "usr_001", "phone_e164": "+237600000001", "email": "a@test.com",
         "profile": {"fullName": "Alice"}, "blocked": False, "under_review": False,
         "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc)},
    ]
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchall.return_value = users
    mock_cur.fetchone.return_value = {"n": 1}

    with patch("app.routers.admin.get_conn", return_value=mock_conn):
        resp = app_client.get(
            "/admin/users",
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

    assert resp.status_code == 200
    data = resp.json()
    # La liste est sous "items" ou "users" selon l'implémentation
    assert "items" in data or "users" in data


# ── Blocage / déblocage utilisateur ───────────────────────────────────────────

def test_admin_block_user(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.rowcount = 1

    with patch("app.routers.admin.get_conn", return_value=mock_conn):
        resp = app_client.post(
            "/admin/users/usr_001/block",
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_admin_unblock_user(app_client):
    mock_conn, mock_cur = mock_conn_ctx()

    with patch("app.routers.admin.get_conn", return_value=mock_conn):
        resp = app_client.post(
            "/admin/users/usr_001/unblock",
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

    assert resp.status_code == 200
    assert resp.json()["ok"] is True


# ── Platform withdraw ──────────────────────────────────────────────────────────

def test_platform_withdraw_success(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {"bal": Decimal("100000")}

    with patch("app.routers.admin.get_conn", return_value=mock_conn):
        resp = app_client.post(
            "/admin/platform/withdraw",
            json={
                "amount": 50000,
                "method": "mobile_money",
                "destination": "+237600000001",
                "note": "Retrait mensuel",
            },
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["amount"] == 50000.0
    assert data["new_balance"] == 50000.0
    assert "withdrawal_id" in data


def test_platform_withdraw_insufficient_balance(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchone.return_value = {"bal": Decimal("1000")}

    with patch("app.routers.admin.get_conn", return_value=mock_conn):
        resp = app_client.post(
            "/admin/platform/withdraw",
            json={
                "amount": 50000,
                "method": "mobile_money",
                "destination": "+237600000001",
            },
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

    assert resp.status_code == 400
    assert "insuffisant" in resp.json()["detail"].lower()


def test_platform_withdraw_invalid_method_rejected(app_client):
    resp = app_client.post(
        "/admin/platform/withdraw",
        json={
            "amount": 1000,
            "method": "bitcoin",  # invalide
            "destination": "addr123",
        },
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )
    assert resp.status_code == 422


def test_platform_withdraw_zero_amount_rejected(app_client):
    resp = app_client.post(
        "/admin/platform/withdraw",
        json={"amount": 0, "method": "mobile_money", "destination": "+237600000001"},
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )
    assert resp.status_code == 422


def test_platform_withdraw_without_auth_rejected(app_client):
    resp = app_client.post(
        "/admin/platform/withdraw",
        json={"amount": 1000, "method": "mobile_money", "destination": "+237600000001"},
    )
    assert resp.status_code == 401


# ── Liste des retraits plateforme ──────────────────────────────────────────────

def test_list_platform_withdrawals(app_client):
    from datetime import datetime, timezone
    rows = [
        {
            "id": "pw_001",
            "amount": Decimal("50000"),
            "method": "mobile_money",
            "destination": "+237600000001",
            "note": "Test",
            "status": "completed",
            "created_at": datetime(2026, 6, 1, tzinfo=timezone.utc),
        }
    ]
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchall.return_value = rows

    with patch("app.routers.admin.get_conn", return_value=mock_conn):
        resp = app_client.get(
            "/admin/platform/withdrawals",
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert len(data["items"]) == 1
    assert data["items"][0]["amount"] == 50000.0
    assert data["items"][0]["method"] == "mobile_money"


def test_list_platform_withdrawals_empty(app_client):
    mock_conn, mock_cur = mock_conn_ctx()
    mock_cur.fetchall.return_value = []

    with patch("app.routers.admin.get_conn", return_value=mock_conn):
        resp = app_client.get(
            "/admin/platform/withdrawals",
            headers={"X-Admin-Token": ADMIN_TOKEN},
        )

    assert resp.status_code == 200
    assert resp.json()["items"] == []
