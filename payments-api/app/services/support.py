from __future__ import annotations

import uuid
from contextlib import closing
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.types.json import Json

from app.core.serialization import json_ready
from app.db.session import get_conn
from app.services.users import get_user_by_email


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def list_tickets(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT id, subject, status, updated_at
            FROM support_tickets
            WHERE user_id = %s
            ORDER BY updated_at DESC
            LIMIT %s
            """,
            (user_id, limit),
        )
        return cur.fetchall() or []


def create_ticket(user_id: str, subject: str, initial_message: str) -> dict[str, Any]:
    ticket_id = f"tck_{uuid.uuid4().hex[:12]}"
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO support_tickets (id, user_id, subject, status, created_at, updated_at)
            VALUES (%s,%s,%s,'open',%s,%s)
            RETURNING id, subject, status, updated_at
            """,
            (ticket_id, user_id, subject, utcnow(), utcnow()),
        )
        ticket = cur.fetchone()
        cur.execute(
            """
            INSERT INTO support_messages (id, user_id, from_role, author_name, body, created_at)
            VALUES (%s,%s,'user',NULL,%s,%s)
            """,
            (f"msg_{uuid.uuid4().hex[:14]}", user_id, initial_message, utcnow()),
        )
        conn.commit()
    return ticket


def list_chat(user_id: str, limit: int = 200) -> list[dict[str, Any]]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            SELECT from_role, author_name, body, created_at
            FROM support_messages
            WHERE user_id = %s
            ORDER BY created_at ASC
            LIMIT %s
            """,
            (user_id, limit),
        )
        return cur.fetchall() or []


def add_user_message(user_id: str, body: str) -> dict[str, Any]:
    msg_id = f"msg_{uuid.uuid4().hex[:14]}"
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO support_messages (id, user_id, from_role, author_name, body, created_at)
            VALUES (%s,%s,'user',NULL,%s,%s)
            RETURNING from_role, author_name, body, created_at
            """,
            (msg_id, user_id, body, utcnow()),
        )
        row = cur.fetchone()
        conn.commit()
    return row


def add_agent_message(user_id: str, body: str, author_name: str = "Support") -> dict[str, Any]:
    msg_id = f"msg_{uuid.uuid4().hex[:14]}"
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO support_messages (id, user_id, from_role, author_name, body, created_at)
            VALUES (%s,%s,'agent',%s,%s,%s)
            RETURNING from_role, author_name, body, created_at
            """,
            (msg_id, user_id, author_name, body, utcnow()),
        )
        row = cur.fetchone()
        conn.commit()
    return row


def create_unblock_appeal(email: str, message: str) -> str:
    """Crée un ticket de demande de déblocage pour un compte bloqué (sans auth).
    Retourne la référence du ticket (ex: tck_abc123).
    Si l'email est inconnu, on crée quand même un enregistrement pour traçabilité."""
    user = get_user_by_email(email)
    user_id = user["id"] if user else f"anon_{uuid.uuid4().hex[:12]}"

    ticket_id = f"tck_{uuid.uuid4().hex[:12]}"
    subject = "Demande de déblocage de compte"
    body = f"Email: {email}\n\n{message}"

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            """
            INSERT INTO support_tickets (id, user_id, subject, status, created_at, updated_at)
            VALUES (%s,%s,%s,'open',%s,%s)
            """,
            (ticket_id, user_id, subject, utcnow(), utcnow()),
        )
        cur.execute(
            """
            INSERT INTO support_messages (id, user_id, from_role, author_name, body, created_at)
            VALUES (%s,%s,'user',NULL,%s,%s)
            """,
            (f"msg_{uuid.uuid4().hex[:14]}", user_id, body, utcnow()),
        )
        conn.commit()
    return ticket_id


def seed_faq() -> None:
    # idempotent seed; can be empty if already populated
    faqs = [
        {
            "key": "fees_withdraw_momo",
            "q_fr": "Quels sont les frais pour un retrait MTN Mobile Money ?",
            "a_fr": "Les frais dépendent du canal. En MVP, on affiche une estimation avant validation.",
            "q_en": "What are the fees for an MTN Mobile Money withdrawal?",
            "a_en": "Fees depend on the rail. In MVP we show an estimate before confirmation.",
        },
        {
            "key": "deposit_time",
            "q_fr": "Combien de temps prend un dépôt ?",
            "a_fr": "Mobile Money: instantané. Virement: 24–48h selon la banque.",
            "q_en": "How long does a deposit take?",
            "a_en": "Mobile Money: instant. Bank transfer: 24–48h depending on bank.",
        },
    ]
    with closing(get_conn()) as conn, conn.cursor() as cur:
        for f in faqs:
            cur.execute(
                """
                INSERT INTO support_faq (key, q_fr, a_fr, q_en, a_en, created_at)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (key) DO NOTHING
                """,
                (f["key"], f["q_fr"], f["a_fr"], f["q_en"], f["a_en"], utcnow()),
            )
        conn.commit()


def list_faq() -> list[dict[str, Any]]:
    seed_faq()
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT key, q_fr, a_fr, q_en, a_en FROM support_faq ORDER BY key ASC")
        return cur.fetchall() or []

