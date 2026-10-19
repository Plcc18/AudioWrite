"""Thin helper around psycopg2 for raw SQL access to the Supabase Postgres database.

No ORM on purpose: the schema is small (4 tables) and raw SQL keeps the mapping
between `schema.sql` and the code obvious.
"""
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg2
import psycopg2.extras

from app.core.config import get_settings


@contextmanager
def get_connection() -> Iterator[psycopg2.extensions.connection]:
    settings = get_settings()
    conn = psycopg2.connect(settings.database_url)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetch_one(conn, query: str, params: tuple = ()) -> dict[str, Any] | None:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, params)
        row = cur.fetchone()
        return dict(row) if row else None


def fetch_all(conn, query: str, params: tuple = ()) -> list[dict[str, Any]]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(query, params)
        rows = cur.fetchall()
        return [dict(row) for row in rows]


def execute(conn, query: str, params: tuple = ()) -> None:
    with conn.cursor() as cur:
        cur.execute(query, params)
