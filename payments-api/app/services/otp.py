from __future__ import annotations

import smtplib
import ssl
import secrets
import uuid
from contextlib import closing
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import psycopg

from app.core.config import settings
from app.core.security import constant_time_equals, sha256_hex
from app.db.session import get_conn


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _build_otp_html(code: str, ttl: int) -> str:
    digits_html = "".join(
        f'<td style="padding:0 4px;">'
        f'<div style="width:46px;height:54px;line-height:54px;text-align:center;'
        f'background:#EEF2FF;border-radius:12px;font-size:30px;font-weight:800;'
        f'color:#3B5BF6;font-family:monospace;">{d}</div></td>'
        for d in code
    )
    return f"""<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F0F4FF;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F0F4FF;padding:40px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:500px;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(59,91,246,0.12);">

  <!-- ── HEADER ── -->
  <tr>
    <td align="center" style="background:#3B5BF6;padding:36px 40px 28px;">
      <!-- Logo row -->
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="center" valign="middle" style="width:48px;height:48px;background:rgba(255,255,255,0.22);border-radius:14px;">
            <span style="color:#ffffff;font-size:26px;font-weight:900;line-height:48px;display:block;text-align:center;">💳</span>
          </td>
          <td style="padding-left:12px;" valign="middle">
            <span style="color:#FFFFFF;font-size:26px;font-weight:800;letter-spacing:-0.5px;">Kobo</span>
          </td>
        </tr>
      </table>
      <p style="color:rgba(255,255,255,0.75);margin:10px 0 0;font-size:13px;">koboonline.com &nbsp;·&nbsp; Fintech Cameroun 🇨🇲</p>
    </td>
  </tr>

  <!-- ── HERO BAND ── -->
  <tr>
    <td align="center" style="background:#2F4FE0;padding:14px 40px 18px;">
      <p style="margin:0;color:#FFFFFF;font-size:17px;font-weight:600;">🔐 Vérification de connexion</p>
    </td>
  </tr>

  <!-- ── BODY ── -->
  <tr>
    <td style="background:#FFFFFF;padding:40px 40px 32px;">
      <p style="margin:0 0 6px;font-size:24px;font-weight:700;color:#111827;">Votre code de sécurité</p>
      <p style="margin:0 0 32px;font-size:15px;color:#6B7280;line-height:1.6;">
        Utilisez ce code pour finaliser votre connexion à Kobo.&nbsp; Ne le partagez avec personne.
      </p>

      <!-- Code digits -->
      <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 28px;">
        <tr>{digits_html}</tr>
      </table>

      <!-- Expire badge -->
      <table cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 32px;">
        <tr>
          <td style="background:#FFF7ED;border-radius:30px;padding:8px 20px;">
            <span style="color:#EA580C;font-size:13px;font-weight:700;">⏰ Expire dans {ttl} minutes</span>
          </td>
        </tr>
      </table>

      <!-- Divider -->
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
        <tr><td style="border-top:1px solid #F0F0F0;font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>

      <!-- Security box -->
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="background:#FEF2F2;border-radius:14px;padding:18px 20px;">
            <p style="margin:0 0 6px;font-size:14px;color:#DC2626;font-weight:700;">Ne partagez jamais ce code</p>
            <p style="margin:0;font-size:13px;color:#7F1D1D;line-height:1.6;">
              L'équipe Kobo ne vous demandera jamais votre code OTP.
              Si vous n'avez pas initié cette connexion, ignorez cet e-mail — votre compte reste protégé.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ── FOOTER ── -->
  <tr>
    <td style="background:#F8F9FE;border-top:1px solid #E8ECFF;padding:20px 40px;text-align:center;">
      <p style="margin:0 0 4px;font-size:12px;color:#9CA3AF;">
        💙 &nbsp;<strong style="color:#3B5BF6;">Kobo</strong> &nbsp;— Fintech de confiance au Cameroun
      </p>
      <p style="margin:0;font-size:11px;color:#C4C4C4;">
        <a href="https://koboonline.com" style="color:#3B5BF6;text-decoration:none;">koboonline.com</a>
        &nbsp;·&nbsp;
        <a href="mailto:service@koboonline.com" style="color:#3B5BF6;text-decoration:none;">service@koboonline.com</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>
</body>
</html>"""


