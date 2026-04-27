
from contextlib import closing

from fastapi import APIRouter

from app.db.session import get_conn
from app.services.dependencies import payment_stack_dependencies

router = APIRouter(tags=["health"])


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
