from __future__ import annotations

import logging
import uuid
from contextlib import closing
from decimal import Decimal

import psycopg
from psycopg.types.json import Json

from app.core.time import utcnow
from app.db.session import get_conn
from app.services.blockchain_verify import (
    AMOUNT_TOLERANCE,
    USDT_TRC20_CONTRACT,
    scan_trc20_incoming,
    verify_tx,
)
from app.services.compliance import enforce_compliance
from app.services.notifications import create_notification

log = logging.getLogger("crypto_reconciliation")


OPEN_DEPOSIT_STATUSES = ("pending", "hash_verified", "submitted")


def _event_id(tx_hash: str) -> str:
    return f"cevt_{tx_hash[:20]}"


def _amount_matches(received: Decimal, expected: Decimal) -> bool:
    return received >= expected * (Decimal("1") - AMOUNT_TOLERANCE)


def _record_event(cur, event: dict, *, status: str = "detected", reason: str = "") -> None:
    tx_hash = str(event.get("tx_hash") or "").strip()
    if not tx_hash:
        return
    cur.execute(
        """
        INSERT INTO crypto_chain_events
          (id, network, contract_address, tx_hash, from_address, to_address, amount_usdt,
           block_ts_ms, confirmations, status, reason, raw, created_at, updated_at)
        VALUES (%s,'TRC20',%s,%s,%s,%s,%s,%s,0,%s,%s,%s,%s,%s)
        ON CONFLICT (tx_hash) DO UPDATE SET
          from_address=EXCLUDED.from_address,
          to_address=EXCLUDED.to_address,
          amount_usdt=EXCLUDED.amount_usdt,
          block_ts_ms=EXCLUDED.block_ts_ms,
          status=CASE
            WHEN crypto_chain_events.status IN ('credited','manual_review') THEN crypto_chain_events.status
            ELSE EXCLUDED.status
          END,
          reason=CASE
            WHEN crypto_chain_events.status IN ('credited','manual_review') THEN crypto_chain_events.reason
            ELSE EXCLUDED.reason
          END,
          raw=EXCLUDED.raw,
          updated_at=EXCLUDED.updated_at
        """,
        (
            _event_id(tx_hash),
            USDT_TRC20_CONTRACT,
            tx_hash,
            str(event.get("from") or ""),
            str(event.get("to") or ""),
            Decimal(str(event.get("amount_usdt") or 0)),
            int(event.get("block_ts_ms") or 0),
            status,
            reason,
            Json(event),
            utcnow(),
            utcnow(),
        ),
    )


def _credit_crypto_deposit(dep: dict, event: dict, verification) -> bool:
    amount_xaf = Decimal(str(dep["amount_xaf"]))
    now = utcnow()
    tx_hash = str(event["tx_hash"])
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM crypto_deposits WHERE id=%s FOR UPDATE", (dep["id"],))
        locked = cur.fetchone()
        if not locked or locked["status"] not in OPEN_DEPOSIT_STATUSES:
            conn.rollback()
            return False
        if locked.get("tx_hash") and locked["tx_hash"] != tx_hash:
            conn.rollback()
            return False

        cur.execute(
            """UPDATE crypto_deposits
               SET tx_hash=%s, status='auto_confirmed', verification_status='auto_confirmed',
                   verification_confirmations=%s, updated_at=%s
               WHERE id=%s AND status IN ('pending','hash_verified','submitted')""",
            (tx_hash, verification.confirmations, now, dep["id"]),
        )
        if cur.rowcount == 0:
            conn.rollback()
            return False
        cur.execute(
            """INSERT INTO wallet_accounts (user_id, currency, balance, address, metadata, created_at, updated_at)
               VALUES (%s,'FCFA',%s,NULL,'{}'::jsonb,%s,%s)
               ON CONFLICT (user_id, currency)
               DO UPDATE SET balance = wallet_accounts.balance + EXCLUDED.balance, updated_at = EXCLUDED.updated_at""",
            (dep["user_id"], amount_xaf, now, now),
        )
        cur.execute(
            """INSERT INTO wallet_transactions
               (id,user_id,direction,category,label,counterpart,amount,currency,status,metadata,created_at)
               VALUES (%s,%s,'credit','crypto_deposit','Dépôt crypto USDT','TRC20',%s,'FCFA','completed',%s,%s)
               ON CONFLICT (id) DO NOTHING""",
            (
                f"tx_cdep_{dep['id'][-12:]}",
                dep["user_id"],
                amount_xaf,
                Json(
                    {
                        "deposit_id": dep["id"],
                        "tx_hash": tx_hash,
                        "network": "TRC20",
                        "amount_usdt": float(verification.amount_usdt or event.get("amount_usdt") or 0),
                        "confirmations": verification.confirmations,
                        "source": "crypto_auto_reconciliation",
                    }
                ),
                now,
            ),
        )
        cur.execute(
            """UPDATE crypto_chain_events
               SET status='credited', match_type='crypto_deposit', matched_table='crypto_deposits',
                   matched_id=%s, confirmations=%s, reason='', updated_at=%s
               WHERE tx_hash=%s""",
            (dep["id"], verification.confirmations, now, tx_hash),
        )
        conn.commit()

    try:
        create_notification(
            dep["user_id"],
            "deposit_confirmed",
            "Dépôt crypto confirmé",
            f"Votre dépôt crypto de {float(amount_xaf):,.0f} FCFA a été vérifié sur la blockchain et crédité.",
            {"deposit_id": dep["id"], "tx_hash": tx_hash, "network": "TRC20"},
        )
    except Exception:
        pass
    return True


