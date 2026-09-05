from __future__ import annotations

from contextlib import closing
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any

import psycopg
from fastapi import HTTPException

from app.core.time import utcnow
from app.db.session import get_conn


DEFAULT_COMPLIANCE_RULES: list[dict[str, Any]] = [
    {
        "country": "CA", "name": "Canada", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 3000000, "daily_limit_fcfa": 6000000, "monthly_limit_fcfa": 30000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 1000000, "reporting_threshold_fcfa": 4000000,
        "notes": "Verifier exposition MSB/FMSB FINTRAC, RPAA/Bank of Canada, sanctions et declarations crypto importantes.",
    },
    {
        "country": "US", "name": "United States", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 3000000, "daily_limit_fcfa": 6000000, "monthly_limit_fcfa": 30000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 1000000, "reporting_threshold_fcfa": 4000000,
        "notes": "Verifier FinCEN MSB, licences money transmitter par Etat et OFAC.",
    },
    {
        "country": "CM", "name": "Cameroun", "status": "active", "kyc_min_level": 1,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 500000, "reporting_threshold_fcfa": 5000000,
        "notes": "Regles CEMAC/BEAC/AML a confirmer par conseil local.",
    },
    {
        "country": "GA", "name": "Gabon", "status": "active", "kyc_min_level": 1,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 500000, "reporting_threshold_fcfa": 5000000,
        "notes": "Pays couvert BGFI. Regles CEMAC/BEAC/AML a confirmer par conseil local.",
    },
    {
        "country": "CG", "name": "Congo", "status": "active", "kyc_min_level": 1,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 500000, "reporting_threshold_fcfa": 5000000,
        "notes": "Pays couvert BGFI. Regles CEMAC/BEAC/AML a confirmer par conseil local.",
    },
    {
        "country": "CD", "name": "RDC", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 250000, "reporting_threshold_fcfa": 5000000,
        "notes": "Pays couvert BGFI. Revue AML renforcée requise.",
    },
    {
        "country": "GQ", "name": "Guinee equatoriale", "status": "active", "kyc_min_level": 1,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 500000, "reporting_threshold_fcfa": 5000000,
        "notes": "Pays couvert BGFI. Regles CEMAC/BEAC/AML a confirmer par conseil local.",
    },
    {
        "country": "BJ", "name": "Benin", "status": "active", "kyc_min_level": 1,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 500000, "reporting_threshold_fcfa": 5000000,
        "notes": "Pays couvert BGFI. Regles UEMOA/BCEAO/AML a confirmer par conseil local.",
    },
    {
        "country": "CI", "name": "Cote d'Ivoire", "status": "active", "kyc_min_level": 1,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 500000, "reporting_threshold_fcfa": 5000000,
        "notes": "Pays couvert BGFI. Regles UEMOA/BCEAO/AML a confirmer par conseil local.",
    },
    {
        "country": "CF", "name": "Centrafrique", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 250000, "reporting_threshold_fcfa": 5000000,
        "notes": "Pays couvert BGFI. Revue AML renforcée requise.",
    },
    {
        "country": "MG", "name": "Madagascar", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 250000, "reporting_threshold_fcfa": 5000000,
        "notes": "Pays couvert BGFI. Revue AML renforcée requise.",
    },
    {
        "country": "ST", "name": "Sao Tome-et-Principe", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 1000000, "daily_limit_fcfa": 3000000, "monthly_limit_fcfa": 10000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 250000, "reporting_threshold_fcfa": 5000000,
        "notes": "Pays couvert BGFI. Revue AML renforcée requise.",
    },
    {
        "country": "FR", "name": "France", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 3000000, "daily_limit_fcfa": 6000000, "monthly_limit_fcfa": 30000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 1000000, "reporting_threshold_fcfa": 4000000,
        "notes": "Pays BGFI Europe et cadre crypto MiCA/UE. Revue conformite requise.",
    },
    {
        "country": "GB", "name": "Royaume-Uni", "status": "manual_review", "kyc_min_level": 2,
        "single_limit_fcfa": 3000000, "daily_limit_fcfa": 6000000, "monthly_limit_fcfa": 30000000,
        "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
        "manual_review_above_fcfa": 1000000, "reporting_threshold_fcfa": 4000000,
        "notes": "Pays crypto avec revue AML/sanctions requise.",
    },
    *[
        {
            "country": code, "name": name, "status": "manual_review", "kyc_min_level": 2,
            "single_limit_fcfa": 2000000, "daily_limit_fcfa": 4000000, "monthly_limit_fcfa": 20000000,
            "crypto_allowed": True, "fiat_allowed": True, "p2p_allowed": True, "intl_allowed": True,
            "manual_review_above_fcfa": 500000, "reporting_threshold_fcfa": 4000000,
            "notes": "Pays ajoute pour couverture crypto. Revue conformite obligatoire par defaut.",
        }
        for code, name in [
            ("SN", "Senegal"), ("NG", "Nigeria"), ("ZA", "Afrique du Sud"),
            ("KE", "Kenya"), ("GH", "Ghana"), ("RW", "Rwanda"),
            ("MA", "Maroc"), ("UG", "Ouganda"), ("TZ", "Tanzanie"),
            ("BW", "Botswana"), ("NA", "Namibie"), ("SC", "Seychelles"),
            ("ET", "Ethiopie"),
        ]
    ],
]

