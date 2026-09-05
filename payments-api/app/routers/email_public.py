from __future__ import annotations

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from app.services.lifecycle_email import unsubscribe_by_token

router = APIRouter(prefix="/email", tags=["email"])


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe(token: str = Query(default="")) -> str:
    ok = unsubscribe_by_token(token)
    title = "Désinscription confirmée" if ok else "Lien invalide"
    body = "Vous ne recevrez plus les emails relationnels non essentiels de Kobo." if ok else "Ce lien de désinscription est invalide ou expiré."
    return f"""<!doctype html><html lang='fr'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{title}</title></head>
<body style='margin:0;background:#eef2ff;font-family:Arial,Helvetica,sans-serif;color:#0f172a;'>
<div style='max-width:520px;margin:80px auto;background:#fff;border:1px solid #dbe3f0;border-radius:14px;padding:28px;'>
<div style='font-size:22px;font-weight:800;color:#1f4bf2;margin-bottom:18px;'>Kobo</div>
<h1 style='font-size:24px;margin:0 0 12px;'>{title}</h1>
<p style='font-size:15px;line-height:1.6;color:#475569;margin:0 0 22px;'>{body}</p>
<a href='https://koboonline.com' style='display:inline-block;background:#1f4bf2;color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;'>Retour à Kobo</a>
</div></body></html>"""
