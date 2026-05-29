from __future__ import annotations

import smtplib
import ssl
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


def _send_otp_email(to_email: str, code: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Votre code de vérification Kobo"
    msg["From"] = f"Kobo <{settings.smtp_from}>"
    msg["To"] = to_email

    text_body = (
        f"Bonjour,\n\n"
        f"Votre code de vérification Kobo est :\n\n"
        f"  {code}\n\n"
        f"Ce code expire dans {settings.otp_ttl_minutes} minutes.\n\n"
        f"Si vous n'avez pas demandé ce code, ignorez cet email.\n\n"
        f"— L'équipe Kobo"
    )

    html_body = f"""<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
  <div style="text-align:center;margin-bottom:24px">
    <span style="font-size:28px;font-weight:bold;color:#7C3AED">Kobo</span>
  </div>
  <h2 style="color:#1a1a1a">Votre code de vérification</h2>
  <p style="color:#555">Utilisez ce code pour vous connecter :</p>
  <div style="background:#f4f0ff;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
    <span style="font-size:36px;font-weight:bold;letter-spacing:12px;color:#7C3AED">{code}</span>
  </div>
  <p style="color:#888;font-size:13px">
    Ce code expire dans <strong>{settings.otp_ttl_minutes} minutes</strong>.<br>
    Si vous n'avez pas demandé ce code, ignorez cet email.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#aaa;font-size:12px;text-align:center">© 2026 Kobo · koboonline.com</p>
</body>
</html>"""

    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=ctx) as server:
        server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(settings.smtp_from, [to_email], msg.as_string())


def start_challenge(*, email: str) -> tuple[str, str | None]:
    email = email.lower().strip()
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
            (challenge_id, email, email, code_hash, expires_at, utcnow()),
        )
        conn.commit()
    if not settings.otp_dev_mode:
        _send_otp_email(email, code)
    return challenge_id, (code if settings.otp_dev_mode else None)


def verify_challenge(*, challenge_id: str, code: str) -> str:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM otp_challenges WHERE id = %s", (challenge_id,))
        row = cur.fetchone()
    if not row:
        raise ValueError("Challenge not found")
    if row["consumed_at"] is not None:
        raise ValueError("Challenge already used")
    if row["expires_at"] <= utcnow():
        raise ValueError("Challenge expired")
    if not constant_time_equals(row["code_hash"], sha256_hex(code)):
        raise ValueError("Invalid code")
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE otp_challenges SET consumed_at = %s WHERE id = %s",
            (utcnow(), challenge_id),
        )
        conn.commit()
    return row.get("email") or row["phone_e164"]