FLOW_LABELS = {
    "fiat": "fiat",
    "p2p": "P2P",
    "intl": "transfert international",
    "crypto": "crypto",
}


@dataclass
class ComplianceResult:
    decision: str
    reasons: list[str]
    rule: dict[str, Any] | None
    country: str
    kyc_level: int
    daily_total_fcfa: Decimal
    monthly_total_fcfa: Decimal

    @property
    def review_required(self) -> bool:
        return self.decision == "allow_with_review"

    def as_metadata(self) -> dict[str, Any]:
        return {
            "decision": self.decision,
            "reasons": self.reasons,
            "country": self.country,
            "kyc_level": self.kyc_level,
            "daily_total_fcfa": float(self.daily_total_fcfa),
            "monthly_total_fcfa": float(self.monthly_total_fcfa),
        }


def normalize_compliance_rule(rule: dict[str, Any]) -> dict[str, Any]:
    out = dict(rule)
    out["country"] = str(out.get("country", "")).upper()
    out["status"] = out.get("status") or "manual_review"
    out["kyc_min_level"] = int(out.get("kyc_min_level") or 0)
    for key in ("single_limit_fcfa", "daily_limit_fcfa", "monthly_limit_fcfa", "manual_review_above_fcfa", "reporting_threshold_fcfa"):
        out[key] = float(out.get(key) or 0)
    for key in ("crypto_allowed", "fiat_allowed", "p2p_allowed", "intl_allowed"):
        out[key] = bool(out.get(key, True))
    return out


def load_compliance_rules(cur: psycopg.Cursor) -> list[dict[str, Any]]:
    cur.execute("SELECT value FROM app_settings WHERE key='country_compliance_rules' LIMIT 1")
    row = cur.fetchone()
    value = row[0] if row and not isinstance(row, dict) else (row.get("value") if row else None)
    rules = value or DEFAULT_COMPLIANCE_RULES
    if not isinstance(rules, list):
        rules = DEFAULT_COMPLIANCE_RULES
    return [normalize_compliance_rule(r) for r in rules]


def _user_context(cur: psycopg.Cursor, user_id: str) -> tuple[str, int]:
    cur.execute(
        """SELECT u.profile, COALESCE(kp.level, (u.profile->>'kycLevel')::int, 0) AS kyc_level
           FROM users u
           LEFT JOIN kyc_profiles kp ON kp.user_id = u.id
           WHERE u.id = %s
           LIMIT 1""",
        (user_id,),
    )
    row = cur.fetchone()
    if not row:
        return "", 0
    profile = row["profile"] if isinstance(row, dict) else row[0]
    kyc_level = row["kyc_level"] if isinstance(row, dict) else row[1]
    profile = profile or {}
    return str(profile.get("country") or "").upper(), int(kyc_level or 0)


def _period_total(cur: psycopg.Cursor, user_id: str, since, flow: str) -> Decimal:
    categories = {
        "fiat": ("fiat_deposit", "fiat_withdrawal", "fiat_withdrawal_refund", "payment_link"),
        "p2p": ("p2p",),
        "crypto": ("crypto_deposit", "crypto_withdraw", "payment_link"),
        "intl": ("intl_transfer", "transfer"),
    }.get(flow, ())
    if not categories:
        return Decimal("0")
    cur.execute(
        """SELECT COALESCE(SUM(amount), 0) AS total
           FROM wallet_transactions
           WHERE user_id = %s
             AND category = ANY(%s)
             AND status = 'completed'
             AND created_at >= %s""",
        (user_id, list(categories), since),
    )
    row = cur.fetchone()
    total = row["total"] if isinstance(row, dict) else (row[0] if row else 0)
    return Decimal(str(total or 0))


