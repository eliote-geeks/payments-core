from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.security import AuthUser, require_user
from app.services.support import (
    add_agent_message,
    add_user_message,
    create_ticket,
    list_chat,
    list_faq,
    list_tickets,
)

router = APIRouter(prefix="/support", tags=["support"])


class TicketCreateRequest(BaseModel):
    subject: str = Field(min_length=3, max_length=140)
    message: str = Field(min_length=1, max_length=2000)


class ChatSendRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.get("/tickets")
async def tickets(user: AuthUser = Depends(require_user)) -> dict:
    items = []
    for tk in list_tickets(user.id):
        items.append(
            {
                "id": tk["id"],
                "subject": tk["subject"],
                "status": tk["status"],
                "updatedAt": tk["updated_at"].isoformat(),
            }
        )
    return {"items": items}


@router.post("/tickets")
async def create(req: TicketCreateRequest, user: AuthUser = Depends(require_user)) -> dict:
    tk = create_ticket(user.id, req.subject, req.message)
    ticket = {"id": tk["id"], "subject": tk["subject"], "status": tk["status"], "updatedAt": tk["updated_at"].isoformat()}
    return {"ticket": ticket}


@router.get("/chat")
async def chat(user: AuthUser = Depends(require_user)) -> dict:
    items = list_chat(user.id)
    out = []
    for m in items:
        out.append(
            {
                "from": "agent" if m["from_role"] == "agent" else "user",
                "name": m.get("author_name") or None,
                "text": m["body"],
                "time": m["created_at"].strftime("%H:%M"),
                "ts": m["created_at"].isoformat(),
            }
        )
    return {"items": out}


@router.post("/chat")
async def chat_send(req: ChatSendRequest, user: AuthUser = Depends(require_user)) -> dict:
    user_row = add_user_message(user.id, req.text)
    # MVP: auto-ack by agent (real flow will be ticket routing + operators)
    agent_row = add_agent_message(
        user.id,
        "Merci, je vérifie et je reviens vers vous.",
        author_name="Yasmine (Support)",
    )
    return {"ok": True}


@router.get("/faq")
async def faq() -> dict:
    return {"items": list_faq()}
