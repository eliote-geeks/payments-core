from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.db.schema import init_db
from app.core.config import settings
from app.routers import (
    admin,
    auth,
    catalog,
    corridors,
    dev,
    health,
    kyc,
    p2p,
    quotes,
    rates,
    support,
    transfers,
    users,
    wallet,
    webhooks,
)

app = FastAPI(
    title="Payments Core API",
    version="0.3.0",
    description=(
        "Cross-border payments orchestration API for Cameroon-first "
        "multi-country corridors."
    ),
)


@app.on_event("startup")
def startup() -> None:
    init_db()


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")] if settings.cors_origins != "*" else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(wallet.router)
app.include_router(p2p.router)
app.include_router(kyc.router)
app.include_router(rates.router)
app.include_router(support.router)
app.include_router(dev.router)
app.include_router(catalog.router)
app.include_router(corridors.router)
app.include_router(quotes.router)
app.include_router(transfers.router)
app.include_router(webhooks.router)
