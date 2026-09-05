from __future__ import annotations

import hashlib
import hmac
import logging
import re

import httpx

from app.core.config import settings

log = logging.getLogger("sharepay")

SHAREPAY_API = "https://sharepay-api.te-sea.com"

PROVIDER_MAP = {
    "mtn":    "MTN_MOMO_CM",
    "orange": "ORANGE_MONEY_CM",
}


def _normalize_phone(phone: str) -> str:
    """Normalise vers 237XXXXXXXXX (format SharePay, sans +)."""
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("237") and len(digits) == 12:
        return digits
    if len(digits) == 9 and digits[0] in "6":
        return f"237{digits}"
    if digits.startswith("00237") and len(digits) == 14:
        return digits[2:]
    return digits


def _headers() -> dict:
    return {
        "Content-Type": "application/json",
        "X-API-KEY": settings.sharepay_api_key,
    }


SHAREPAY_WEBHOOK_URL = "https://pay-api.koboonline.com/deposits/webhooks/sharepay"
SHAREPAY_REDIRECT_URL = "https://pay-api.koboonline.com/deposits/webhooks/sharepay"


async def create_checkout(
    *,
    reference: str,
    amount: int,
    description: str = "Dépôt Kobo",
    success_url: str = "https://pay-api.koboonline.com/deposits/webhooks/sharepay",
    cancel_url: str = "https://koboonline.com/fiat-deposit?status=cancelled",
) -> dict:
    """Crée une session de paiement et retourne paymentUrl."""
    payload = {
        "amount": amount,
        "currency": "XAF",
        "merchantReference": reference,
        "description": description,
        "successUrl": success_url,
        "returnUrl": success_url,
        "cancelUrl": cancel_url,
        # Plusieurs variantes sont envoyées car SharePay a changé le nom du
        # champ callback selon les écrans checkout/API.
        "callbackUrl": SHAREPAY_WEBHOOK_URL,
        "notifyUrl": SHAREPAY_WEBHOOK_URL,
        "webhookUrl": SHAREPAY_WEBHOOK_URL,
    }
    log.info("SharePay checkout amount=%s ref=%s", amount, reference)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{SHAREPAY_API}/api/v1/pay-in/checkout",
            json=payload,
            headers=_headers(),
        )
    data = resp.json()
    log.info("SharePay checkout HTTP %s keys=%s", resp.status_code, sorted(data.keys()))
    if not data.get("success"):
        msg = data.get("message") or data.get("code") or f"HTTP {resp.status_code}"
        raise RuntimeError(f"SharePay checkout: {msg}")
    return data.get("data") or {}


async def get_payment_status(reference: str) -> dict:
    """Interroge SharePay pour connaître le statut d'un pay-in par référence SharePay PI-*."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{SHAREPAY_API}/api/v1/pay-in/check_status/{reference}",
            headers=_headers(),
        )
    data = resp.json()
    log.info("SharePay pay-in status ref=%s HTTP %s keys=%s", reference, resp.status_code, sorted(data.keys()))
    return data.get("data") or data


async def get_payout_status(reference: str) -> dict:
    """Interroge SharePay pour connaître le statut d'un pay-out par référence SharePay PO-*."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            f"{SHAREPAY_API}/api/v1/pay-out/check_status/{reference}",
            headers=_headers(),
        )
    data = resp.json()
    log.info("SharePay payout status ref=%s HTTP %s keys=%s", reference, resp.status_code, sorted(data.keys()))
    return data.get("data") or data


async def create_charge(
    *,
    reference: str,
    amount: int,
    provider: str,
    phone: str,
    payer_name: str = "",
) -> dict:
    """Charge directe USSD (1 étape, avec idempotencyKey)."""
    payment_method = PROVIDER_MAP.get(provider.lower())
    if not payment_method:
        raise ValueError(f"Provider non supporté: {provider}")

    normalized_phone = _normalize_phone(phone)
    payload: dict = {
        "amount": amount,
        "currency": "XAF",
        "paymentMethod": payment_method,
        "payerAccount": normalized_phone,
        "merchantReference": reference,
        "idempotencyKey": reference,
    }
    if payer_name:
        payload["payerName"] = payer_name
    log.info("SharePay charge amount=%s provider=%s ref=%s", amount, provider, reference)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{SHAREPAY_API}/api/v1/pay-in/charge",
            json=payload,
            headers=_headers(),
        )
    data = resp.json()
    log.info("SharePay charge HTTP %s keys=%s", resp.status_code, sorted(data.keys()))
    if not data.get("success"):
        msg = data.get("message") or data.get("code") or f"HTTP {resp.status_code}"
        raise RuntimeError(f"SharePay charge: {msg}")
    return data.get("data") or {}


