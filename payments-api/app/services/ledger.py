from __future__ import annotations

import uuid
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import psycopg
from psycopg.types.json import Json

from app.core.serialization import json_ready
from app.db.session import get_conn
from app.services.fees import calculate_fee_fcfa, credit_platform_fee
from app.services.wallets import ensure_default_wallets


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_user_by_phone(phone_e164: str) -> dict[str, Any] | None:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute('SELECT id, phone_e164, email, profile FROM users WHERE phone_e164 = %s', (phone_e164,))
        return cur.fetchone()


def _get_user_by_identifier(identifier: str) -> dict[str, Any] | None:
    ident = identifier.strip()
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:

        # 1. username: @paul ou paul (sans @ ni + ni domaine)
        if ident.startswith('@') or (not ident.startswith('+') and '@' not in ident):
            slug = ident.lstrip('@')
            cur.execute(
                "SELECT id, phone_e164, email, profile FROM users WHERE profile->>'username' = %s LIMIT 1",
                (slug,),
            )
            row = cur.fetchone()
            if row:
                return row

        # 2. email exact (case-insensitive)
        if '@' in ident and not ident.startswith('+'):
            cur.execute(
                'SELECT id, phone_e164, email, profile FROM users WHERE lower(email) = lower(%s) LIMIT 1',
                (ident,),
            )
            row = cur.fetchone()
            if row:
                return row
            # Aussi via phone_e164 (comptes email-as-phone)
            cur.execute(
                'SELECT id, phone_e164, email, profile FROM users WHERE lower(phone_e164) = lower(%s) LIMIT 1',
                (ident,),
            )
            row = cur.fetchone()
            if row:
                return row

        # 3. téléphone exact
        cur.execute(
            'SELECT id, phone_e164, email, profile FROM users WHERE phone_e164 = %s LIMIT 1',
            (ident,),
        )
        row = cur.fetchone()
        if row:
            return row

        # 4. préfixe email (ex: 'edenrin3' matche 'edenrin3@gmail.com')
        if '@' not in ident and not ident.startswith('+') and len(ident) >= 3:
            cur.execute(
                "SELECT id, phone_e164, email, profile FROM users WHERE lower(split_part(phone_e164, '@', 1)) = lower(%s) OR lower(split_part(email, '@', 1)) = lower(%s) LIMIT 2",
                (ident, ident),
            )
            rows = cur.fetchall()
            if len(rows) == 1:
                return rows[0]

        # 5. nom complet exact (insensible à la casse) — uniquement si un seul résultat
        if '@' not in ident and len(ident) >= 2:
            cur.execute(
                "SELECT id, phone_e164, email, profile FROM users WHERE lower(trim(profile->>'fullName')) = lower(trim(%s)) LIMIT 2",
                (ident,),
            )
            rows = cur.fetchall()
            if len(rows) == 1:
                return rows[0]

        return None


def lookup_user(*, identifier: str) -> dict[str, Any] | None:
    row = _get_user_by_identifier(identifier)
    if not row:
        return None
    profile = row.get('profile') or {}
    return {
        'id': row['id'],
        'phone': row['phone_e164'],
        'email': row.get('email'),
        'username': profile.get('username'),
        'fullName': profile.get('fullName') or '',
    }


