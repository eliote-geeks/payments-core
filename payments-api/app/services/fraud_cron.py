"""
Periodic fraud scan — runs every 30 minutes via asyncio background task.

Analyses all non-blocked accounts and flags/suspends/auto-bans based on
11 behavioural signals that are only visible retrospectively:

  A  accumulated_warns         ≥3 'warn' events in 7 days
  B  rapid_cycle               deposited + received ≥75% withdrawn in 48h
  C  smurfing                  ≥4 credits of similar amount in 24h
  D  balance_anomaly           wallet balance > historical credit − debit (injected funds)
  E  kyc0_high_balance         KYC level 0 with wallet balance > 200k FCFA
  F  circular_flow             A→B→C→A within 72h, amounts within 20%
  G  dormant_reactivation      inactive 30d then big volume in 24h
  H  multi_ip                  >3 distinct IPs in 24h
  I  withdrawal_failure_flood  ≥3 fiat withdrawals failed in 24h
  J  rapid_deposit_withdraw    deposit then withdrawal attempt <15 min, repeated ≥2×
  K  ghost_pending_debits      pending 'withdraw' debits >2h (legacy route exploit)

Score thresholds:
  35–54  → flag   (log only, no account action)
  55–79  → review (mark under_review, admin email)
  80+    → block  (auto-ban, admin email, user notification)
"""
from __future__ import annotations

import uuid
from contextlib import closing
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import psycopg.rows

from app.core.time import utcnow
from app.db.session import get_conn
from app.services.email import notify_admin
from app.services.notifications import create_notification

# ── Thresholds ─────────────────────────────────────────────────────────────────
_AUTO_BLOCK_SCORE = 80
_REVIEW_SCORE = 55
_FLAG_SCORE = 35

_RAPID_CYCLE_RATIO = 0.75       # debits / credits in 48h
_RAPID_CYCLE_MIN_FCFA = 50_000  # only flag if total credit ≥ this
_SMURFING_SIMILAR_PCT = 0.10    # amounts within 10% of each other
_SMURFING_MIN_COUNT = 4         # minimum grouped credits in 24h
_KYC0_BALANCE_THRESHOLD = Decimal("200000")
_CIRCULAR_AMOUNT_MARGIN = 0.20  # amounts within 20% for circular flow
_DORMANT_DAYS = 30              # days without activity = dormant
_DORMANT_REACTIVATION_FCFA = 100_000
_MULTI_IP_THRESHOLD = 3


@dataclass
class ScanSignal:
    code: str
    score: int
    detail: str


@dataclass
class UserScanResult:
    user_id: str
    risk_score: int
    action: str
    signals: list[ScanSignal] = field(default_factory=list)
    auto_blocked: bool = False


# ── Individual signal detectors ────────────────────────────────────────────────

