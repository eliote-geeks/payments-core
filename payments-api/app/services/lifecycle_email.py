from __future__ import annotations

import html
import secrets
import time
import uuid
from contextlib import closing
from dataclasses import dataclass
from typing import Any

import psycopg

from app.db.session import get_conn
from app.services.email import send_email

BASE_URL = "https://koboonline.com"
API_URL = "https://pay-api.koboonline.com"
SUPPORT_EMAIL = "service@koboonline.com"


@dataclass(frozen=True)
class LifecycleTemplate:
    key: str
    subject: str
    title: str
    intro: str
    bullets: tuple[str, ...]
    cta_label: str = "Ouvrir mon espace Kobo"
    cta_url: str = BASE_URL


TEMPLATES: dict[str, LifecycleTemplate] = {
    "welcome_activation": LifecycleTemplate(
        key="welcome_activation",
        subject="Votre espace Kobo est prêt",
        title="Votre espace Kobo est prêt",
        intro="Votre compte Kobo vous permet de gérer vos paiements et transferts depuis un seul espace sécurisé.",
        bullets=(
            "Ajoutez ou vérifiez vos informations pour sécuriser vos opérations.",
            "Effectuez vos dépôts, retraits et transferts depuis votre tableau de bord.",
            "Gardez votre PIN confidentiel : Kobo ne vous le demandera jamais par email.",
        ),
    ),
    "first_deposit_help": LifecycleTemplate(
        key="first_deposit_help",
        subject="Votre premier dépôt Kobo en quelques étapes",
        title="Votre premier dépôt Kobo en quelques étapes",
        intro="Votre compte est actif. Vous pouvez alimenter votre portefeuille FCFA quand vous êtes prêt.",
        bullets=(
            "Choisissez le moyen de dépôt disponible sur votre compte.",
            "Vérifiez le montant reçu après frais avant de confirmer.",
            "Vous recevez une notification dès que l'opération est traitée.",
        ),
        cta_url=f"{BASE_URL}/fiat-deposit",
    ),
    "kyc_pending": LifecycleTemplate(
        key="kyc_pending",
        subject="Finalisez la vérification de votre compte Kobo",
        title="Finalisez la vérification de votre compte Kobo",
        intro="La vérification de compte aide à protéger vos fonds et à maintenir vos limites de transaction.",
        bullets=(
            "Préparez une pièce d'identité valide et des informations exactes.",
            "Votre dossier est revu depuis l'espace Kobo.",
            "Une notification vous informe dès que la vérification est mise à jour.",
        ),
        cta_url=f"{BASE_URL}/kyc",
    ),
    "dormant_30d": LifecycleTemplate(
        key="dormant_30d",
        subject="Kobo reste disponible pour vos prochaines opérations",
        title="Kobo reste disponible pour vos prochaines opérations",
        intro="Nous gardons votre espace prêt pour vos paiements, dépôts, retraits et transferts.",
        bullets=(
            "Consultez votre solde et l'historique avant toute nouvelle opération.",
            "Utilisez les liens de paiement si vous devez recevoir de l'argent rapidement.",
            "Contactez le support si un mouvement ne correspond pas à vos attentes.",
        ),
    ),
    "security_reminder": LifecycleTemplate(
        key="security_reminder",
        subject="Rappel sécurité pour votre compte Kobo",
        title="Rappel sécurité pour votre compte Kobo",
        intro="Quelques habitudes simples renforcent la protection de votre portefeuille Kobo.",
        bullets=(
            "Ne partagez jamais votre PIN, vos codes OTP ou vos accès de connexion.",
            "Utilisez uniquement koboonline.com pour vos opérations Kobo.",
            "Signalez immédiatement toute activité inhabituelle au support.",
        ),
        cta_url=f"{BASE_URL}/wallet",
    ),
}


def _display_name(row: dict[str, Any]) -> str:
    profile = row.get("profile") or {}
    if not isinstance(profile, dict):
        return ""
    return (profile.get("fullName") or profile.get("full_name") or profile.get("name") or "").strip()


