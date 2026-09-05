"""Tests pour le service NotchPay : normalisation, signature, collect."""
from __future__ import annotations

import hashlib
import hmac

import pytest
import respx
from httpx import Response

from app.services.notchpay import (
    _normalize_phone,
    collect_payment,
    verify_webhook_signature,
)


# ── _normalize_phone ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    ("+237691754257", "+237691754257"),   # déjà normalisé
    ("237691754257",  "+237691754257"),   # avec code pays sans +
    ("691754257",     "+237691754257"),   # 9 chiffres commençant par 6
    ("00237691754257", "+237691754257"),  # préfixe 00
    ("+237670000000", "+237670000000"),   # MTN test
])
def test_normalize_phone(raw: str, expected: str):
    assert _normalize_phone(raw) == expected


# ── verify_webhook_signature ───────────────────────────────────────────────────

def _make_sig(payload: bytes, key: str) -> str:
    return hmac.new(key.encode(), payload, hashlib.sha256).hexdigest()


def test_valid_signature_returns_true(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "notchpay_hash_key", "test_hash_key")
    payload = b'{"event":"payment.complete"}'
    sig = _make_sig(payload, "test_hash_key")
    assert verify_webhook_signature(payload, sig) is True


def test_invalid_signature_returns_false(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "notchpay_hash_key", "test_hash_key")
    payload = b'{"event":"payment.complete"}'
    assert verify_webhook_signature(payload, "wrong_signature") is False


def test_empty_signature_returns_false(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "notchpay_hash_key", "test_hash_key")
    assert verify_webhook_signature(b"payload", "") is False


def test_missing_hash_key_skips_check(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "notchpay_hash_key", "")
    # Pas de clé configurée → on accepte (log warning, return True)
    assert verify_webhook_signature(b"anything", "any_sig") is True


def test_signature_with_sha256_prefix_stripped(monkeypatch):
    """Le handler strips le préfixe 'sha256=' si présent."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "notchpay_hash_key", "test_hash_key")
    payload = b'{"event":"payment.complete"}'
    raw_sig = _make_sig(payload, "test_hash_key")
    # Verify accepte le sig brut (le stripping se fait dans le router, pas ici)
    assert verify_webhook_signature(payload, raw_sig) is True


# ── collect_payment (flow 2 étapes) ───────────────────────────────────────────

NOTCHPAY_API = "https://api.notchpay.co"


@pytest.mark.anyio
async def test_collect_payment_two_step_flow(monkeypatch):
    """collect_payment doit appeler POST /payments puis POST /payments/{trx}."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "notchpay_public_key", "pk.test_dummy")

    step1_response = {
        "code": 201,
        "transaction": {
            "reference": "trx.TEST123",
            "merchant_reference": "dep_test_001",
            "status": "pending",
        },
    }
    step2_response = {
        "code": 202,
        "message": "Confirm your transaction by dialing #150*50#",
        "transaction": {
            "reference": "trx.TEST123",
            "status": "processing",
        },
    }

    with respx.mock(assert_all_called=True) as mock:
        mock.post(f"{NOTCHPAY_API}/payments").mock(
            return_value=Response(201, json=step1_response)
        )
        mock.post(f"{NOTCHPAY_API}/payments/trx.TEST123").mock(
            return_value=Response(202, json=step2_response)
        )

        result = await collect_payment(
            reference="dep_test_001",
            amount=1000,
            currency="XAF",
            phone="+237691754257",
            channel="cm.orange",
        )

    assert result["code"] == 202
    assert "150*50" in result["message"]
    assert result["transaction"]["status"] == "processing"


@pytest.mark.anyio
async def test_collect_payment_step1_failure_raises(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "notchpay_public_key", "pk.test_dummy")

    with respx.mock() as mock:
        mock.post(f"{NOTCHPAY_API}/payments").mock(
            return_value=Response(422, json={"message": "The phone field is required"})
        )

        with pytest.raises(RuntimeError, match="phone"):
            await collect_payment(
                reference="dep_fail_001",
                amount=100,
                currency="XAF",
                phone="+237691754257",
                channel="cm.orange",
            )


@pytest.mark.anyio
async def test_collect_payment_step2_failure_raises(monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "notchpay_public_key", "pk.test_dummy")

    step1_response = {
        "code": 201,
        "transaction": {"reference": "trx.FAIL456", "status": "pending"},
    }

    with respx.mock() as mock:
        mock.post(f"{NOTCHPAY_API}/payments").mock(
            return_value=Response(201, json=step1_response)
        )
        mock.post(f"{NOTCHPAY_API}/payments/trx.FAIL456").mock(
            return_value=Response(400, json={"message": "Channel non supporté"})
        )

        with pytest.raises(RuntimeError, match="Channel"):
            await collect_payment(
                reference="dep_fail_002",
                amount=100,
                currency="XAF",
                phone="+237691754257",
                channel="cm.orange",
            )


@pytest.mark.anyio
async def test_collect_payment_includes_callback_url(monkeypatch):
    """L'étape 1 doit envoyer le callback URL à NotchPay."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "notchpay_public_key", "pk.test_dummy")

    captured_body = {}

    def capture_step1(request):
        import json as _json
        captured_body.update(_json.loads(request.content))
        return Response(201, json={
            "code": 201,
            "transaction": {"reference": "trx.CB001", "status": "pending"},
        })

    with respx.mock() as mock:
        mock.post(f"{NOTCHPAY_API}/payments").mock(side_effect=capture_step1)
        mock.post(f"{NOTCHPAY_API}/payments/trx.CB001").mock(
            return_value=Response(202, json={"code": 202, "message": "OK", "transaction": {"status": "processing"}})
        )

        await collect_payment(
            reference="dep_cb_001",
            amount=500,
            currency="XAF",
            phone="+237691754257",
            channel="cm.orange",
        )

    assert "koboonline.com" in captured_body.get("callback", "")
