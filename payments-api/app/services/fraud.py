"""
Rule-based fraud detection engine for P2P transfers.

Risk scoring 0-100:
  0-39  → APPROVE   (auto-allow)
  40-69 → WARN      (allow + log + monitor)
  70+   → BLOCK     (reject + notify admin)

Rules are additive — each triggered rule adds to the risk score.
"""
from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from app.db.session import get_conn
from app.services.email import notify_admin
from app.services.notifications import create_notification


# ── Limits by KYC level ───────────────────────────────────────────────────────

_KYC_DAILY_LIMITS = {
    0: Decimal("50000"),    # No KYC: 50k FCFA/day
    1: Decimal("500000"),   # Basic KYC: 500k/day
    2: Decimal("2000000"),  # Full KYC: 2M/day
}
_KYC_HOURLY_MAX_TX = {0: 3, 1: 10, 2: 30}
_NEW_ACCOUNT_DAYS = 7        # accounts younger than this get extra scrutiny
_NEW_ACCOUNT_MAX = Decimal("30000")
_ROUND_TRIP_MINUTES = 30     # flag if B sends back to A within this window
_FAN_OUT_RECIPIENTS = 5      # sending to N+ distinct recipients in 1h
_STRUCTURING_RATIO = 0.95    # transfers > 95% of daily limit = structuring attempt


@dataclass
class FraudResult:
    action: str                          # "approve" | "warn" | "block"
    risk_score: int
    rules_triggered: list[str] = field(default_factory=list)
    block_reason: str | None = None


def _get_conn():
    return get_conn()


