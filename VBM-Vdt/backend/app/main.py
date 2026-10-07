import os
import threading
from pathlib import Path
from typing import Optional

import anyio
from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from app.infrastructure.db import apply_schema, get_connection
from app.infrastructure.version import read_version
from app.modules.comparisons.api import router as comparisons_router
from app.modules.imports.api import router as imports_router
from app.modules.simulations.api import router as simulations_router


class _SPAStaticFiles(StaticFiles):
    """Like StaticFiles(html=True), but a path that matches no real file
    (a client-side route, once the frontend has any) falls back to
    index.html instead of 404ing - the SPA's own router then takes over.

    StaticFiles.get_response *raises* HTTPException(404) rather than
    returning a 404 response, so the fallback has to be a catch, not an
    inspection of a returned status code."""

    async def get_response(self, path: str, scope: Scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404:
                return FileResponse(Path(self.directory) / "index.html")
            raise


def create_app(
    db_path: Optional[str] = None,
    archive_dir: Optional[Path] = None,
    static_dir: Optional[Path] = None,
) -> FastAPI:
    app = FastAPI(title="VDT API")

    if db_path is None:
        db_path = os.environ.get("VDT_DB_PATH", ":memory:")
    if archive_dir is None:
        env_archive_dir = os.environ.get("VDT_ARCHIVE_DIR")
        archive_dir = Path(env_archive_dir) if env_archive_dir else None

    # One shared connection, reachable from FastAPI's threadpool. The write
    # lock below is what keeps that safe: SQLite serializes nothing for us
    # once check_same_thread is off.
    connection = get_connection(db_path, check_same_thread=False)
    apply_schema(connection)
    app.state.db = connection
    app.state.db_write_lock = threading.Lock()
    app.state.archive_dir = Path(archive_dir) if archive_dir else None
    app.state.imports = {}

    # One sqlite3 connection cannot be used by two threads at once - it raises
    # "bad parameter or other API misuse". FastAPI runs every sync endpoint in
    # its threadpool, so any two overlapping requests (the All-trees canvas
    # fetches one comparison per tree at once) would collide. Serializing whole
    # requests here keeps that guarantee in one place instead of asking every
    # endpoint to remember a lock.
    #
    # The lock is a plain threading.Lock, acquired on a worker thread rather
    # than on the event loop, for two reasons. Acquiring it *on* the loop would
    # deadlock: the loop would block while the holder's endpoint sat in the
    # threadpool, unable to deliver its result. And an anyio/asyncio lock would
    # not work under TestClient, which runs each request on its own event loop -
    # a waiter would park on one loop and never be woken by a release on
    # another. A threading.Lock is loop-agnostic, so tests and uvicorn behave
    # identically.
    request_lock = threading.Lock()

    @app.middleware("http")
    async def serialize_database_access(request, call_next):
        await anyio.to_thread.run_sync(request_lock.acquire)
        try:
            return await call_next(request)
        finally:
            request_lock.release()

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "version": read_version(Path(__file__).resolve().parent.parent)}

    app.include_router(imports_router)
    app.include_router(comparisons_router)
    app.include_router(simulations_router)

    resolved_static_dir = Path(static_dir) if static_dir is not None else Path(__file__).parent / "static"
    if resolved_static_dir.is_dir():
        app.mount("/", _SPAStaticFiles(directory=str(resolved_static_dir), html=True), name="static")

    return app
