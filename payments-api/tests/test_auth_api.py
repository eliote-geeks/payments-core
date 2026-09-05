"""Tests d'intégration pour les endpoints d'authentification."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


# ── /auth/otp/start ────────────────────────────────────────────────────────────

def test_otp_start_returns_challenge_id(app_client):
    with patch("app.routers.auth.otp_service.start_challenge") as mock_start:
        mock_start.return_value = ("otp_abc123", "123456")
        resp = app_client.post("/auth/otp/start", json={"email": "test@example.com"})

    assert resp.status_code == 200
    data = resp.json()
    assert "challenge_id" in data
    assert data["challenge_id"] == "otp_abc123"
    assert data["dev_code"] == "123456"  # OTP_DEV_MODE=true


def test_otp_start_invalid_email_rejected(app_client):
    resp = app_client.post("/auth/otp/start", json={"email": "bad"})
    assert resp.status_code == 422


def test_otp_start_missing_email_rejected(app_client):
    resp = app_client.post("/auth/otp/start", json={})
    assert resp.status_code == 422


# ── /auth/otp/verify ───────────────────────────────────────────────────────────

def _make_user_row(email="test@example.com"):
    return {
        "id": "usr_abc123",
        "phone_e164": email,
        "email": email,
        "profile": {"fullName": "Test User", "kycLevel": 0},
        "blocked": False,
    }


def test_otp_verify_success_returns_verified(app_client):
    """OTP verify confirme le code. Le token est obtenu via POST /auth/login."""
    with patch("app.routers.auth.otp_service.verify_challenge", return_value="test@example.com"):
        resp = app_client.post("/auth/otp/verify", json={
            "challenge_id": "otp_abc123",
            "code": "123456",
        })

    assert resp.status_code == 200
    data = resp.json()
    # otp/verify confirme l'email et retourne verified=True (le token vient de /login)
    assert data.get("verified") is True or "email" in data


def test_otp_verify_wrong_code_returns_400(app_client):
    with patch("app.routers.auth.otp_service.verify_challenge",
               side_effect=ValueError("Invalid code")):
        resp = app_client.post("/auth/otp/verify", json={
            "challenge_id": "otp_abc123",
            "code": "999999",
        })
    assert resp.status_code == 400


def test_otp_verify_expired_challenge_returns_400(app_client):
    with patch("app.routers.auth.otp_service.verify_challenge",
               side_effect=ValueError("Challenge expired")):
        resp = app_client.post("/auth/otp/verify", json={
            "challenge_id": "otp_old",
            "code": "123456",
        })
    assert resp.status_code == 400


def test_otp_verify_missing_fields_rejected(app_client):
    resp = app_client.post("/auth/otp/verify", json={"challenge_id": "otp_abc"})
    assert resp.status_code == 422


# ── /auth/register ─────────────────────────────────────────────────────────────

def test_register_new_user(app_client):
    new_user = _make_user_row("newuser@example.com")

    with patch("app.routers.auth.get_user_by_email", return_value=None), \
         patch("app.routers.auth.create_user", return_value=new_user), \
         patch("app.routers.auth._create_session", return_value="ses_new"), \
         patch("app.routers.auth.ensure_default_wallets"):
        resp = app_client.post("/auth/register", json={
            "email": "newuser@example.com",
            "full_name": "Nouveau User",
            "dob": "1990-01-01",
            "country": "CM",
        })

    assert resp.status_code in (200, 201)
    data = resp.json()
    assert "token" in data


# ── JWT validation via endpoint protégé ───────────────────────────────────────

def test_protected_endpoint_without_token_returns_401(app_client):
    resp = app_client.get("/wallets")
    assert resp.status_code == 401


def test_protected_endpoint_with_invalid_token_returns_401(app_client):
    resp = app_client.get("/wallets", headers={"Authorization": "Bearer not.a.jwt"})
    assert resp.status_code == 401