def ensure_email_preferences(cur, user_id: str) -> str:
    cur.execute("SELECT unsubscribe_token FROM email_preferences WHERE user_id=%s LIMIT 1", (user_id,))
    row = cur.fetchone()
    if row and row.get("unsubscribe_token"):
        return row["unsubscribe_token"]
    token = secrets.token_urlsafe(32)
    cur.execute(
        """
        INSERT INTO email_preferences (user_id, unsubscribe_token, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET unsubscribe_token=COALESCE(email_preferences.unsubscribe_token, EXCLUDED.unsubscribe_token), updated_at=NOW()
        RETURNING unsubscribe_token
        """,
        (user_id, token),
    )
    saved = cur.fetchone()
    return saved["unsubscribe_token"] if saved else token


def render_lifecycle_email(template_key: str, recipient: dict[str, Any] | None = None, unsubscribe_token: str = "") -> tuple[str, str, str]:
    tpl = TEMPLATES[template_key]
    recipient = recipient or {}
    name = _display_name(recipient)
    greeting = f"Bonjour {html.escape(name)}," if name else "Bonjour,"
    bullets = "".join(f"<li style='margin:8px 0;color:#374151;line-height:1.55;'>{html.escape(item)}</li>" for item in tpl.bullets)
    unsub = f"{API_URL}/email/unsubscribe?token={html.escape(unsubscribe_token)}" if unsubscribe_token else "#"
    html_body = f"""<!DOCTYPE html><html lang='fr'>
<head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>
<body style='margin:0;padding:0;background:#eef2ff;font-family:Arial,Helvetica,sans-serif;color:#111827;'>
<table width='100%' cellpadding='0' cellspacing='0' style='background:#eef2ff;padding:28px 14px;'>
<tr><td align='center'>
<table width='100%' cellpadding='0' cellspacing='0' style='max-width:580px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe3f0;'>
<tr><td style='background:#1f4bf2;padding:22px 26px;'>
  <div style='font-size:22px;font-weight:800;color:#fff;'>Kobo</div>
  <div style='font-size:12px;color:#dbe7ff;margin-top:4px;'>Portefeuille, paiements et transferts sécurisés</div>
</td></tr>
<tr><td style='padding:28px 26px 10px;'>
  <div style='font-size:13px;color:#64748b;margin-bottom:8px;'>{greeting}</div>
  <h1 style='font-size:22px;line-height:1.25;margin:0 0 12px;color:#0f172a;'>{html.escape(tpl.title)}</h1>
  <p style='font-size:15px;line-height:1.65;margin:0 0 16px;color:#334155;'>{html.escape(tpl.intro)}</p>
  <ul style='padding-left:20px;margin:0 0 22px;'>{bullets}</ul>
  <a href='{html.escape(tpl.cta_url)}' style='display:inline-block;background:#1f4bf2;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-size:14px;font-weight:700;'>{html.escape(tpl.cta_label)}</a>
</td></tr>
<tr><td style='padding:18px 26px 24px;'>
  <div style='background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;color:#475569;font-size:13px;line-height:1.55;'>
    Pour votre sécurité, Kobo ne demande jamais votre PIN, votre mot de passe ou votre code OTP par email. En cas de doute, contactez <a href='mailto:{SUPPORT_EMAIL}' style='color:#1f4bf2;text-decoration:none;'>{SUPPORT_EMAIL}</a>.
  </div>
</td></tr>
<tr><td style='background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 26px;text-align:center;color:#64748b;font-size:11px;line-height:1.5;'>
  KoboOnline, Cameroun. Vous recevez cet email car vous avez créé un compte Kobo.<br>
  <a href='{unsub}' style='color:#64748b;'>Ne plus recevoir ces emails relationnels</a>
</td></tr>
</table>
</td></tr></table>
</body></html>"""
    plain = f"{greeting}\n\n{tpl.title}\n{tpl.intro}\n\n" + "\n".join(f"- {b}" for b in tpl.bullets) + f"\n\nOuvrir Kobo: {tpl.cta_url}\nDésinscription: {unsub}\n"
    return tpl.subject, html_body, plain