def _account_age_days(user_id: str) -> int:
    with closing(_get_conn()) as conn, conn.cursor() as cur:
        cur.execute("SELECT created_at FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        if not row:
            return 0
        from app.core.time import utcnow
        delta = utcnow() - row[0]
        return max(0, delta.days)


def _kyc_level(user_id: str) -> int:
    with closing(_get_conn()) as conn, conn.cursor() as cur:
        cur.execute("SELECT profile->>'kycLevel' FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        try:
            return int(row[0] or 0) if row else 0
        except (TypeError, ValueError):
            return 0


def _is_blocked(user_id: str) -> bool:
    with closing(_get_conn()) as conn, conn.cursor() as cur:
        cur.execute("SELECT blocked, is_blocked FROM users WHERE id = %s", (user_id,))
        row = cur.fetchone()
        return bool(row and (row[0] or row[1]))


def _daily_sent(user_id: str) -> Decimal:
    with closing(_get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(SUM(amount), 0)
            FROM p2p_transfers
            WHERE sender_user_id = %s
              AND status = 'completed'
              AND created_at >= NOW() - INTERVAL '24 hours'
            """,
            (user_id,),
        )
        row = cur.fetchone()
        return Decimal(str(row[0] or 0))


def _hourly_tx_count(user_id: str) -> int:
    with closing(_get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*)
            FROM p2p_transfers
            WHERE sender_user_id = %s
              AND created_at >= NOW() - INTERVAL '1 hour'
            """,
            (user_id,),
        )
        row = cur.fetchone()
        return int(row[0] or 0)


def _hourly_distinct_recipients(user_id: str) -> int:
    with closing(_get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(DISTINCT recipient_user_id)
            FROM p2p_transfers
            WHERE sender_user_id = %s
              AND created_at >= NOW() - INTERVAL '1 hour'
            """,
            (user_id,),
        )
        row = cur.fetchone()
        return int(row[0] or 0)


def _round_trip_exists(sender_id: str, recipient_id: str, amount: Decimal) -> bool:
    """Return True if recipient recently sent a similar amount to sender."""
    with closing(_get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT 1
            FROM p2p_transfers
            WHERE sender_user_id = %s
              AND recipient_user_id = %s
              AND amount BETWEEN %s AND %s
              AND created_at >= NOW() - INTERVAL '%s minutes'
            LIMIT 1
            """,
            (
                recipient_id,
                sender_id,
                float(amount) * 0.8,
                float(amount) * 1.2,
                _ROUND_TRIP_MINUTES,
            ),
        )
        return cur.fetchone() is not None


def _structuring_check(user_id: str, amount: Decimal, daily_limit: Decimal) -> bool:
    """Return True if amount is suspiciously close to the daily limit."""
    return amount >= daily_limit * Decimal(str(_STRUCTURING_RATIO))


def _log_fraud_event(
    user_id: str,
    recipient_id: str,
    amount: Decimal,
    risk_score: int,
    action: str,
    rules: list[str],
) -> None:
    with closing(_get_conn()) as conn, conn.cursor() as cur:
        import uuid
        cur.execute(
            """
            INSERT INTO fraud_events
                (id, user_id, recipient_id, amount, risk_score, action, rules_triggered)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                str(uuid.uuid4()),
                user_id,
                recipient_id,
                float(amount),
                risk_score,
                action,
                rules,
            ),
        )
        conn.commit()


def check_p2p_transfer(
    sender_id: str,
    recipient_id: str,
    amount: Decimal,
    *,
    notify_admin_user_id: str | None = None,
) -> FraudResult:
    """
    Run all fraud rules and return a FraudResult.
    Also logs the event and blocks the user if risk_score >= 70.
    """
    score = 0
    rules: list[str] = []

    # R0: blocked accounts
    if _is_blocked(sender_id):
        return FraudResult("block", 100, ["sender_blocked"], "Compte expéditeur bloqué")
    if _is_blocked(recipient_id):
        return FraudResult("block", 100, ["recipient_blocked"], "Compte destinataire bloqué")

    sender_kyc = _kyc_level(sender_id)
    daily_limit = _KYC_DAILY_LIMITS.get(sender_kyc, _KYC_DAILY_LIMITS[0])
    hourly_max = _KYC_HOURLY_MAX_TX.get(sender_kyc, _KYC_HOURLY_MAX_TX[0])

    # R1: new account — extra low limits
    sender_age = _account_age_days(sender_id)
    if sender_age < _NEW_ACCOUNT_DAYS:
        if amount > _NEW_ACCOUNT_MAX:
            score += 60
            rules.append(f"new_account_limit_exceeded (age={sender_age}d)")
        else:
            score += 10
            rules.append(f"new_account_low_risk (age={sender_age}d)")

    # R2: daily amount limit
    spent_today = _daily_sent(sender_id)
    if spent_today + amount > daily_limit:
        score += 50
        rules.append(f"daily_limit_exceeded ({float(spent_today + amount):.0f}/{float(daily_limit):.0f} FCFA)")
    elif spent_today + amount > daily_limit * Decimal("0.8"):
        score += 15
        rules.append("daily_limit_near_80pct")

    # R3: hourly velocity
    tx_count = _hourly_tx_count(sender_id)
    if tx_count >= hourly_max:
        score += 40
        rules.append(f"hourly_velocity_exceeded ({tx_count}/{hourly_max} tx/h)")
    elif tx_count >= hourly_max * 0.7:
        score += 10
        rules.append("hourly_velocity_near_limit")

    # R4: fan-out (sending to many distinct people quickly)
    distinct = _hourly_distinct_recipients(sender_id)
    if distinct >= _FAN_OUT_RECIPIENTS:
        score += 35
        rules.append(f"fan_out_pattern ({distinct} recipients/h)")

    # R5: round-trip detection
    if _round_trip_exists(sender_id, recipient_id, amount):
        score += 45
        rules.append("round_trip_pattern")

    # R6: structuring (amount suspiciously close to daily limit)
    if _structuring_check(sender_id, amount, daily_limit):
        score += 20
        rules.append("structuring_suspicion")

    # R7: no KYC + large amount
    if sender_kyc == 0 and amount > Decimal("20000"):
        score += 15
        rules.append("no_kyc_large_amount")

    # R8: new recipient (joined < 24h)
    recipient_age = _account_age_days(recipient_id)
    if recipient_age == 0:
        score += 20
        rules.append("recipient_very_new_account")

    score = min(score, 100)

    if score >= 70:
        action = "block"
        reason = f"Transaction bloquée (score de risque: {score}/100). Règles: {', '.join(rules)}"
        try:
            _log_fraud_event(sender_id, recipient_id, amount, score, action, rules)
        except Exception:
            pass
        # Notify sender
        try:
            create_notification(
                sender_id,
                "transfer_blocked",
                "Transaction bloquée",
                f"Votre transfert de {float(amount):,.0f} FCFA a été bloqué pour raison de sécurité.",
                {"amount": float(amount), "risk_score": score},
            )
        except Exception:
            pass
        # Notify admin
        notify_admin(
            f"[FRAUDE] Transaction frauduleuse bloquée (score {score}/100)",
            f"<b>Expéditeur ID :</b> {sender_id}<br>"
            f"<b>Destinataire ID :</b> {recipient_id}<br>"
            f"<b>Montant :</b> {float(amount):,.0f} FCFA<br>"
            f"<b>Score de risque :</b> {score}/100<br>"
            f"<b>Règles déclenchées :</b> {', '.join(rules)}<br><br>"
            f"La transaction a été bloquée automatiquement. Vérifiez si le compte doit être suspendu.",
        )
        return FraudResult(action, score, rules, reason)

    if score >= 40:
        action = "warn"
        try:
            _log_fraud_event(sender_id, recipient_id, amount, score, action, rules)
        except Exception:
            pass
        return FraudResult(action, score, rules)

    return FraudResult("approve", score, rules)