def _credit_payment_link_tx(tx: dict, event: dict, verification) -> bool:
    gross = Decimal(str(tx["amount"]))
    net = Decimal(str(tx["net_fcfa"]))
    now = utcnow()
    tx_hash = str(event["tx_hash"])
    try:
        compliance = enforce_compliance(
            user_id=tx["creator_id"],
            amount_fcfa=gross,
            flow="crypto",
            allow_manual_review=True,
        )
        if compliance.review_required:
            with closing(get_conn()) as conn, conn.cursor() as cur:
                cur.execute(
                    """UPDATE payment_link_txs
                       SET aggregator_txid=%s, status='pending', updated_at=%s
                       WHERE id=%s AND status='processing'""",
                    (tx_hash, now, tx["id"]),
                )
                cur.execute(
                    """UPDATE crypto_chain_events
                       SET status='manual_review', match_type='payment_link', matched_table='payment_link_txs',
                           matched_id=%s, confirmations=%s, reason=%s, updated_at=%s
                       WHERE tx_hash=%s""",
                    (tx["id"], verification.confirmations, "Revue conformité requise", now, tx_hash),
                )
                conn.commit()
            return False
    except Exception:
        pass

    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute("SELECT * FROM payment_link_txs WHERE id=%s FOR UPDATE", (tx["id"],))
        locked = cur.fetchone()
        if not locked or locked["status"] not in ("processing", "pending"):
            conn.rollback()
            return False
        if locked.get("aggregator_txid") and locked["aggregator_txid"] != tx_hash:
            conn.rollback()
            return False
        cur.execute(
            """UPDATE payment_link_txs
               SET aggregator_txid=%s, status='completed', updated_at=%s
               WHERE id=%s AND status IN ('processing','pending')""",
            (tx_hash, now, tx["id"]),
        )
        if cur.rowcount == 0:
            conn.rollback()
            return False
        cur.execute(
            """INSERT INTO wallet_accounts (user_id, currency, balance, address, metadata, created_at, updated_at)
               VALUES (%s,'FCFA',%s,NULL,'{}'::jsonb,%s,%s)
               ON CONFLICT (user_id, currency)
               DO UPDATE SET balance = wallet_accounts.balance + EXCLUDED.balance, updated_at = EXCLUDED.updated_at""",
            (tx["creator_id"], net, now, now),
        )
        cur.execute(
            """INSERT INTO wallet_transactions
               (id,user_id,direction,category,label,counterpart,amount,currency,status,metadata,created_at)
               VALUES (%s,%s,'credit','payment_link',%s,'USDT TRC20',%s,'FCFA','completed',%s,%s)
               ON CONFLICT (id) DO NOTHING""",
            (
                f"wt_plcrypto_{tx['id'][-12:]}",
                tx["creator_id"],
                f"Paiement lien crypto : {tx['link_desc']}",
                net,
                Json(
                    {
                        "tx_id": tx["id"],
                        "link_id": tx["link_id"],
                        "reference": tx["reference"],
                        "tx_hash": tx_hash,
                        "amount_usdt": float(verification.amount_usdt or event.get("amount_usdt") or 0),
                        "confirmations": verification.confirmations,
                        "source": "crypto_auto_reconciliation",
                    }
                ),
                now,
            ),
        )
        cur.execute("UPDATE payment_links SET use_count=use_count+1, updated_at=%s WHERE id=%s", (now, tx["link_id"]))
        cur.execute(
            """UPDATE crypto_chain_events
               SET status='credited', match_type='payment_link', matched_table='payment_link_txs',
                   matched_id=%s, confirmations=%s, reason='', updated_at=%s
               WHERE tx_hash=%s""",
            (tx["id"], verification.confirmations, now, tx_hash),
        )
        conn.commit()

    try:
        create_notification(
            tx["creator_id"],
            "payment_received",
            "Paiement crypto reçu",
            f"Vous avez reçu {float(net):,.0f} FCFA via USDT TRC20 ({tx['link_desc']}).",
            {"link_id": tx["link_id"], "tx_id": tx["id"], "tx_hash": tx_hash},
        )
    except Exception:
        pass
    return True


