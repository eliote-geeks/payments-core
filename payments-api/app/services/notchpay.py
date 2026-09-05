from __future__ import annotations

import hashlib
import hmac
import logging
import re

import httpx

from app.core.config import settings

log = logging.getLogger("notchpay")

NOTCHPAY_API = "https://api.notchpay.co"

CHANNEL_MAP = {
    "mtn":    "cm.mtn",
    "orange": "cm.orange",
}

# Numéros de test sandbox NotchPay (ne pas utiliser en production)
SANDBOX_TEST_PHONES = {
    "cm.mtn":    "+237670000000",  # succès garanti
    "cm.orange": "+237690000000",  # succès garanti
}


def _normalize_phone(phone: str) -> str:
    """Normalise un numéro camerounais en +237XXXXXXXXX."""
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("237") and len(digits) == 12:
        return f"+{digits}"
    if len(digits) == 9 and digits[0] in "6":
        return f"+237{digits}"
    if digits.startswith("00237"):
        return f"+{digits[2:]}"
    # Déjà au bon format ou inconnu → retourner tel quel avec +
    return phone if phone.startswith("+") else f"+{phone}"


async def _create_recipient(
    client: httpx.AsyncClient,
    *,
    phone: str,
    name: str,
    channel: str,
) -> str:
    """Crée un destinataire NotchPay et retourne son ID (rcp_...)."""
    resp = await client.post(
        f"{NOTCHPAY_API}/recipients",
        json={"channel": channel, "account_number": phone, "phone": phone, "name": name},
        headers={
            "Authorization": settings.notchpay_public_key,
            "X-Grant": settings.notchpay_private_key,
            "Content-Type": "application/json",
        },
    )
    data = resp.json()
    log.info("NotchPay POST /recipients HTTP %s keys=%s", resp.status_code, sorted(data.keys()))
    if resp.status_code not in (200, 201):
        msg = data.get("message") or data.get("error") or f"HTTP {resp.status_code}"
        raise RuntimeError(f"NotchPay recipient: {msg}")

    # Réponse : { "recipient": { "id": "rcp_..." } }  ou  { "id": "rcp_..." }
    recipient = data.get("recipient") or data
    recipient_id = recipient.get("id") if isinstance(recipient, dict) else None
    if not recipient_id:
        raise RuntimeError(f"NotchPay: pas d'ID destinataire dans la réponse: {data}")
    return recipient_id


async def initiate_transfer(
    *,
    reference: str,
    amount: int,
    phone: str,
    name: str = "Kobo User",
    provider: str,
    description: str = "Retrait Kobo",
) -> dict:
    """
    Envoie un paiement Mobile Money via NotchPay (2 étapes).

    Étape 1 — créer le destinataire (POST /recipients)
    Étape 2 — créer le virement   (POST /transfers)
    """
    channel = CHANNEL_MAP.get(provider.lower())
    if not channel:
        raise ValueError(f"Provider non supporté: {provider}")

    normalized_phone = _normalize_phone(phone)

    # En sandbox, remplacer par les numéros de test si la clé est une clé test
    is_sandbox = settings.notchpay_public_key.startswith("pk_test")
    if is_sandbox:
        test_phone = SANDBOX_TEST_PHONES.get(channel)
        if test_phone:
            normalized_phone = test_phone

    log.info(
        "NotchPay initiate_transfer provider=%s channel=%s amount=%s ref=%s",
        provider, channel, amount, reference,
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Étape 1 — créer le destinataire
        log.info("NotchPay create_recipient type=%s", channel)
        recipient_id = await _create_recipient(
            client,
            phone=normalized_phone,
            name=name,
            channel=channel,
        )
        log.info("NotchPay create_recipient completed")

        # Étape 2 — initier le virement
        transfer_payload = {
            "recipient": recipient_id,
            "amount": amount,
            "currency": "XAF",
            "description": description,
            "reference": reference,
            "callback": "https://pay-api.koboonline.com/deposits/webhooks/notchpay",
        }
        log.info("NotchPay POST /transfers amount=%s ref=%s", amount, reference)
        resp = await client.post(
            f"{NOTCHPAY_API}/transfers",
            json=transfer_payload,
            headers={
                "Authorization": settings.notchpay_public_key,
                "X-Grant": settings.notchpay_private_key,
                "Content-Type": "application/json",
            },
        )

    data = resp.json()
    log.info("NotchPay POST /transfers HTTP %s keys=%s", resp.status_code, sorted(data.keys()))
    if resp.status_code not in (200, 201, 202):
        msg = (
            data.get("message")
            or data.get("error")
            or f"NotchPay HTTP {resp.status_code}"
        )
        raise RuntimeError(msg)
    return data


async def create_payment(
    *,
    reference: str,
    amount: int,
    currency: str,
    phone: str,
    description: str = "Dépôt Kobo",
) -> dict:
    """Étape 1 — crée le paiement NotchPay et retourne la réponse (contient transaction.reference)."""
    normalized_phone = _normalize_phone(phone)
    payload = {
        "amount": amount,
        "currency": currency,
        "phone": normalized_phone,
        "description": description,
        "reference": reference,
        "callback": "https://pay-api.koboonline.com/deposits/webhooks/notchpay",
    }
    log.info("NotchPay create_payment amount=%s currency=%s ref=%s", amount, currency, reference)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{NOTCHPAY_API}/payments",
            json=payload,
            headers={
                "Authorization": settings.notchpay_public_key,
                "Content-Type": "application/json",
            },
        )
    data = resp.json()
    log.info("NotchPay create_payment HTTP %s keys=%s", resp.status_code, sorted(data.keys()))
    if resp.status_code not in (200, 201, 202):
        msg = data.get("message") or data.get("error") or f"NotchPay HTTP {resp.status_code}"
        raise RuntimeError(msg)
    return data


