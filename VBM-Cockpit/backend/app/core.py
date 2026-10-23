"""
Runtime plumbing: settings, repo-root path anchoring, and the Lakebase engine.

Merged into one module because all three answer the same question -- "what
environment am I in?" -- and none of them carries a business rule. Business
rules live in registry.py and analytics.py.

Database precedence:
  1. DATABASE_URL              full SQLAlchemy URL (local dev, CI, Docker)
  2. PGHOST/PGUSER/PGDATABASE  Lakebase; password is a short-lived OAuth token
                               minted at connect time, never stored.
"""

from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Literal, Generator

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger("cockpit.core")

# ------------------------------------------------------------------ paths --
APP_DIR = Path(__file__).resolve().parent          # <repo>/backend/app
BACKEND_DIR = APP_DIR.parent                       # <repo>/backend
REPO_ROOT = BACKEND_DIR.parent                     # <repo>

DEFAULT_SEED_DIR = BACKEND_DIR / "data"
DEFAULT_STATIC_DIR = APP_DIR / "static"


def resolve_under_repo(value: str | Path) -> Path:
    """
    Absolute paths honoured as-is; relative ones anchored to the repo root --
    never the CWD. This is what stops `make seed` and `uvicorn` disagreeing
    about which directory "data" means.
    """
    p = Path(value).expanduser()
    return p if p.is_absolute() else (REPO_ROOT / p).resolve()


# --------------------------------------------------------------- settings --
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8",
                                      extra="ignore")

    app_name: str = "VBM Strategic Cockpit"
    environment: str = "local"
    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:5173"
    static_dir: str = "static"

    data_backend: Literal["sql", "json"] = "json"
    seed_dir: str = "backend/data"

    database_url: str | None = Field(default=None, alias="DATABASE_URL")

    pghost: str | None = None
    pgport: int = 5432
    pguser: str | None = None
    pgdatabase: str = "databricks_postgres"
    pgsslmode: str = "require"
    pgpassword: str | None = None

    lakebase_instance_name: str | None = None
    lakebase_endpoint: str | None = None
    lakebase_token_ttl_seconds: int = 3600
    lakebase_token_refresh_margin_seconds: int = 600

    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_recycle_seconds: int = 1800

    max_upload_mb: int = 40

    # Who may unlock a locked snapshot. Locking freezes the figures leadership
    # signed off on, so reversing it is deliberately narrower than the rest of
    # the app: an empty list means nobody can, which is the safe default for an
    # environment that forgot to configure it. Matched case-insensitively
    # against the platform's X-Forwarded-Email.
    unlock_admins: str = ""

    # Stand-in for X-Forwarded-Email when running outside Databricks Apps, where
    # no platform proxy sets that header. Honoured only when ENVIRONMENT=local,
    # so a stray value in a deployed app.yaml cannot impersonate anyone.
    dev_actor: str | None = None

    # DELIBERATELY ABSENT: default_snapshot / default_year.
    # Periods are discovered from the data at runtime (see periods.py), so a new
    # quarter or a new year needs no config change and no redeploy. An operator
    # may still pin a landing period per environment:
    pinned_snapshot: str | None = None
    pinned_year: int | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def unlock_admin_list(self) -> list[str]:
        return [a.strip().lower() for a in self.unlock_admins.split(",") if a.strip()]

    @property
    def uses_lakebase(self) -> bool:
        return self.database_url is None and bool(self.pghost)


@lru_cache
def get_settings() -> Settings:
    return Settings()