def available_campaigns() -> list[dict[str, str]]:
    return [{"key": t.key, "subject": t.subject, "title": t.title} for t in TEMPLATES.values()]


def get_recipients(segment: str, limit: int = 500) -> list[dict[str, Any]]:
    segment = segment or "all_active"
    limit = max(1, min(int(limit or 500), 2000))
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        base = """
            SELECT DISTINCT u.id, u.email, u.phone_e164, u.profile
            FROM users u
            LEFT JOIN email_preferences ep ON ep.user_id = u.id
            WHERE u.email IS NOT NULL AND u.email LIKE '%%@%%'
              AND COALESCE(u.is_blocked, FALSE) = FALSE
              AND u.id <> 'sys_kobo_platform'
              AND COALESCE(ep.marketing_opt_out, FALSE) = FALSE
        """
        if segment == "kyc_pending":
            sql = base + """
              AND NOT EXISTS (SELECT 1 FROM kyc_profiles kp WHERE kp.user_id=u.id AND kp.status='approved')
              AND u.created_at <= NOW() - INTERVAL '2 days'
            """
        elif segment == "no_first_deposit":
            sql = base + """
              AND u.created_at <= NOW() - INTERVAL '2 days'
              AND NOT EXISTS (
                SELECT 1 FROM wallet_transactions wt
                WHERE wt.user_id=u.id AND wt.status='completed' AND wt.direction='credit'
                  AND wt.category IN ('fiat_deposit','crypto_deposit','payment_link','p2p')
              )
            """
        elif segment == "dormant_30d":
            sql = base + """
              AND COALESCE((SELECT MAX(wt.created_at) FROM wallet_transactions wt WHERE wt.user_id=u.id), u.created_at) <= NOW() - INTERVAL '30 days'
            """
        elif segment == "active_30d":
            sql = base + """
              AND EXISTS (SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.last_seen_at >= NOW() - INTERVAL '30 days')
            """
        else:
            sql = base
        sql += " ORDER BY u.id LIMIT %s"
        cur.execute(sql, (limit,))
        return list(cur.fetchall() or [])