def _signal_accumulated_warns(user_id: str) -> ScanSignal | None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*) FROM fraud_events
               WHERE user_id = %s AND action = 'warn'
               AND created_at >= NOW() - INTERVAL '7 days'""",
            (user_id,),
        )
        count = cur.fetchone()[0] or 0
    if count < 3:
        return None
    score = min(count * 15, 45)
    return ScanSignal("accumulated_warns", score, f"{count} avertissements en 7 jours")


def _signal_rapid_cycle(user_id: str) -> ScanSignal | None:
    """Deposited/received funds then quickly withdrawn — money mule pattern."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT
                 COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END), 0) AS credits,
                 COALESCE(SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END), 0) AS debits
               FROM wallet_transactions
               WHERE user_id = %s AND currency = 'FCFA'
                 AND created_at >= NOW() - INTERVAL '48 hours'
                 AND status = 'completed'""",
            (user_id,),
        )
        row = cur.fetchone()
    credits = float(row[0] or 0)
    debits = float(row[1] or 0)
    if credits < _RAPID_CYCLE_MIN_FCFA:
        return None
    ratio = debits / credits if credits > 0 else 0
    if ratio < _RAPID_CYCLE_RATIO:
        return None
    return ScanSignal(
        "rapid_cycle", 35,
        f"Crédits 48h: {credits:,.0f} FCFA → Débits: {debits:,.0f} FCFA ({ratio:.0%} retiré)",
    )


def _signal_smurfing(user_id: str) -> ScanSignal | None:
    """Multiple credits of suspiciously similar amounts in 24h (structuring)."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT amount FROM wallet_transactions
               WHERE user_id = %s AND direction = 'credit' AND currency = 'FCFA'
                 AND created_at >= NOW() - INTERVAL '24 hours'
                 AND status = 'completed'
               ORDER BY amount""",
            (user_id,),
        )
        amounts = [float(r[0]) for r in cur.fetchall()]
    if len(amounts) < _SMURFING_MIN_COUNT:
        return None
    # Sliding window: find groups of ≥4 amounts within 10% of each other
    for i in range(len(amounts) - _SMURFING_MIN_COUNT + 1):
        window = amounts[i:i + _SMURFING_MIN_COUNT]
        ref = window[0]
        if ref == 0:
            continue
        if all(abs(v - ref) / ref <= _SMURFING_SIMILAR_PCT for v in window):
            return ScanSignal(
                "smurfing", 30,
                f"{len(window)}+ crédits similaires en 24h (ex: {ref:,.0f} FCFA ± {_SMURFING_SIMILAR_PCT:.0%})",
            )
    return None


def _signal_balance_anomaly(user_id: str) -> ScanSignal | None:
    """Wallet balance exceeds what the transaction history can explain.

    Uses ALL non-pending/non-cancelled statuses for debits to avoid counting
    phantom 'withdraw' entries (legacy route bug) that never reduced the balance.
    Refunds (fiat_withdrawal_refund credits) intentionally cancel their matching
    debits, so both sides are included — net effect on a clean account is 0.
    """
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(balance, 0) FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA'",
            (user_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        actual = float(row[0])

        # Credits: all completed credits (deposits, refunds, P2P received)
        # Debits: only non-pending, non-cancelled — includes 'failed' fiat_withdrawals
        #         which DO reduce balance before being refunded (net 0 with their refund credit)
        cur.execute(
            """SELECT
                 COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN direction='debit'  THEN amount ELSE 0 END), 0)
               FROM wallet_transactions
               WHERE user_id = %s AND currency = 'FCFA'
                 AND status NOT IN ('pending', 'cancelled')""",
            (user_id,),
        )
        r2 = cur.fetchone()
    expected = float(r2[0] or 0) - float(r2[1] or 0)
    # Allow 500 FCFA tolerance for rounding and minor timing gaps
    if actual > expected + 500.0 and actual > 0:
        excess = actual - expected
        return ScanSignal(
            "balance_anomaly", 45,
            f"Solde réel {actual:,.2f} FCFA > historique {expected:,.2f} FCFA (excédent: {excess:,.2f} FCFA)",
        )
    return None


def _signal_kyc0_high_balance(user_id: str) -> ScanSignal | None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT wa.balance, kp.level
               FROM wallet_accounts wa
               LEFT JOIN kyc_profiles kp ON kp.user_id = wa.user_id
               WHERE wa.user_id = %s AND wa.currency = 'FCFA'""",
            (user_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    balance = Decimal(str(row[0] or 0))
    kyc_level = int(row[1] or 0)
    if kyc_level > 0 or balance <= _KYC0_BALANCE_THRESHOLD:
        return None
    return ScanSignal(
        "kyc0_high_balance", 20,
        f"KYC niveau 0 avec {float(balance):,.0f} FCFA (seuil: {float(_KYC0_BALANCE_THRESHOLD):,.0f} FCFA)",
    )


def _signal_circular_flow(user_id: str) -> ScanSignal | None:
    """Detect A→B→C→A triangles in last 72h (layering)."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        # Find all users A sent to (B candidates)
        cur.execute(
            """SELECT DISTINCT recipient_user_id, amount
               FROM p2p_transfers
               WHERE sender_user_id = %s AND status = 'completed'
                 AND created_at >= NOW() - INTERVAL '72 hours'""",
            (user_id,),
        )
        sent_to = {r[0]: float(r[1]) for r in cur.fetchall()}
        if not sent_to:
            return None

        # For each B, check if B sent to C, and C sent back to A
        for b_id, amount_ab in sent_to.items():
            cur.execute(
                """SELECT DISTINCT p1.recipient_user_id, p1.amount
                   FROM p2p_transfers p1
                   WHERE p1.sender_user_id = %s AND p1.status = 'completed'
                     AND p1.created_at >= NOW() - INTERVAL '72 hours'
                     AND p1.recipient_user_id != %s""",
                (b_id, user_id),
            )
            b_sent = {r[0]: float(r[1]) for r in cur.fetchall()}
            for c_id, amount_bc in b_sent.items():
                # Check if C sent back to A with similar amount
                cur.execute(
                    """SELECT amount FROM p2p_transfers
                       WHERE sender_user_id = %s AND recipient_user_id = %s
                         AND status = 'completed'
                         AND created_at >= NOW() - INTERVAL '72 hours'
                       LIMIT 1""",
                    (c_id, user_id),
                )
                row = cur.fetchone()
                if not row:
                    continue
                amount_ca = float(row[0])
                # All three amounts within 20% of each other
                ref = amount_ab
                if ref == 0:
                    continue
                if (
                    abs(amount_bc - ref) / ref <= _CIRCULAR_AMOUNT_MARGIN
                    and abs(amount_ca - ref) / ref <= _CIRCULAR_AMOUNT_MARGIN
                ):
                    return ScanSignal(
                        "circular_flow", 45,
                        f"Triangle A→B→C→A détecté en 72h. Montants: {amount_ab:,.0f} / {amount_bc:,.0f} / {amount_ca:,.0f} FCFA",
                    )
    return None


def _signal_dormant_reactivation(user_id: str) -> ScanSignal | None:
    """Account inactive for 30d then suddenly high-volume in 24h."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        # Last transaction before the last 24h window
        cur.execute(
            """SELECT MAX(created_at) FROM wallet_transactions
               WHERE user_id = %s AND created_at < NOW() - INTERVAL '24 hours'""",
            (user_id,),
        )
        last_before = (cur.fetchone() or [None])[0]
        if not last_before:
            return None
        age = (utcnow() - last_before).days
        if age < _DORMANT_DAYS:
            return None

        # Volume in last 24h
        cur.execute(
            """SELECT COALESCE(SUM(amount), 0) FROM wallet_transactions
               WHERE user_id = %s AND created_at >= NOW() - INTERVAL '24 hours'
                 AND direction = 'credit' AND currency = 'FCFA' AND status = 'completed'""",
            (user_id,),
        )
        recent_vol = float((cur.fetchone() or [0])[0])
    if recent_vol < _DORMANT_REACTIVATION_FCFA:
        return None
    return ScanSignal(
        "dormant_reactivation", 20,
        f"Inactif {age}j puis {recent_vol:,.0f} FCFA crédités en 24h",
    )


def _signal_multi_ip(user_id: str) -> ScanSignal | None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COUNT(DISTINCT ip_address) FROM sessions
               WHERE user_id = %s
                 AND ip_address IS NOT NULL
                 AND created_at >= NOW() - INTERVAL '24 hours'""",
            (user_id,),
        )
        count = int((cur.fetchone() or [0])[0])
    if count <= _MULTI_IP_THRESHOLD:
        return None
    return ScanSignal(
        "multi_ip", 15,
        f"{count} adresses IP distinctes en 24h",
    )


def _signal_withdrawal_failure_flood(user_id: str) -> ScanSignal | None:
    """Many failed fiat withdrawals in 24h — indicates repeated balance exploit attempts."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*) FROM fiat_withdrawals
               WHERE user_id = %s AND status = 'failed'
                 AND created_at >= NOW() - INTERVAL '24 hours'""",
            (user_id,),
        )
        count = int((cur.fetchone() or [0])[0])
    if count < 3:
        return None
    score = min(15 * count, 60)
    return ScanSignal(
        "withdrawal_failure_flood", score,
        f"{count} retraits fiat échoués en 24h — possible tentative d'exploitation",
    )


def _signal_rapid_deposit_withdraw(user_id: str) -> ScanSignal | None:
    """Deposit closely followed by a withdrawal attempt — common in balance exploit patterns."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*) FROM (
                 SELECT d.created_at AS dep_at
                 FROM fiat_deposits d
                 WHERE d.user_id = %s AND d.status = 'completed'
                   AND d.created_at >= NOW() - INTERVAL '48 hours'
                   AND EXISTS (
                     SELECT 1 FROM fiat_withdrawals fw
                     WHERE fw.user_id = %s
                       AND fw.created_at BETWEEN d.created_at
                                             AND d.created_at + INTERVAL '15 minutes'
                   )
               ) pairs""",
            (user_id, user_id),
        )
        pairs = int((cur.fetchone() or [0])[0])
    if pairs < 2:
        return None
    score = min(pairs * 20, 55)
    return ScanSignal(
        "rapid_deposit_withdraw", score,
        f"{pairs} dépôts suivis d'un retrait en <15 min sur 48h",
    )


def _signal_ghost_pending_debits(user_id: str) -> ScanSignal | None:
    """Pending 'withdraw' debits older than 2h — fingerprint of the legacy /withdraw route exploit."""
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM wallet_transactions
               WHERE user_id = %s AND direction = 'debit'
                 AND status = 'pending' AND category = 'withdraw'
                 AND created_at < NOW() - INTERVAL '2 hours'""",
            (user_id,),
        )
        row = cur.fetchone()
    count = int(row[0] or 0)
    total = float(row[1] or 0)
    if count == 0:
        return None
    return ScanSignal(
        "ghost_pending_debits", 50,
        f"{count} débits fantômes en pending ({total:,.0f} FCFA) — route /withdraw obsolète exploitée",
    )


