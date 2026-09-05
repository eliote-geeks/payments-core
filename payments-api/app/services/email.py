from __future__ import annotations

import smtplib
import ssl
from datetime import timezone
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings

_ICON_OK   = '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:#22C55E;border-radius:50%;color:#fff;font-size:16px;font-weight:700;vertical-align:middle;">&#10003;</span>'
_ICON_FAIL = '<span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:#EF4444;border-radius:50%;color:#fff;font-size:15px;font-weight:700;vertical-align:middle;">&#10005;</span>'
_ICON_BELL = '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:rgba(255,255,255,0.2);border-radius:50%;color:#fff;font-size:13px;vertical-align:middle;">&#9679;</span>'
_ICON_INFO = '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;background:rgba(255,255,255,0.2);border-radius:50%;color:#fff;font-size:12px;font-weight:700;vertical-align:middle;">i</span>'


def _smtp_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def send_email(to: str, subject: str, html: str, plain: str = "") -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"Kobo <{settings.smtp_from}>"
    msg["To"] = to
    if plain:
        msg.attach(MIMEText(plain, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))
    with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=_smtp_ctx(), timeout=10) as s:
        s.login(settings.smtp_user, settings.smtp_password)
        s.sendmail(settings.smtp_from, [to], msg.as_string())


def _admin_html(subject: str, body: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    return f"""<!DOCTYPE html><html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0F4FF;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4FF;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(59,91,246,0.10);">
  <tr><td style="background:#3B5BF6;padding:20px 32px;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="padding-right:10px;">{_ICON_BELL}</td>
      <td><p style="margin:0;color:#fff;font-size:18px;font-weight:800;">Kobo Ops &mdash; Notification Admin</p></td>
    </tr></table>
    <p style="margin:6px 0 0;color:rgba(255,255,255,0.7);font-size:12px;">koboonline.com &middot; {ts}</p>
  </td></tr>
  <tr><td style="background:#fff;padding:28px 32px;">
    <p style="margin:0;font-size:15px;color:#111;line-height:1.7;">{body}</p>
  </td></tr>
  <tr><td style="background:#F8F9FE;padding:14px 32px;border-top:1px solid #E8ECFF;text-align:center;">
    <a href="https://koboonline.com/k-ops" style="color:#3B5BF6;text-decoration:none;font-size:11px;">Ouvrir le panel admin</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


def notify_admin(subject: str, body: str) -> None:
    try:
        html = _admin_html(subject, body)
        send_email(settings.admin_email, f"[Kobo Admin] {subject}", html, body)
    except Exception:
        pass


def _user_html(title: str, body: str, success: bool = True) -> str:
    ts = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M UTC")
    icon = _ICON_OK if success else _ICON_FAIL
    bar_color = "#22C55E" if success else "#EF4444"
    return f"""<!DOCTYPE html><html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F0F4FF;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F4FF;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(59,91,246,0.10);">
  <tr><td style="background:#3B5BF6;padding:20px 32px;">
    <p style="margin:0;color:#fff;font-size:20px;font-weight:800;letter-spacing:-0.5px;">Kobo</p>
    <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:12px;">koboonline.com &middot; {ts}</p>
  </td></tr>
  <tr><td style="background:{bar_color};height:4px;padding:0;"></td></tr>
  <tr><td style="background:#fff;padding:28px 32px;">
    <table cellpadding="0" cellspacing="0" style="margin-bottom:16px;"><tr>
      <td style="padding-right:12px;">{icon}</td>
      <td><p style="margin:0;font-size:18px;font-weight:700;color:#111;">{title}</p></td>
    </tr></table>
    <p style="margin:0;font-size:14px;color:#444;line-height:1.7;">{body}</p>
  </td></tr>
  <tr><td style="background:#F8F9FE;padding:16px 32px;text-align:center;border-top:1px solid #E8ECFF;">
    <a href="https://koboonline.com" style="display:inline-block;background:#3B5BF6;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 28px;border-radius:8px;">Ouvrir Kobo</a>
  </td></tr>
  <tr><td style="background:#F8F9FE;padding:10px 32px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9CA3AF;">Questions ? <a href="mailto:service@koboonline.com" style="color:#3B5BF6;text-decoration:none;">service@koboonline.com</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>"""


def notify_user(user_id: str, subject: str, body_html: str, success: bool = True) -> None:
    """Send an email to a user. Looks up their email from DB. Never crashes."""
    try:
        from app.db.session import get_conn
        from contextlib import closing
        import psycopg.rows
        with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
            cur.execute("SELECT email, phone_e164 FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
        if not row:
            return
        to = row.get("email") or row.get("phone_e164") or ""
        if not to or "@" not in to:
            return
        html = _user_html(subject, body_html, success=success)
        send_email(to, f"Kobo — {subject}", html, body_html.replace("<br>", "\n").replace("<b>", "").replace("</b>", ""))
    except Exception:
        pass
