from contextlib import contextmanager
from typing import Any, Iterator

import psycopg2
import psycopg2.extras

from worker.config import WorkerSettings


@contextmanager
def get_connection(settings: WorkerSettings) -> Iterator[psycopg2.extensions.connection]:
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
        return [dict(row) for row in cur.fetchall()]


def execute(conn, query: str, params: tuple = ()) -> None:
    with conn.cursor() as cur:
        cur.execute(query, params)