# ── Core scan logic ────────────────────────────────────────────────────────────

_DETECTORS = [
    _signal_accumulated_warns,
    _signal_rapid_cycle,
    _signal_smurfing,
    _signal_balance_anomaly,
    _signal_kyc0_high_balance,
    _signal_circular_flow,
    _signal_dormant_reactivation,
    _signal_multi_ip,
    _signal_withdrawal_failure_flood,
    _signal_rapid_deposit_withdraw,
    _signal_ghost_pending_debits,
]


def _scan_user(user_id: str) -> UserScanResult | None:
    signals: list[ScanSignal] = []
    for detector in _DETECTORS:
        try:
            sig = detector(user_id)
            if sig:
                signals.append(sig)
        except Exception:
            pass

    if not signals:
        return None

    total = min(sum(s.score for s in signals), 100)

    if total >= _AUTO_BLOCK_SCORE:
        action = "auto_block"
    elif total >= _REVIEW_SCORE:
        action = "review"
    elif total >= _FLAG_SCORE:
        action = "flag"
    else:
        return None

    return UserScanResult(user_id=user_id, risk_score=total, action=action, signals=signals)


def _apply_action(result: UserScanResult) -> None:
    now = utcnow()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        if result.action == "auto_block":
            cur.execute(
                "UPDATE users SET blocked = TRUE, updated_at = %s WHERE id = %s",
                (now, result.user_id),
            )
            result.auto_blocked = True
        elif result.action == "review":
            cur.execute(
                "UPDATE users SET under_review = TRUE, updated_at = %s WHERE id = %s",
                (now, result.user_id),
            )
        conn.commit()