def _mark_event(cur, tx_hash: str, status: str, reason: str, *, matched_id: str = "", confirmations: int = 0) -> None:
    cur.execute(
        """UPDATE crypto_chain_events
           SET status=%s, reason=%s, matched_id=%s, confirmations=%s, updated_at=%s
           WHERE tx_hash=%s AND status!='credited'""",
        (status, reason, matched_id, confirmations, utcnow(), tx_hash),
    )


def reconcile_crypto_deposits(limit_wallets: int = 5, scan_limit: int = 80) -> dict[str, int]:
    result = {
        "crypto_wallets_checked": 0,
        "crypto_events_checked": 0,
        "crypto_deposits_matched": 0,
        "crypto_deposits_credited": 0,
        "crypto_manual_review": 0,
        "crypto_failed": 0,
    }
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        cur.execute(
            "SELECT network, address FROM crypto_wallets WHERE active=TRUE AND network='TRC20' ORDER BY created_at DESC LIMIT %s",
            (limit_wallets,),
        )
        wallets = [dict(r) for r in cur.fetchall() or []]

    for wallet in wallets:
        result["crypto_wallets_checked"] += 1
        run_id = f"cscan_{uuid.uuid4().hex[:16]}"
        checked = matched = credited = failed = 0
        message = ""
        try:
            with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                cur.execute(
                    """
                    SELECT COALESCE(
                      EXTRACT(EPOCH FROM MIN(created_at) - interval '2 hours') * 1000,
                      EXTRACT(EPOCH FROM now() - interval '14 days') * 1000
                    )::BIGINT AS after_ms
                    FROM crypto_deposits
                    WHERE wallet_address=%s AND network='TRC20'
                      AND status IN ('pending','hash_verified','submitted')
                      AND created_at >= now() - interval '14 days'
                    """,
                    (wallet["address"],),
                )
                after_ms = int((cur.fetchone() or {}).get("after_ms") or 0)
            events = scan_trc20_incoming(wallet["address"], Decimal("0.01"), after_ms, limit=scan_limit)
        except Exception as exc:
            message = str(exc)[:500]
            failed += 1
            result["crypto_failed"] += 1
            log.warning("Crypto scan failed wallet=%s: %s", wallet["address"], exc)
            events = []

        for event in events:
            tx_hash = str(event.get("tx_hash") or "").strip()
            if not tx_hash:
                continue
            checked += 1
            result["crypto_events_checked"] += 1
            amount = Decimal(str(event.get("amount_usdt") or 0))
            with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
                _record_event(cur, event)
                cur.execute("SELECT status FROM crypto_chain_events WHERE tx_hash=%s", (tx_hash,))
                existing_event = cur.fetchone()
                if existing_event and existing_event["status"] == "credited":
                    conn.commit()
                    continue
                cur.execute(
                    """
                    SELECT *
                    FROM crypto_deposits
                    WHERE wallet_address=%s AND network='TRC20'
                      AND status IN ('pending','hash_verified','submitted')
                      AND (tx_hash IS NULL OR tx_hash=%s)
                      AND created_at >= now() - interval '14 days'
                    ORDER BY created_at ASC
                    LIMIT 100
                    """,
                    (wallet["address"], tx_hash),
                )
                deposits = [dict(r) for r in cur.fetchall() or []]
                candidates = [
                    d for d in deposits
                    if _amount_matches(amount, Decimal(str(d["amount_usdt"])))
                ]
                cur.execute(
                    """
                    SELECT t.*, pl.user_id AS creator_id, pl.description AS link_desc
                    FROM payment_link_txs t
                    JOIN payment_links pl ON pl.id=t.link_id
                    WHERE t.provider='crypto_trc20'
                      AND t.status='processing'
                      AND (t.aggregator_txid IS NULL OR t.aggregator_txid='')
                      AND t.created_at >= now() - interval '24 hours'
                    ORDER BY t.created_at ASC
                    LIMIT 100
                    """
                )
                link_txs = [dict(r) for r in cur.fetchall() or []]
                link_candidates = [
                    t for t in link_txs
                    if _amount_matches(amount, (Decimal(str(t["amount"])) / Decimal("550")).quantize(Decimal("0.01")))
                ]
                all_candidates = [("crypto_deposit", d) for d in candidates] + [("payment_link", t) for t in link_candidates]
                if not all_candidates:
                    _mark_event(cur, tx_hash, "unmatched", "Aucune demande Kobo ouverte ne correspond au montant reçu")
                    conn.commit()
                    continue
                if len(all_candidates) > 1:
                    _mark_event(
                        cur,
                        tx_hash,
                        "manual_review",
                        "Plusieurs opérations ouvertes correspondent au même montant : validation admin requise",
                    )
                    conn.commit()
                    result["crypto_manual_review"] += 1
                    continue
                match_type, matched_row = all_candidates[0]
                cur.execute(
                    """UPDATE crypto_chain_events
                       SET status='matched', match_type=%s, matched_table=%s,
                           matched_id=%s, updated_at=%s
                       WHERE tx_hash=%s AND status!='credited'""",
                    (
                        match_type,
                        "crypto_deposits" if match_type == "crypto_deposit" else "payment_link_txs",
                        matched_row["id"],
                        utcnow(),
                        tx_hash,
                    ),
                )
                conn.commit()
            matched += 1
            result["crypto_deposits_matched"] += 1

            expected_usdt = (
                Decimal(str(matched_row["amount_usdt"]))
                if match_type == "crypto_deposit"
                else (Decimal(str(matched_row["amount"])) / Decimal("550")).quantize(Decimal("0.01"))
            )
            verification = verify_tx(
                tx_hash=tx_hash,
                network="TRC20",
                expected_to=wallet["address"],
                expected_usdt=expected_usdt,
            )
            if verification.status == "auto_confirmed":
                if match_type == "crypto_deposit" and _credit_crypto_deposit(matched_row, event, verification):
                    credited += 1
                    result["crypto_deposits_credited"] += 1
                elif match_type == "payment_link" and _credit_payment_link_tx(matched_row, event, verification):
                    credited += 1
                    result["crypto_deposits_credited"] += 1
            elif verification.status == "hash_verified":
                with closing(get_conn()) as conn, conn.cursor() as cur:
                    if match_type == "crypto_deposit":
                        cur.execute(
                            """UPDATE crypto_deposits
                               SET tx_hash=%s, status='hash_verified', verification_status='hash_verified',
                                   verification_confirmations=%s, updated_at=%s
                               WHERE id=%s AND status IN ('pending','hash_verified','submitted')""",
                            (tx_hash, verification.confirmations, utcnow(), matched_row["id"]),
                        )
                    else:
                        cur.execute(
                            """UPDATE payment_link_txs
                               SET aggregator_txid=%s, status='pending', updated_at=%s
                               WHERE id=%s AND status='processing'""",
                            (tx_hash, utcnow(), matched_row["id"]),
                        )
                    _mark_event(
                        cur,
                        tx_hash,
                        "hash_verified",
                        f"{verification.confirmations}/20 confirmations",
                        matched_id=matched_row["id"],
                        confirmations=verification.confirmations,
                    )
                    conn.commit()
            elif verification.status == "needs_manual_review":
                with closing(get_conn()) as conn, conn.cursor() as cur:
                    _mark_event(cur, tx_hash, "manual_review", verification.reason or "API blockchain indisponible", matched_id=matched_row["id"])
                    conn.commit()
                result["crypto_manual_review"] += 1
            else:
                with closing(get_conn()) as conn, conn.cursor() as cur:
                    _mark_event(cur, tx_hash, "failed", verification.reason or "Transaction invalide", matched_id=matched_row["id"])
                    conn.commit()
                failed += 1
                result["crypto_failed"] += 1

        with closing(get_conn()) as conn, conn.cursor() as cur:
            cur.execute(
                """INSERT INTO crypto_scan_runs
                   (id, network, wallet_address, status, checked, matched, credited, failed, message, created_at)
                   VALUES (%s,'TRC20',%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    run_id,
                    wallet["address"],
                    "failed" if failed and not checked else "completed",
                    checked,
                    matched,
                    credited,
                    failed,
                    message,
                    utcnow(),
                ),
            )
            conn.commit()

    return result