def send_campaign(*, campaign_key: str, segment: str, actor: str = "system", test_email: str = "", limit: int = 500, dry_run: bool = False) -> dict[str, Any]:
    if campaign_key not in TEMPLATES:
        raise ValueError("unknown_campaign")
    recipients = get_recipients(segment, limit=limit)
    if test_email:
        recipients = [{"id": "test", "email": test_email, "phone_e164": "", "profile": {"fullName": "Test Kobo"}}]
    if dry_run:
        return {"campaign_key": campaign_key, "segment": segment, "targeted": len(recipients), "sent": 0, "failed": 0, "dry_run": True}

    campaign_id = f"emc_{uuid.uuid4().hex[:16]}"
    sent = 0
    failed = 0
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO email_campaigns (id, campaign_key, subject, segment, status, total_targeted, created_by, started_at, created_at)
            VALUES (%s, %s, %s, %s, 'running', %s, %s, NOW(), NOW())
            """,
            (campaign_id, campaign_key, TEMPLATES[campaign_key].subject, segment, len(recipients), actor),
        )
        conn.commit()

    for row in recipients:
        email = row.get("email") or ""
        user_id = row.get("id") or ""
        try:
            with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                token = ensure_email_preferences(cur, user_id) if user_id != "test" else secrets.token_urlsafe(24)
                if user_id != "test":
                    cur.execute(
                        """
                        SELECT 1 FROM email_campaign_deliveries d
                        WHERE d.user_id=%s AND d.status='sent' AND d.sent_at >= NOW() - INTERVAL '7 days'
                        LIMIT 1
                        """,
                        (user_id,),
                    )
                    if cur.fetchone():
                        conn.rollback()
                        continue
                subject, html_body, plain = render_lifecycle_email(campaign_key, row, token)
                send_email(email, f"Kobo — {subject}", html_body, plain)
                cur.execute(
                    """
                    INSERT INTO email_campaign_deliveries (id, campaign_id, user_id, email, status, sent_at, created_at)
                    VALUES (%s, %s, %s, %s, 'sent', NOW(), NOW())
                    """,
                    (f"emd_{uuid.uuid4().hex[:16]}", campaign_id, None if user_id == "test" else user_id, email),
                )
                if user_id != "test":
                    cur.execute(
                        """
                        INSERT INTO email_automation_state (user_id, campaign_key, last_sent_at)
                        VALUES (%s, %s, NOW())
                        ON CONFLICT (user_id, campaign_key) DO UPDATE SET last_sent_at=NOW()
                        """,
                        (user_id,),
                    )
                conn.commit()
            sent += 1
            time.sleep(0.15)
        except Exception as exc:
            failed += 1
            with closing(get_conn()) as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO email_campaign_deliveries (id, campaign_id, user_id, email, status, error, created_at)
                    VALUES (%s, %s, %s, %s, 'failed', %s, NOW())
                    """,
                    (f"emd_{uuid.uuid4().hex[:16]}", campaign_id, None if user_id == "test" else user_id, email, str(exc)[:500]),
                )
                conn.commit()

    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE email_campaigns
            SET status='completed', completed_at=NOW(), total_sent=%s, total_failed=%s
            WHERE id=%s
            """,
            (sent, failed, campaign_id),
        )
        conn.commit()
    return {"id": campaign_id, "campaign_key": campaign_key, "segment": segment, "targeted": len(recipients), "sent": sent, "failed": failed, "dry_run": False}


def run_automatic_lifecycle(max_total: int = 50) -> dict[str, Any]:
    plan = [
        ("kyc_pending", "kyc_pending"),
        ("first_deposit_help", "no_first_deposit"),
        ("dormant_30d", "dormant_30d"),
        ("security_reminder", "all_active"),
    ]
    remaining = max(1, int(max_total or 50))
    results = []
    for campaign_key, segment in plan:
        if remaining <= 0:
            break
        result = send_campaign(campaign_key=campaign_key, segment=segment, actor="automation", limit=remaining, dry_run=False)
        results.append(result)
        remaining -= int(result.get("sent") or 0)
    return {"ok": True, "max_total": max_total, "results": results}


def unsubscribe_by_token(token: str) -> bool:
    if not token or len(token) < 16:
        return False
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE email_preferences
            SET marketing_opt_out=TRUE, unsubscribed_at=NOW(), updated_at=NOW()
            WHERE unsubscribe_token=%s
            """,
            (token,),
        )
        ok = cur.rowcount > 0
        conn.commit()
        return ok


def list_campaigns(limit: int = 50) -> list[dict[str, Any]]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT id, campaign_key, subject, segment, status, total_targeted, total_sent, total_failed,
                   created_by, created_at, started_at, completed_at
            FROM email_campaigns
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (max(1, min(int(limit or 50), 200)),),
        )
        return list(cur.fetchall() or [])


def get_automation_settings() -> dict[str, Any]:
    defaults = {"enabled": False, "daily_cap": 50, "interval_seconds": 86400}
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key='email_automation' LIMIT 1")
        row = cur.fetchone()
    value = row.get("value") if row else {}
    if not isinstance(value, dict):
        value = {}
    out = {**defaults, **value}
    out["enabled"] = bool(out.get("enabled"))
    out["daily_cap"] = max(1, min(int(out.get("daily_cap") or 50), 500))
    out["interval_seconds"] = max(3600, min(int(out.get("interval_seconds") or 86400), 604800))
    return out


def set_automation_settings(*, enabled: bool, daily_cap: int = 50, interval_seconds: int = 86400) -> dict[str, Any]:
    from psycopg.types.json import Json
    value = {
        "enabled": bool(enabled),
        "daily_cap": max(1, min(int(daily_cap or 50), 500)),
        "interval_seconds": max(3600, min(int(interval_seconds or 86400), 604800)),
    }
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ('email_automation', %s, NOW())
            ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
            """,
            (Json(value),),
        )
        conn.commit()
    return value