def _persist_result(result: UserScanResult, run_id: str) -> None:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO fraud_scan_results
               (id, user_id, scan_run_id, risk_score, action, signals, auto_blocked)
               VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)""",
            (
                str(uuid.uuid4()),
                result.user_id,
                run_id,
                result.risk_score,
                result.action,
                __import__("json").dumps([
                    {"code": s.code, "score": s.score, "detail": s.detail}
                    for s in result.signals
                ]),
                result.auto_blocked,
            ),
        )
        conn.commit()


def _notify(result: UserScanResult) -> None:
    action_label = {"auto_block": "BLOQUÉ AUTOMATIQUEMENT", "review": "SOUS SURVEILLANCE", "flag": "SIGNALÉ"}.get(result.action, result.action)
    signal_lines = "<br>".join(
        f"• <b>{s.code}</b> (+{s.score}): {s.detail}" for s in result.signals
    )
    notify_admin(
        f"[FRAUDE] Cron fraude — {action_label} (score {result.risk_score}/100)",
        f"<b>Utilisateur ID :</b> {result.user_id}<br>"
        f"<b>Action :</b> {action_label}<br>"
        f"<b>Score composite :</b> {result.risk_score}/100<br><br>"
        f"<b>Signaux déclenchés :</b><br>{signal_lines}",
    )
    if result.action == "auto_block":
        try:
            create_notification(
                result.user_id,
                "account_blocked",
                "Compte suspendu",
                "Votre compte a été temporairement suspendu pour des raisons de sécurité. Contactez le support.",
            )
        except Exception:
            pass


# ── Public entry point ─────────────────────────────────────────────────────────

def run_fraud_scan() -> dict[str, Any]:
    """
    Scan all active (non-blocked) users.
    Returns a summary dict.
    """
    run_id = str(uuid.uuid4())
    started_at = utcnow()

    _SYSTEM_ACCOUNTS = {"sys_kobo_platform"}

    # Fetch all non-blocked user IDs (exclude internal system accounts)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE blocked = FALSE OR blocked IS NULL")
        user_ids = [r[0] for r in cur.fetchall() if r[0] not in _SYSTEM_ACCOUNTS]

    scanned = 0
    flagged = 0
    reviewed = 0
    blocked = 0
    errors = 0

    for uid in user_ids:
        try:
            result = _scan_user(uid)
            scanned += 1
            if result is None:
                continue

            _apply_action(result)
            _persist_result(result, run_id)

            if result.action in ("review", "auto_block"):
                _notify(result)

            if result.action == "flag":
                flagged += 1
            elif result.action == "review":
                reviewed += 1
            elif result.action == "auto_block":
                blocked += 1
        except Exception:
            errors += 1

    elapsed = (utcnow() - started_at).total_seconds()
    return {
        "run_id": run_id,
        "scanned": scanned,
        "flagged": flagged,
        "reviewed": reviewed,
        "blocked": blocked,
        "errors": errors,
        "elapsed_s": round(elapsed, 2),
    }
