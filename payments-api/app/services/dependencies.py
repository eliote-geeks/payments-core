from typing import Any

import httpx
from app.core.config import settings


async def fetch_json(url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


async def probe_dependency(name: str, url: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
            response = await client.get(url)
            return {
                "name": name,
                "ok": response.is_success,
                "status_code": response.status_code,
                "url": url,
            }
    except Exception as exc:
        return {"name": name, "ok": False, "status_code": None, "url": url, "error": str(exc)}


async def payment_stack_dependencies() -> dict[str, dict[str, Any]]:
    return {
        "hyperswitch": await probe_dependency(
            "hyperswitch", f"{settings.hyperswitch_base_url}/health"
        ),
        "stellar_sep": await probe_dependency(
            "stellar_sep", f"{settings.stellar_sep_base_url}/.well-known/stellar.toml"
        ),
        "anchor_ref": await probe_dependency("anchor_ref", f"{settings.anchor_ref_base_url}/"),
    }
