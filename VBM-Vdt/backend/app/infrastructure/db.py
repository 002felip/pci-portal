import sqlite3
from contextlib import contextmanager
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[0] / "db" / "sqlite" / "schema.sql"


def get_connection(db_path: str = ":memory:", check_same_thread: bool = True) -> sqlite3.Connection:
    """check_same_thread=False is required when one connection is shared with
    FastAPI's threadpool, which runs sync endpoints off the creating thread.
    Callers that do so MUST serialize writes themselves - see the write lock
    in app.main / the imports router."""
    conn = sqlite3.connect(db_path, check_same_thread=check_same_thread)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def apply_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()


@contextmanager
def unit_of_work(conn: sqlite3.Connection):
    """One explicit transaction. Repositories never commit; the caller owns
    the boundary so a multi-table publication is all-or-nothing."""
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    else:
        conn.commit()
