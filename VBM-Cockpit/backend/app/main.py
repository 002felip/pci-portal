"""
ASGI entrypoint. One app serves both tiers:

    /api/*   FastAPI
    /*       the built React SPA (static/), with history-mode fallback

Databricks Apps runs a single process behind a single port, so bundling the
compiled frontend into the same app removes any CORS/proxy/second-service
complexity in production. Locally, Vite on :5173 against the API on :8000 still
works -- CORS_ORIGINS covers it.

`app_entry.py` still imports `backend.app.main:app`, so nothing in app.yaml or
databricks.yml changes.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import router as api_router
from .core import get_settings

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s")
log = logging.getLogger("cockpit")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    log.info("Starting %s | env=%s backend=%s lakebase=%s",
             s.app_name, s.environment, s.data_backend, s.uses_lakebase)
    if s.data_backend == "sql":
        try:
            from sqlalchemy import text

            from .core import get_engine
            with get_engine().connect() as conn:
                conn.execute(text("select 1"))
            log.info("Database reachable.")
        except Exception as exc:                      # noqa: BLE001
            log.error("Database NOT reachable at startup: %s", exc)
        else:
            # Self-healing for the whole schema -- a fresh database (e.g. a new
            # Databricks/Lakebase deploy) gets every table `make migrate` would
            # apply, without a manual step. Idempotent and safe under multiple
            # uvicorn workers (see ensure_schema's advisory lock).
            try:
                from .core import ensure_schema
                ensure_schema()
                log.info("Schema ensured.")
            except Exception as exc:                  # noqa: BLE001
                log.error("Could not ensure schema: %s", exc)

    # Log the discovered reporting window. If this line looks wrong, the data is
    # wrong -- there is no configured default left to blame.
    try:
        from .repositories import get_repository
        for repo in get_repository():
            opts = repo.resolver().options()
            log.info("Periods discovered: snapshots=%s years=%s default=%s vs %s",
                     [s_.period_key for s_ in opts.snapshots], opts.years,
                     opts.default_baseline, opts.default_snapshot)
            break
    except Exception as exc:                          # noqa: BLE001
        log.warning("Could not enumerate periods at startup: %s", exc)

    yield
    log.info("Shutdown complete.")


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title=s.app_name, version="2.0.0", lifespan=lifespan)

    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origin_list,
                       allow_credentials=True, allow_methods=["*"],
                       allow_headers=["*"])
    app.include_router(api_router, prefix=s.api_prefix, tags=["api"])

    static_dir = Path(__file__).parent / s.static_dir
    index = static_dir / "index.html"

    if static_dir.is_dir():
        assets = static_dir / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa(full_path: str, request: Request):      # noqa: ANN202
            if full_path.startswith(s.api_prefix.lstrip("/")):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            candidate = static_dir / full_path
            if full_path and candidate.is_file():
                return FileResponse(candidate)
            if index.is_file():
                return FileResponse(index)
            return JSONResponse({"detail": "Frontend not built."}, status_code=404)
    else:
        @app.get("/", include_in_schema=False)
        async def root():                                     # noqa: ANN202
            return {"app": s.app_name, "docs": "/docs",
                    "hint": "Run `npm run build` in frontend/ to serve the SPA."}

    return app


app = create_app()
