
from collections.abc import Iterator
from contextlib import closing

import psycopg
from app.core.config import settings


def get_conn() -> psycopg.Connection:
    return psycopg.connect(settings.database_url)


def dict_cursor() -> Iterator[psycopg.Cursor]:
    with closing(get_conn()) as conn, conn.cursor(row_factory=psycopg.rows.dict_row) as cur:
        yield conn, cur