def _send_otp_email(to_email: str, code: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Kobo — Code de vérification : {code}"
    msg["From"] = f"Kobo <{settings.smtp_from}>"
    msg["To"] = to_email

    plain = (
        f"Votre code de vérification Kobo est : {code}\n\n"
        f"Ce code expire dans {settings.otp_ttl_minutes} minutes.\n"
        "Ne le partagez jamais."
    )
    msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(_build_otp_html(code, settings.otp_ttl_minutes), "html", "utf-8"))

    # Internal relay (10.42.0.1) has no valid cert for its IP — skip verification
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ctx, timeout=10) as server:
        server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(settings.smtp_from, [to_email], msg.as_string())


def _check_otp_rate_limit(identifier: str) -> None:
    """Bloque si trop de challenges OTP créés dans la dernière heure pour cet identifiant."""
    since = utcnow() - timedelta(hours=1)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT COUNT(*) FROM otp_challenges
               WHERE (email = %s OR phone_e164 = %s) AND created_at > %s""",
            (identifier, identifier, since),
        )
        row = cur.fetchone()
    count = row[0] if row else 0
    if count >= settings.otp_max_per_hour:
        raise ValueError(f"Trop de demandes. Réessayez dans une heure.")


def start_challenge(*, phone_e164: str | None = None, email: str | None = None) -> tuple[str, str | None]:
    identifier = email or phone_e164 or ""
    _check_otp_rate_limit(identifier)
    challenge_id = f"otp_{uuid.uuid4().hex[:16]}"
    expires_at = utcnow() + timedelta(minutes=settings.otp_ttl_minutes)
    code = settings.otp_dev_code if settings.otp_dev_mode else f"{uuid.uuid4().int % 1000000:06d}"
    code_hash = sha256_hex(code)
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO otp_challenges (id, phone_e164, email, code_hash, expires_at, consumed_at, created_at)
            VALUES (%s,%s,%s,%s,%s,NULL,%s)
            """,
            (challenge_id, phone_e164 or identifier, email, code_hash, expires_at, utcnow()),
        )
        conn.commit()
    if not settings.otp_dev_mode and email:
        _send_otp_email(email, code)
    return challenge_id, (code if settings.otp_dev_mode else None)


def verify_challenge(*, challenge_id: str, code: str) -> tuple[str, str]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM otp_challenges WHERE id = %s FOR UPDATE", (challenge_id,))
        row = cur.fetchone()
        if not row:
            raise ValueError("Challenge introuvable")
        if row["consumed_at"] is not None:
            raise ValueError("Challenge déjà utilisé")
        if row["expires_at"] <= utcnow():
            raise ValueError("Challenge expiré")
        if row.get("blocked_at") is not None:
            raise ValueError("Trop de tentatives incorrectes. Demandez un nouveau code.")
        if not constant_time_equals(row["code_hash"], sha256_hex(code)):
            attempts = (row.get("attempts") or 0) + 1
            if attempts >= settings.otp_max_attempts:
                cur.execute(
                    "UPDATE otp_challenges SET attempts = %s, blocked_at = %s WHERE id = %s",
                    (attempts, utcnow(), challenge_id),
                )
            else:
                cur.execute(
                    "UPDATE otp_challenges SET attempts = %s WHERE id = %s",
                    (attempts, challenge_id),
                )
            conn.commit()
            remaining = max(0, settings.otp_max_attempts - attempts)
            if remaining == 0:
                raise ValueError("Trop de tentatives incorrectes. Demandez un nouveau code.")
            raise ValueError(f"Code incorrect. {remaining} tentative{'s' if remaining > 1 else ''} restante{'s' if remaining > 1 else ''}.")
        verification_token = secrets.token_urlsafe(32)
        cur.execute(
            """
            UPDATE otp_challenges
            SET consumed_at = %s, verification_token_hash = %s
            WHERE id = %s AND consumed_at IS NULL
            """,
            (utcnow(), sha256_hex(verification_token), challenge_id),
        )
        if cur.rowcount != 1:
            raise ValueError("Challenge déjà utilisé")
        conn.commit()
    return row.get("email") or row["phone_e164"], verification_token


def consume_verification(*, challenge_id: str, verification_token: str, email: str) -> None:
    """Consume atomically the one-time proof issued after a valid OTP."""
    token_hash = sha256_hex(verification_token)
    normalized_email = email.lower().strip()
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE otp_challenges
            SET verification_used_at = %s
            WHERE id = %s
              AND LOWER(COALESCE(email, phone_e164)) = %s
              AND verification_token_hash = %s
              AND consumed_at IS NOT NULL
              AND verification_used_at IS NULL
              AND expires_at > %s
            """,
            (utcnow(), challenge_id, normalized_email, token_hash, utcnow()),
        )
        if cur.rowcount != 1:
            raise ValueError("Vérification expirée ou déjà utilisée")
        conn.commit()
