import asyncio
import os
import logging

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.db.schema import init_db, init_fiat_deposits_schema, init_crypto_schema, init_mobile_money_transfers_schema, init_email_marketing_schema
from app.core.config import settings

log = logging.getLogger("fraud_cron")

_FRAUD_SCAN_INTERVAL_SECONDS = 1800  # 30 minutes
_PAYMENT_RECONCILIATION_INTERVAL_SECONDS = 300  # 5 minutes


async def _fraud_cron_loop() -> None:
    from app.services.fraud_cron import run_fraud_scan
    while True:
        await asyncio.sleep(_FRAUD_SCAN_INTERVAL_SECONDS)
        try:
            result = await asyncio.get_event_loop().run_in_executor(None, run_fraud_scan)
            log.info("Fraud cron: %s", result)
        except Exception as exc:
            log.exception("Fraud cron error: %s", exc)


async def _payment_reconciliation_loop() -> None:
    from app.services.reconciliation import run_payment_reconciliation
    while True:
        await asyncio.sleep(_PAYMENT_RECONCILIATION_INTERVAL_SECONDS)
        try:
            result = await run_payment_reconciliation()
            if any(result.values()):
                log.info("Payment reconciliation: %s", result)
        except Exception as exc:
            log.exception("Payment reconciliation error: %s", exc)


async def _email_lifecycle_loop() -> None:
    from app.services.lifecycle_email import run_automatic_lifecycle
    await asyncio.sleep(90)
    while True:
        try:
            from app.services.lifecycle_email import get_automation_settings
            automation = get_automation_settings()
            if settings.email_automation_enabled or automation.get("enabled"):
                cap = automation.get("daily_cap") or settings.email_automation_daily_cap
                result = await asyncio.get_event_loop().run_in_executor(None, run_automatic_lifecycle, cap)
                log.info("Email lifecycle automation: %s", result)
        except Exception as exc:
            log.exception("Email lifecycle automation error: %s", exc)
        try:
            wait_seconds = get_automation_settings().get("interval_seconds") or settings.email_automation_interval_seconds
        except Exception:
            wait_seconds = settings.email_automation_interval_seconds
        await asyncio.sleep(max(3600, int(wait_seconds)))

from app.routers import (
    admin,
    api_v1,
    auth,
    catalog,
    chat,
    corridors,
    crypto,
    deposits,
    email_public,
    fiat_withdrawals,
    health,
    kyc,
    mobile_money_transfers,
    notifications,
    p2p,
    payment_links,
    quotes,
    rates,
    support,
    transfers,
    users,
    wallet,
    webhooks,
)

_enable_api_docs = os.getenv("ENABLE_API_DOCS", "false").lower() in ("1", "true", "yes")

app = FastAPI(
    title="Payments Core API",
    version="0.3.0",
    description=(
        "Cross-border payments orchestration API for Cameroon-first "
        "multi-country corridors."
    ),
    docs_url="/docs" if _enable_api_docs else None,
    redoc_url="/redoc" if _enable_api_docs else None,
    openapi_url="/openapi.json" if _enable_api_docs else None,
)


@app.on_event("startup")
async def startup() -> None:
    from app.db.migrations import init_infra_tables
    init_db()
    init_fiat_deposits_schema()
    init_crypto_schema()
    init_mobile_money_transfers_schema()
    init_infra_tables()
    init_email_marketing_schema()
    asyncio.create_task(_email_lifecycle_loop())
    asyncio.create_task(_fraud_cron_loop())
    asyncio.create_task(_payment_reconciliation_loop())


_origins = (
    [o.strip() for o in settings.cors_origins.split(",")]
    if settings.cors_origins != "*"
    else ["*"]
)
# allow_credentials=True is incompatible with allow_origins=["*"] per CORS spec.
# Only enable credentials when explicit origins are configured.
app.add_middleware(
    CORSMiddleware,
    allow_credentials=_origins != ["*"],
    allow_origins=_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

if settings.enable_dev_routes:
    from app.routers import dev as dev_router
    app.include_router(dev_router.router)

app.include_router(health.router)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(wallet.router)
app.include_router(crypto.router)
app.include_router(deposits.router)
app.include_router(email_public.router)
app.include_router(fiat_withdrawals.router)
app.include_router(mobile_money_transfers.router)
app.include_router(mobile_money_transfers.admin_router)
app.include_router(p2p.router)
app.include_router(kyc.router)
app.include_router(rates.router)
app.include_router(support.router)
app.include_router(notifications.router)
app.include_router(chat.router)
app.include_router(catalog.router)
app.include_router(corridors.router)
app.include_router(quotes.router)
app.include_router(transfers.router)
app.include_router(payment_links.router)
app.include_router(webhooks.router)
app.include_router(api_v1.router)