# ------------------------------------------------- Lakebase OAuth password --
class _TokenProvider:
    """
    Mints a Lakebase credential and re-mints it before expiry.

    Not on a background timer: a pooled connection can outlive the credential
    that opened it. Instead the token is minted lazily at *connect* time from a
    cache that self-refreshes `refresh_margin` seconds early, so the workspace
    is called roughly once per 50 minutes rather than once per request.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._token: str | None = None
        self._expires_at: float = 0.0

    def get(self) -> str:
        s = get_settings()
        with self._lock:
            if self._token and time.time() < self._expires_at:
                return self._token
            from databricks.sdk import WorkspaceClient
            endpoint = s.lakebase_endpoint or s.lakebase_instance_name
            if not endpoint:
                raise RuntimeError(
                    "Cannot mint a Lakebase credential: neither LAKEBASE_ENDPOINT "
                    "nor LAKEBASE_INSTANCE_NAME is set. Check app.yaml's "
                    "`valueFrom: database` entries against the bound resource key."
                )
            client = WorkspaceClient()
            cred = client.postgres.generate_database_credential(endpoint=endpoint)
            self._token = cred.token
            self._expires_at = (time.time() + s.lakebase_token_ttl_seconds
                                - s.lakebase_token_refresh_margin_seconds)
            log.info("Minted Lakebase credential; valid ~%ds.",
                     s.lakebase_token_ttl_seconds)
            return self._token


_tokens = _TokenProvider()
_engine = None


def get_engine():
    """SQLAlchemy engine. Imported lazily so JSON mode needs no psycopg."""
    global _engine
    if _engine is not None:
        return _engine

    from sqlalchemy import create_engine, event
    from sqlalchemy.engine import URL
    import json
    from datetime import date, datetime
    from decimal import Decimal

    def _json_default(o):
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return float(o)
        raise TypeError(f"Object of type {o.__class__.__name__} is not JSON serializable")

    s = get_settings()
    if s.database_url:
        url = s.database_url
    else:
        url = URL.create("postgresql+psycopg", username=s.pguser, host=s.pghost,
                         port=s.pgport, database=s.pgdatabase,
                         query={"sslmode": s.pgsslmode})

    _engine = create_engine(url, json_serializer=lambda obj: json.dumps(obj, default=_json_default), pool_pre_ping=True, pool_size=s.db_pool_size,
                            max_overflow=s.db_max_overflow,
                            pool_recycle=s.db_pool_recycle_seconds, future=True)

    if s.uses_lakebase:
        @event.listens_for(_engine, "do_connect")
        def _inject_token(dialect, conn_rec, cargs, cparams):   # noqa: ANN001
            cparams["password"] = _tokens.get()
            return None
    elif s.pgpassword:
        @event.listens_for(_engine, "do_connect")
        def _inject_static(dialect, conn_rec, cargs, cparams):  # noqa: ANN001
            cparams.setdefault("password", s.pgpassword)
            return None

    return _engine


# One fixed key for this app's schema-bootstrap lock. Any 64-bit int works --
# it just has to be the same constant on every worker/process that calls
# ensure_schema() against this database.
_SCHEMA_LOCK_KEY = 0x564241534553434D  # "VBASESCM" as ASCII bytes


def ensure_schema() -> None:
    """
    Apply the registry's DDL to the configured database, idempotently.

    `Base.metadata.create_all(checkfirst=True)` is a reflect-then-create pair,
    which races when multiple uvicorn workers boot against the same database
    at once (see app_entry.py's `workers=` setting) -- the loser can hit
    `DuplicateTable`. `pg_advisory_xact_lock` makes the pair atomic: the loser
    blocks until the winner's transaction commits, then reflects a schema that
    already exists and creates nothing.

    This is the single implementation behind both the app's startup self-heal
    (main.py's lifespan) and `make migrate`, so the manual and automatic paths
    cannot drift apart.
    """
    from sqlalchemy import text

    from .models import Base

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("select pg_advisory_xact_lock(:key)"),
                    {"key": _SCHEMA_LOCK_KEY})
        Base.metadata.create_all(bind=conn, checkfirst=True)


@contextmanager
def session_scope() -> Generator["object"]:
    from sqlalchemy.orm import Session

    session = Session(bind=get_engine(), future=True, expire_on_commit=False)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
