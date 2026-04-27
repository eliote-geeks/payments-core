from fastapi import FastAPI

from app.db.schema import init_db
from app.routers import catalog, corridors, health, quotes, transfers, webhooks

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


app.include_router(health.router)
app.include_router(catalog.router)
app.include_router(corridors.router)
app.include_router(quotes.router)
app.include_router(transfers.router)
app.include_router(webhooks.router)