def evaluate_compliance(
    *,
    user_id: str,
    amount_fcfa: Decimal,
    flow: str,
    country_override: str | None = None,
) -> ComplianceResult:
    flow = flow.lower()
    amount = Decimal(str(amount_fcfa or 0))
    now = utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = (now.replace(day=1, hour=0, minute=0, second=0, microsecond=0))
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        country, kyc_level = _user_context(cur, user_id)
        if country_override:
            country = country_override.upper()
        rules = load_compliance_rules(cur)
        rule = next((r for r in rules if r["country"] == country), None)
        daily_total = _period_total(cur, user_id, day_start, flow)
        monthly_total = _period_total(cur, user_id, month_start, flow)

    if not country:
        return ComplianceResult("require_kyc_upgrade", ["country_missing"], None, country, kyc_level, daily_total, monthly_total)
    if not rule:
        return ComplianceResult("allow_with_review", ["country_rule_missing"], None, country, kyc_level, daily_total, monthly_total)

    reasons: list[str] = []
    flow_key = f"{flow}_allowed"
    if rule.get("status") == "blocked":
        reasons.append("country_blocked")
    if rule.get("status") == "manual_review":
        reasons.append("country_manual_review")
    if flow_key in rule and not rule.get(flow_key, True):
        reasons.append(f"{flow}_not_allowed")
    if kyc_level < int(rule.get("kyc_min_level") or 0):
        reasons.append("kyc_upgrade_required")
    if Decimal(str(rule.get("single_limit_fcfa") or 0)) > 0 and amount > Decimal(str(rule.get("single_limit_fcfa") or 0)):
        reasons.append("single_limit_exceeded")
    if Decimal(str(rule.get("daily_limit_fcfa") or 0)) > 0 and daily_total + amount > Decimal(str(rule.get("daily_limit_fcfa") or 0)):
        reasons.append("daily_limit_exceeded")
    if Decimal(str(rule.get("monthly_limit_fcfa") or 0)) > 0 and monthly_total + amount > Decimal(str(rule.get("monthly_limit_fcfa") or 0)):
        reasons.append("monthly_limit_exceeded")
    if Decimal(str(rule.get("manual_review_above_fcfa") or 0)) > 0 and amount >= Decimal(str(rule.get("manual_review_above_fcfa") or 0)):
        reasons.append("amount_manual_review")
    if Decimal(str(rule.get("reporting_threshold_fcfa") or 0)) > 0 and amount >= Decimal(str(rule.get("reporting_threshold_fcfa") or 0)):
        reasons.append("reporting_required")

    if any(r in reasons for r in ("country_blocked", "single_limit_exceeded", "daily_limit_exceeded", "monthly_limit_exceeded", f"{flow}_not_allowed")):
        decision = "block"
    elif "kyc_upgrade_required" in reasons:
        decision = "require_kyc_upgrade"
    elif reasons:
        decision = "allow_with_review"
    else:
        decision = "allow"
    return ComplianceResult(decision, reasons, rule, country, kyc_level, daily_total, monthly_total)


def enforce_compliance(
    *,
    user_id: str,
    amount_fcfa: Decimal,
    flow: str,
    allow_manual_review: bool = False,
    country_override: str | None = None,
) -> ComplianceResult:
    result = evaluate_compliance(
        user_id=user_id,
        amount_fcfa=amount_fcfa,
        flow=flow,
        country_override=country_override,
    )
    label = FLOW_LABELS.get(flow, flow)
    if result.decision == "block":
        raise HTTPException(403, f"Transaction bloquee par les regles de conformite ({label}) : {', '.join(result.reasons)}")
    if result.decision == "require_kyc_upgrade":
        raise HTTPException(403, "Verification KYC requise ou pays manquant avant cette transaction.")
    if result.decision == "allow_with_review" and not allow_manual_review:
        raise HTTPException(403, f"Cette transaction exige une revue manuelle de conformite avant execution ({', '.join(result.reasons)}).")
    return result
