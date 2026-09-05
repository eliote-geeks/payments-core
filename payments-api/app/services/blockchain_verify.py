"""
Verification of USDT TRC20 transactions via public explorer APIs.

Strategy (TRC20):
  1. TronScan  apilist.tronscanapi.com  – richest response, try first
  2. TronScan  tronscan.org             – same data, different host
  3. TronGrid  api.trongrid.io events   – Tron's official API, no key needed

VerifyResult.status:
  "auto_confirmed"      – valid + ≥ MIN_CONFIRMATIONS  → credit immediately
  "hash_verified"       – valid + <  MIN_CONFIRMATIONS → admin one-click confirm
  "needs_manual_review" – all APIs unavailable
  "invalid"             – tx not found / wrong address / wrong amount / failed tx
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

import httpx

from app.core.config import settings

log = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
USDT_CONTRACTS = {
    "TRC20": USDT_TRC20_CONTRACT,
    "ERC20": "0xdac17f958d2ee523a2206206994597c13d831ec7",
    "BEP20": "0x55d398326f99059ff775485246999027b3197955",
}

MIN_CONFIRMATIONS = 20
AMOUNT_TOLERANCE  = Decimal("0.02")   # 2 % – covers rounding / small fees
HTTP_TIMEOUT      = 15                # seconds per request

def _headers() -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
    }
    if settings.tronscan_api_key:
        headers["TRON-PRO-API-KEY"] = settings.tronscan_api_key
    return headers


# ── Result ────────────────────────────────────────────────────────────────────

@dataclass
class VerifyResult:
    status: str                       # see module docstring
    amount_usdt: Decimal | None = None
    confirmations: int = 0
    reason: str = ""
    raw: dict = field(default_factory=dict)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_decimal(value: object) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None


def _parse_trc20_amount(transfer: dict) -> Decimal | None:
    """
    TronScan stores raw base-unit amounts.  USDT TRC20 has 6 decimals.
    Fields tried: amount_str, amount_with_decimals (already divided), amount.
    We detect whether the value is already human-readable by checking if it
    looks implausibly large compared to a realistic USDT payment.
    """
    decimals = int(transfer.get("decimals") or 6)
    divisor  = Decimal(10 ** decimals)

    for key in ("amount_str", "amount", "quant"):
        raw = transfer.get(key)
        if raw is None:
            continue
        d = _safe_decimal(raw)
        if d is None:
            continue
        # If the value is > 10^(decimals-1) it is almost certainly in base units
        if d >= Decimal(10 ** (decimals - 1)):
            return d / divisor
        # Otherwise already in human-readable form (e.g. "10.5")
        return d

    return None


def _addr_match(a: str, b: str) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


# ── TronScan (apilist / tronscan.org) ─────────────────────────────────────────

_TRONSCAN_ENDPOINTS = [
    "https://apilist.tronscanapi.com/api/transaction-info?hash={}",
    "https://tronscan.org/api/transaction-info?hash={}",
]


def _try_tronscan(tx_hash: str, expected_to: str, expected_usdt: Decimal) -> VerifyResult | None:
    """
    Returns a VerifyResult if TronScan responded (even with 'invalid').
    Returns None if every endpoint was unreachable (caller should try next API).
    """
    data: dict | None = None

    for url_tpl in _TRONSCAN_ENDPOINTS:
        url = url_tpl.format(tx_hash)
        try:
            with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
                resp = client.get(url, headers=_headers())
                if resp.status_code != 200:
                    log.warning("TronScan %s → HTTP %s", url, resp.status_code)
                    continue
                j = resp.json()
                if j and j.get("hash"):
                    data = j
                    break
                # 200 but no hash = tx not found (not an API error)
                if j is not None:
                    return VerifyResult(
                        "invalid",
                        reason="Transaction non trouvée sur TronScan (hash inconnu)",
                    )
        except Exception as exc:
            log.warning("TronScan %s error: %s", url, exc)
            continue

    if data is None:
        return None  # all endpoints unreachable → try next API

    # ── TX failed on-chain ────────────────────────────────────────────────────
    contract_ret = data.get("contractRet") or ""
    if contract_ret and contract_ret != "SUCCESS":
        return VerifyResult(
            "invalid",
            reason=f"Transaction échouée sur la blockchain ({contract_ret})",
            raw=data,
        )

    confirmations = int(data.get("confirmations") or 0)

    # ── Find USDT TRC20 transfer ──────────────────────────────────────────────
    trc20_list  = data.get("trc20TransferInfo") or []
    contract_lc = USDT_TRC20_CONTRACT.lower()

    transfer = next(
        (t for t in trc20_list
         if (t.get("contract_address") or "").lower() == contract_lc),
        None,
    )

    if transfer is None:
        # Might be an ordinary TRX transfer, not USDT
        return VerifyResult(
            "invalid",
            confirmations=confirmations,
            reason=(
                "Aucun transfert USDT TRC20 trouvé. "
                f"Contrats présents : {[t.get('contract_address') for t in trc20_list] or 'aucun'}"
            ),
            raw=data,
        )

    # ── Destination address ───────────────────────────────────────────────────
    to_addr = (transfer.get("to_address") or "").strip()
    if not _addr_match(to_addr, expected_to):
        return VerifyResult(
            "invalid",
            confirmations=confirmations,
            reason=f"Mauvaise adresse de destination — reçu : {to_addr or '(vide)'}",
            raw=data,
        )

    # ── Amount ───────────────────────────────────────────────────────────────
    amount_usdt = _parse_trc20_amount(transfer)
    if amount_usdt is None:
        return VerifyResult(
            "invalid",
            confirmations=confirmations,
            reason=f"Montant illisible dans le transfert (fields: {dict(transfer)})",
            raw=data,
        )

    min_expected = expected_usdt * (1 - AMOUNT_TOLERANCE)
    if amount_usdt < min_expected:
        return VerifyResult(
            "invalid",
            amount_usdt=amount_usdt,
            confirmations=confirmations,
            reason=(
                f"Montant insuffisant — reçu {amount_usdt:.6f} USDT, "
                f"attendu ≥ {min_expected:.6f} USDT"
            ),
            raw=data,
        )

    # ── All checks passed ─────────────────────────────────────────────────────
    final = "auto_confirmed" if confirmations >= MIN_CONFIRMATIONS else "hash_verified"
    reason = "" if final == "auto_confirmed" else f"{confirmations}/{MIN_CONFIRMATIONS} confirmations"
    return VerifyResult(
        status=final,
        amount_usdt=amount_usdt,
        confirmations=confirmations,
        reason=reason,
        raw=data,
    )


# ── TronGrid events API (official Tron, no key needed for basic use) ──────────

def _try_trongrid(tx_hash: str, expected_to: str, expected_usdt: Decimal) -> VerifyResult | None:
    """
    Uses two TronGrid endpoints:
      1. /wallet/gettransactioninfobyid  – blockNumber (for confirmations)
      2. /v1/transactions/{hash}/events  – decoded Transfer event
    Returns None only if TronGrid itself is unreachable.
    """
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT, follow_redirects=True) as client:
            # 1) TX info (block number → confirmations)
            info_resp = client.post(
                "https://api.trongrid.io/wallet/gettransactioninfobyid",
                json={"value": tx_hash},
                headers=_headers(),
            )
            tx_info: dict = info_resp.json() if info_resp.status_code == 200 else {}

            # 2) Decoded events
            ev_resp = client.get(
                f"https://api.trongrid.io/v1/transactions/{tx_hash}/events",
                headers=_headers(),
            )
            ev_data: dict = ev_resp.json() if ev_resp.status_code == 200 else {}
    except Exception as exc:
        log.warning("TronGrid unreachable: %s", exc)
        return None  # caller should fallback to manual review

    # Not found
    if not tx_info or not tx_info.get("id"):
        return VerifyResult("invalid", reason="Transaction non trouvée sur TronGrid")

    # Receipt check
    receipt = tx_info.get("receipt") or {}
    receipt_result = receipt.get("result") or ""
    if receipt_result and receipt_result != "SUCCESS":
        return VerifyResult("invalid", reason=f"Transaction échouée (receipt: {receipt_result})")

    # Confirmations via blockNumber vs current block
    confirmations = 0
    block_number  = tx_info.get("blockNumber")
    if block_number:
        try:
            with httpx.Client(timeout=HTTP_TIMEOUT) as client:
                nb = client.post(
                    "https://api.trongrid.io/wallet/getnowblock",
                    headers=_headers(),
                ).json()
                latest = int(nb.get("block_header", {}).get("raw_data", {}).get("number") or 0)
                if latest and block_number:
                    confirmations = max(0, latest - int(block_number))
        except Exception:
            confirmations = 0

    # Find USDT Transfer event
    events = ev_data.get("data") or []
    usdt_contract_lc = USDT_TRC20_CONTRACT.lower()

    transfer_event = next(
        (e for e in events
         if e.get("event_name") == "Transfer"
         and (e.get("contract_address") or "").lower() == usdt_contract_lc),
        None,
    )

    if transfer_event is None:
        return VerifyResult(
            "invalid",
            confirmations=confirmations,
            reason="Aucun événement Transfer USDT TRC20 (TronGrid events)",
        )

    result = transfer_event.get("result") or {}
    # Named keys (_to, _from, _value) or positional (0, 1, 2)
    to_addr = result.get("_to") or result.get("1") or ""

    if not _addr_match(to_addr, expected_to):
        return VerifyResult(
            "invalid",
            confirmations=confirmations,
            reason=f"Mauvaise adresse de destination (TronGrid) — reçu : {to_addr or '(vide)'}",
        )

    raw_value = result.get("_value") or result.get("2") or "0"
    d = _safe_decimal(raw_value)
    if d is None:
        return VerifyResult("invalid", confirmations=confirmations,
                            reason="Montant illisible (TronGrid)")

    # TronGrid events give raw base-unit values
    amount_usdt = d / Decimal("1000000")

    min_expected = expected_usdt * (1 - AMOUNT_TOLERANCE)
    if amount_usdt < min_expected:
        return VerifyResult(
            "invalid",
            amount_usdt=amount_usdt,
            confirmations=confirmations,
            reason=(
                f"Montant insuffisant — reçu {amount_usdt:.6f} USDT, "
                f"attendu ≥ {min_expected:.6f} USDT"
            ),
        )

    final = "auto_confirmed" if confirmations >= MIN_CONFIRMATIONS else "hash_verified"
    reason = "" if final == "auto_confirmed" else f"{confirmations}/{MIN_CONFIRMATIONS} confirmations (TronGrid)"
    return VerifyResult(
        status=final,
        amount_usdt=amount_usdt,
        confirmations=confirmations,
        reason=reason,
    )


# ── Main TRC20 verifier ───────────────────────────────────────────────────────

def _verify_trc20(tx_hash: str, expected_to: str, expected_usdt: Decimal) -> VerifyResult:
    # 1. TronScan (two endpoints internally)
    result = _try_tronscan(tx_hash, expected_to, expected_usdt)
    if result is not None:
        return result

    log.warning("TronScan completely unreachable, trying TronGrid for %s", tx_hash)

    # 2. TronGrid events API
    result = _try_trongrid(tx_hash, expected_to, expected_usdt)
    if result is not None:
        return result

    return VerifyResult(
        "needs_manual_review",
        reason="TronScan et TronGrid sont indisponibles — vérification manuelle requise",
    )


# ── ERC20 / BEP20 (basic) ─────────────────────────────────────────────────────

def _verify_erc20_bep20(tx_hash: str, network: str) -> VerifyResult:
    rpc_urls = {
        "ERC20": "https://cloudflare-eth.com",
        "BEP20": "https://bsc-dataseed.binance.org",
    }
    rpc = rpc_urls.get(network)
    if not rpc:
        return VerifyResult("needs_manual_review", reason=f"Réseau {network} non supporté")

    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            receipt = client.post(
                rpc,
                json={"jsonrpc": "2.0", "method": "eth_getTransactionReceipt",
                      "params": [tx_hash], "id": 1},
                headers=_headers(),
            ).json().get("result")
    except Exception as exc:
        return VerifyResult("needs_manual_review", reason=f"RPC {network} indisponible: {exc}")

    if receipt is None:
        return VerifyResult("invalid", reason="Transaction non trouvée sur la blockchain")
    if int(receipt.get("status") or "0x0", 16) != 1:
        return VerifyResult("invalid", reason="Transaction échouée (status=0)")

    return VerifyResult(
        "needs_manual_review",
        reason=f"Transaction {network} confirmée on-chain ; vérification montant/adresse manuelle requise.",
    )


# ── Scan incoming TRC20 ──────────────────────────────────────────────────────

def scan_trc20_incoming(
    to_address: str,
    expected_usdt: Decimal,
    after_ts_ms: int,
    limit: int = 50,
) -> list[dict]:
    contract = USDT_TRC20_CONTRACT
    end_ts_ms = int(__import__("time").time() * 1000)
    start_ts_ms = max(0, int(after_ts_ms or 0))
    page_limit = min(max(int(limit or 50), 1), 50)
    endpoints = [
        "https://apilist.tronscanapi.com/api/token_trc20/transfers",
        "https://apilist.tronscan.org/api/token_trc20/transfers",
    ]
    param_sets = [
        {
            "contract_address": contract,
            "relatedAddress": to_address,
            "limit": page_limit,
            "start": 0,
            "start_timestamp": start_ts_ms,
            "end_timestamp": end_ts_ms,
            "sort": "-timestamp",
        },
        {
            "contract_address": contract,
            "toAddress": to_address,
            "limit": page_limit,
            "start": 0,
            "start_timestamp": start_ts_ms,
            "end_timestamp": end_ts_ms,
            "sort": "-timestamp",
        },
    ]
    data = None
    last_error = None
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            for endpoint in endpoints:
                for params in param_sets:
                    try:
                        resp = client.get(endpoint, params=params, headers=_headers(), follow_redirects=True)
                        if resp.status_code >= 400:
                            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:180]}")
                        data = resp.json()
                        break
                    except Exception as exc:
                        last_error = exc
                        safe_params = {k: v for k, v in params.items() if k != "contract_address"}
                        log.warning("TronScan incoming scan failed endpoint=%s params=%s: %s", endpoint, safe_params, exc)
                if data is not None:
                    break
    except Exception as exc:
        raise RuntimeError(f"TronScan indisponible: {exc}") from exc
    if data is None:
        raise RuntimeError(f"TronScan indisponible: {last_error}")

    results = []
    min_expected = expected_usdt * (1 - AMOUNT_TOLERANCE)

    transfers = data.get("data") or data.get("token_transfers") or []
    for tx in transfers:
        ts_ms = int(tx.get("block_ts") or tx.get("timestamp") or 0)
        if ts_ms and ts_ms < after_ts_ms:
            continue

        amount_usdt = _parse_trc20_amount(tx)
        if amount_usdt is None:
            continue

        confirmed    = tx.get("confirmed", False)
        contract_ret = tx.get("contractRet", "")
        tx_hash      = tx.get("transaction_id") or tx.get("hash") or ""
        from_addr    = tx.get("from_address") or tx.get("from") or ""
        to_addr      = tx.get("to_address") or tx.get("to") or to_address
        if not _addr_match(to_addr, to_address):
            continue
        block_ts_iso = (
            __import__("datetime").datetime.utcfromtimestamp(ts_ms / 1000).strftime("%Y-%m-%dT%H:%M:%SZ")
            if ts_ms else None
        )

        amount_match = amount_usdt >= min_expected
        results.append({
            "tx_hash":      tx_hash,
            "from":         from_addr,
            "to":           to_addr,
            "amount_usdt":  float(amount_usdt),
            "block_ts_ms":  ts_ms,
            "block_ts_iso": block_ts_iso,
            "confirmed":    confirmed,
            "contract_ret": contract_ret,
            "amount_match": amount_match,
            "success":      contract_ret == "SUCCESS" and confirmed,
        })

    results.sort(key=lambda x: (not x["amount_match"], -(x["block_ts_ms"] or 0)))
    return results


# ── Public API ────────────────────────────────────────────────────────────────

def verify_tx(
    tx_hash: str,
    network: str,
    expected_to: str,
    expected_usdt: Decimal,
) -> VerifyResult:
    net = network.upper()
    if net == "TRC20":
        return _verify_trc20(tx_hash, expected_to, expected_usdt)
    if net in ("ERC20", "BEP20"):
        return _verify_erc20_bep20(tx_hash, net)
    return VerifyResult("needs_manual_review", reason=f"Réseau '{network}' non supporté")