async def trigger_ussd_push(*, trx_ref: str, channel: str, phone: str) -> dict:
    """Étape 2 — envoie le USSD push sur le téléphone (peut prendre 30-60s)."""
    normalized_phone = _normalize_phone(phone)
    is_sandbox = settings.notchpay_public_key.startswith("pk_test")
    if is_sandbox:
        test_phone = SANDBOX_TEST_PHONES.get(channel)
        if test_phone:
            normalized_phone = test_phone
    payload = {"channel": channel, "data": {"phone": normalized_phone}}
    log.info("NotchPay trigger_ussd_push ref=%s channel=%s", trx_ref, channel)
    async with httpx.AsyncClient(timeout=65.0) as client:
        resp = await client.post(
            f"{NOTCHPAY_API}/payments/{trx_ref}",
            json=payload,
            headers={
                "Authorization": settings.notchpay_public_key,
                "Content-Type": "application/json",
            },
        )
    data = resp.json()
    log.info("NotchPay trigger_ussd_push HTTP %s keys=%s", resp.status_code, sorted(data.keys()))
    if resp.status_code not in (200, 201, 202):
        msg = data.get("message") or data.get("error") or f"NotchPay charge HTTP {resp.status_code}"
        raise RuntimeError(msg)
    return data


async def collect_payment(
    *,
    reference: str,
    amount: int,
    currency: str,
    phone: str,
    channel: str,
    description: str = "Dépôt Kobo",
) -> dict:
    """Encaissement complet en 2 étapes (usage direct ou tests)."""
    normalized_phone = _normalize_phone(phone)
    is_sandbox = settings.notchpay_public_key.startswith("pk_test")
    if is_sandbox:
        test_phone = SANDBOX_TEST_PHONES.get(channel)
        if test_phone:
            normalized_phone = test_phone

    async with httpx.AsyncClient(timeout=65.0) as client:
        resp1 = await client.post(
            f"{NOTCHPAY_API}/payments",
            json={
                "amount": amount,
                "currency": currency,
                "phone": normalized_phone,
                "description": description,
                "reference": reference,
                "callback": "https://pay-api.koboonline.com/deposits/webhooks/notchpay",
            },
            headers={"Authorization": settings.notchpay_public_key, "Content-Type": "application/json"},
        )
        data1 = resp1.json()
        if resp1.status_code not in (200, 201, 202):
            msg = data1.get("message") or data1.get("error") or f"NotchPay HTTP {resp1.status_code}"
            raise RuntimeError(msg)
        trx_ref = (
            data1.get("transaction", {}).get("reference")
            or data1.get("reference")
            or reference
        )
        resp2 = await client.post(
            f"{NOTCHPAY_API}/payments/{trx_ref}",
            json={"channel": channel, "data": {"phone": normalized_phone}},
            headers={"Authorization": settings.notchpay_public_key, "Content-Type": "application/json"},
        )
        data2 = resp2.json()
        if resp2.status_code not in (200, 201, 202):
            msg = data2.get("message") or data2.get("error") or f"NotchPay charge HTTP {resp2.status_code}"
            raise RuntimeError(msg)
    return data2


async def create_checkout(
    *,
    reference: str,
    amount: int,
    currency: str = "XAF",
    description: str = "Dépôt Kobo",
    phone: str | None = None,
    email: str | None = None,
) -> dict:
    """Crée une session de paiement NotchPay (hosted checkout — redirect, sans USSD).
    NotchPay requires at least one of phone/email/customer to initialize."""
    normalized = _normalize_phone(phone) if phone else None
    payload: dict = {
        "amount": amount,
        "currency": currency,
        "description": description,
        "reference": reference,
        "callback": "https://pay-api.koboonline.com/deposits/webhooks/notchpay",
    }
    if normalized:
        payload["phone"] = normalized
    elif email:
        payload["email"] = email
    log.warning("NotchPay create_checkout → POST /payments payload=%s", payload)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{NOTCHPAY_API}/payments",
            json=payload,
            headers={
                "Authorization": settings.notchpay_public_key,
                "Content-Type": "application/json",
            },
        )
    data = resp.json()
    log.warning("NotchPay create_checkout ← HTTP %s body=%s", resp.status_code, data)
    if resp.status_code not in (200, 201, 202):
        msg = data.get("message") or data.get("error") or f"NotchPay HTTP {resp.status_code}"
        raise RuntimeError(msg)
    # authorization_url = data.get("transaction", {}).get("authorization_url") or data.get("authorization_url")
    auth_url = (
        (data.get("transaction") or {}).get("authorization_url")
        or data.get("authorization_url")
        or ""
    )
    return {**data, "authorization_url": auth_url}


def verify_webhook_signature(payload: bytes, signature: str) -> bool:
    """Vérifie la signature HMAC-SHA256 d'un webhook NotchPay."""
    if not settings.notchpay_hash_key:
        log.error("notchpay_hash_key absent — webhook refusé")
        return False
    if not signature:
        log.warning("Signature vide reçue dans le webhook")
        return False
    expected = hmac.new(
        settings.notchpay_hash_key.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    ok = hmac.compare_digest(expected, signature.lower())
    if not ok:
        log.warning(
            "Signature NotchPay MISMATCH — expected=%s..., got=%s...",
            expected[:16],
            signature[:16],
        )
    return ok
