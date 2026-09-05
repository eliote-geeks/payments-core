from __future__ import annotations

from fastapi import APIRouter, Depends
from app.core.security import AuthUser, require_user
from app.services.notifications import (
    count_unread,
    delete_notification,
    list_notifications,
    mark_read,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def get_notifications(
    limit: int = 50,
    user: AuthUser = Depends(require_user),
) -> dict:
    items = list_notifications(user.id, limit=limit)
    unread = count_unread(user.id)
    return {"items": items, "unread": unread}


@router.post("/read-all")
async def read_all(user: AuthUser = Depends(require_user)) -> dict:
    mark_read(user.id)
    return {"ok": True}


@router.post("/{notif_id}/read")
async def read_one(notif_id: str, user: AuthUser = Depends(require_user)) -> dict:
    mark_read(user.id, notif_id)
    return {"ok": True}


@router.delete("")
async def delete_all(user: AuthUser = Depends(require_user)) -> dict:
    delete_notification(user.id)
    return {"ok": True}


@router.delete("/{notif_id}")
async def delete_one(notif_id: str, user: AuthUser = Depends(require_user)) -> dict:
    delete_notification(user.id, notif_id)
    return {"ok": True}