async def create_transfer(
    *,
    reference: str,
    amount: int,
    provider: str,
    phone: str,
    name: str,
    description: str = "Retrait Kobo",
) -> dict:
    """Virement Mobile Money en 1 étape."""
    payment_method = PROVIDER_MAP.get(provider.lower())
    if not payment_method:
        raise ValueError(f"Provider non supporté: {provider}")

    normalized_phone = _normalize_phone(phone)
    payload = {
        "amount": amount,
        "currency": "XAF",
        "paymentMethod": payment_method,
        "beneficiaryAccount": normalized_phone,
        "beneficiaryName": name,
        "merchantReference": reference,
        "description": description,
        "callbackUrl": SHAREPAY_WEBHOOK_URL,
        "notifyUrl": SHAREPAY_WEBHOOK_URL,
        "webhookUrl": SHAREPAY_WEBHOOK_URL,
    }
    log.info("SharePay transfer amount=%s provider=%s ref=%s", amount, provider, reference)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{SHAREPAY_API}/api/v1/pay-out/transfer",
            json=payload,
            headers=_headers(),
        )
    data = resp.json()
    log.info("SharePay transfer HTTP %s keys=%s", resp.status_code, sorted(data.keys()))
    if not data.get("success"):
        msg = data.get("message") or data.get("code") or f"HTTP {resp.status_code}"
        raise RuntimeError(f"SharePay transfer: {msg}")
    return data.get("data") or {}


def verify_webhook_signature(payload: bytes, signature: str) -> bool:
    """Vérifie la signature HMAC-SHA256 d'un webhook SharePay.

    Format : "t=<timestamp>,v1=<hmac-sha256>"
    Plusieurs variantes possibles — on teste toutes et on log pour diagnostiquer.
    """
    if not settings.sharepay_webhook_secret:
        log.error("sharepay_webhook_secret absent — webhook refusé")
        return False
    if not signature:
        log.warning("SharePay webhook: signature vide — refusé")
        return False

    # Parser "t=1234,v1=abcdef..."
    timestamp = ""
    v1 = ""
    for part in signature.split(","):
        if part.startswith("t="):
            timestamp = part[2:]
        elif part.startswith("v1="):
            v1 = part[3:]

    if not v1:
        v1 = signature
        timestamp = ""

    raw_secret = settings.sharepay_webhook_secret
    # Retirer le préfixe whsec_ si présent
    hex_secret = raw_secret[len("whsec_"):] if raw_secret.startswith("whsec_") else raw_secret

    signed_ts_body = f"{timestamp}.".encode() + payload if timestamp else payload

    candidates = {}
    # Variante 1 : key=whsec_... complet, msg=timestamp.body
    candidates["full_str_ts_body"]   = hmac.new(raw_secret.encode(),          signed_ts_body, hashlib.sha256).hexdigest()
    # Variante 2 : key=hex_part str, msg=timestamp.body
    candidates["hex_str_ts_body"]    = hmac.new(hex_secret.encode(),           signed_ts_body, hashlib.sha256).hexdigest()
    # Variante 3 : key=hex decoded bytes, msg=timestamp.body
    try:
        candidates["hex_bytes_ts_body"] = hmac.new(bytes.fromhex(hex_secret),  signed_ts_body, hashlib.sha256).hexdigest()
    except ValueError:
        pass
    # Variante 4-6 : même chose sur body seul (sans timestamp)
    candidates["full_str_body"]      = hmac.new(raw_secret.encode(),           payload,         hashlib.sha256).hexdigest()
    candidates["hex_str_body"]       = hmac.new(hex_secret.encode(),           payload,         hashlib.sha256).hexdigest()
    try:
        candidates["hex_bytes_body"] = hmac.new(bytes.fromhex(hex_secret),     payload,         hashlib.sha256).hexdigest()
    except ValueError:
        pass

    # Variante identifiée : full_str_body (key=whsec_... complet, msg=body seul)
    expected = candidates.get("full_str_body", "")
    if expected and hmac.compare_digest(expected, v1.lower()):
        return True

    log.warning(
        "SharePay webhook signature MISMATCH — v1=%s... | full_str_body=%s...",
        v1[:16],
        expected[:16],
    )
    return False