def p2p_transfer_fcfa(
    *,
    sender_user_id: str,
    sender_phone: str,
    to_identifier: str,
    amount_fcfa: Decimal,
    note: str = '',
) -> dict[str, Any]:
    if amount_fcfa <= 0:
        raise ValueError('amount must be > 0')

    recipient = _get_user_by_identifier(to_identifier)
    if not recipient:
        raise ValueError('Utilisateur introuvable')
    if recipient['id'] == sender_user_id:
        raise ValueError('Impossible d\'envoyer à soi-même')

    ensure_default_wallets(sender_user_id)
    ensure_default_wallets(recipient['id'])

    fee_fcfa = calculate_fee_fcfa('p2p_transfer', amount_fcfa)
    total_debit = amount_fcfa + fee_fcfa   # sender paie montant + frais
    # receiver reçoit le montant exact demandé

    transfer_id = f'p2p_{uuid.uuid4().hex[:16]}'
    ledger_id = f'led_{uuid.uuid4().hex[:16]}'
    now = utcnow()

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA' FOR UPDATE",
            (sender_user_id,),
        )
        sender_wallet = cur.fetchone()
        if not sender_wallet:
            raise ValueError('sender wallet missing')
        sender_balance = Decimal(str(sender_wallet['balance']))
        if sender_balance < total_debit:
            raise ValueError(
                f'Solde insuffisant. Disponible : {float(sender_balance):,.0f} FCFA, '
                f'requis : {float(total_debit):,.0f} FCFA (dont {float(fee_fcfa):,.0f} FCFA de frais)'
            )

        cur.execute(
            "SELECT balance FROM wallet_accounts WHERE user_id = %s AND currency = 'FCFA' FOR UPDATE",
            (recipient['id'],),
        )
        recipient_wallet = cur.fetchone()
        if not recipient_wallet:
            raise ValueError('recipient wallet missing')
        recipient_balance = Decimal(str(recipient_wallet['balance']))

        # Débiter sender (montant + frais), créditer receiver (montant seul)
        cur.execute(
            "UPDATE wallet_accounts SET balance = %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
            (sender_balance - total_debit, now, sender_user_id),
        )
        cur.execute(
            "UPDATE wallet_accounts SET balance = %s, updated_at = %s WHERE user_id = %s AND currency = 'FCFA'",
            (recipient_balance + amount_fcfa, now, recipient['id']),
        )

        cur.execute(
            '''
            INSERT INTO ledger_entries (id, kind, currency, amount, sender_user_id, recipient_user_id, metadata, created_at)
            VALUES (%s,'p2p','FCFA',%s,%s,%s,%s,%s)
            ''',
            (
                ledger_id,
                amount_fcfa,
                sender_user_id,
                recipient['id'],
                Json(json_ready({'note': note, 'recipient_phone': recipient['phone_e164'], 'fee_fcfa': float(fee_fcfa)})),
                now,
            ),
        )

        cur.execute(
            '''
            INSERT INTO p2p_transfers (id, ledger_entry_id, sender_user_id, recipient_user_id, amount, currency, status, created_at)
            VALUES (%s,%s,%s,%s,%s,'FCFA','completed',%s)
            ''',
            (transfer_id, ledger_id, sender_user_id, recipient['id'], amount_fcfa, now),
        )

        sender_label = f'Envoi vers {recipient["phone_e164"]}'
        if fee_fcfa > 0:
            sender_label += f' (frais {float(fee_fcfa):,.0f} FCFA)'

        sender_tx = f'tx_{uuid.uuid4().hex[:16]}'
        recipient_tx = f'tx_{uuid.uuid4().hex[:16]}'
        cur.execute(
            '''
            INSERT INTO wallet_transactions (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
            VALUES (%s,%s,'debit','p2p',%s,%s,%s,'FCFA','completed',%s,%s)
            ''',
            (
                sender_tx,
                sender_user_id,
                sender_label,
                recipient['phone_e164'],
                total_debit,
                Json(json_ready({'p2p_id': transfer_id, 'note': note, 'fee_fcfa': float(fee_fcfa)})),
                now,
            ),
        )
        cur.execute(
            '''
            INSERT INTO wallet_transactions (id, user_id, direction, category, label, counterpart, amount, currency, status, metadata, created_at)
            VALUES (%s,%s,'credit','p2p','Reçu',%s,%s,'FCFA','completed',%s,%s)
            ''',
            (
                recipient_tx,
                recipient['id'],
                sender_phone,
                amount_fcfa,
                Json(json_ready({'p2p_id': transfer_id, 'note': note})),
                now,
            ),
        )

        conn.commit()

    credit_platform_fee(fee_fcfa, source="p2p_transfer", ref=transfer_id)

    return {
        'id': transfer_id,
        'status': 'completed',
        'currency': 'FCFA',
        'amount': float(amount_fcfa),
        'fee_fcfa': float(fee_fcfa),
        'total_debited': float(total_debit),
        'recipient': {'id': recipient['id'], 'phone': recipient['phone_e164']},
    }
