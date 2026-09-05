
from contextlib import closing

from fastapi import APIRouter

import psycopg
from app.db.session import get_conn
from app.services.dependencies import payment_stack_dependencies

router = APIRouter(tags=["health"])

_SERVICE_STATUS_DEFAULTS = {
    "withdrawals_enabled": True,
    "deposits_enabled": True,
    "withdrawals_message": "",
    "deposits_message": "",
}


@router.get("/")
async def root() -> dict:
    return {"service": "payments-api", "version": "0.3.0", "status": "ok"}


@router.get("/health")
async def health() -> dict:
    with closing(get_conn()) as conn, conn.cursor() as cur:
        cur.execute("SELECT 1")
        cur.fetchone()
    dependencies = await payment_stack_dependencies()
    db_status = {"name": "payments_db", "ok": True, "status_code": 200}
    return {"status": "ok", "dependencies": [db_status, *dependencies.values()]}


@router.get("/actuator/health")
async def actuator_health() -> dict:
    return await health()


@router.get("/service-status")
async def get_service_status() -> dict:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT value FROM app_settings WHERE key = 'service_status' LIMIT 1")
        row = cur.fetchone()
    if row and isinstance(row["value"], dict):
        return {**_SERVICE_STATUS_DEFAULTS, **row["value"]}
    return {**_SERVICE_STATUS_DEFAULTS}
