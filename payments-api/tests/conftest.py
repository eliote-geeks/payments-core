"""Shared fixtures for all test modules."""
from __future__ import annotations

import os
import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

# ── Env vars minimaux avant tout import de l'app ─────────────────────────────
os.environ.setdefault("PAYMENTS_API_DB_HOST", "localhost")
os.environ.setdefault("PAYMENTS_API_DB_NAME", "test_db")
os.environ.setdefault("PAYMENTS_API_DB_USER", "test")
os.environ.setdefault("PAYMENTS_API_DB_PASSWORD", "test")
os.environ.setdefault("JWT_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("DEV_ADMIN_TOKEN", "test-admin-token")
os.environ.setdefault("NOTCHPAY_PUBLIC_KEY", "pk.test_dummy")
os.environ.setdefault("NOTCHPAY_PRIVATE_KEY", "sk.test_dummy")
os.environ.setdefault("NOTCHPAY_HASH_KEY", "hsk.test_dummy_hash_key_for_tests")
os.environ.setdefault("OTP_DEV_MODE", "true")
os.environ.setdefault("OTP_DEV_CODE", "123456")
os.environ.setdefault("SMTP_PASSWORD", "dummy")
os.environ.setdefault("OPENROUTER_API_KEY", "dummy")


def make_jwt(user_id: str = "usr_test", phone: str = "+237600000000") -> str:
    """Crée un JWT de test valide."""
    from app.core.security import create_access_token
    return create_access_token(user_id=user_id, phone_e164=phone)


def mock_conn_ctx():
    """Retourne (mock_conn, mock_cur) simulant psycopg connection + cursor."""
    mock_cur = MagicMock()
    mock_cur.__enter__ = lambda s: s
    mock_cur.__exit__ = MagicMock(return_value=False)
    mock_cur.fetchone.return_value = None
    mock_cur.fetchall.return_value = []

    mock_conn = MagicMock()
    mock_conn.__enter__ = lambda s: s
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_conn.cursor.return_value = mock_cur
    mock_conn.commit = MagicMock()

    return mock_conn, mock_cur


@pytest.fixture()
def admin_token() -> str:
    return "test-admin-token"


@pytest.fixture()
def user_token() -> str:
    return make_jwt()


@pytest.fixture()
def app_client():
    """TestClient FastAPI avec startup events mockés (sans vraie DB)."""
    # Import the app module (registering all routes)
    import app.main as main_module

    # Disable startup handlers so TestClient doesn't call init_db
    original_startup = list(main_module.app.router.on_startup)
    main_module.app.router.on_startup = []

    try:
        with TestClient(main_module.app, raise_server_exceptions=True) as client:
            yield client
    finally:
        main_module.app.router.on_startup = original_startup
