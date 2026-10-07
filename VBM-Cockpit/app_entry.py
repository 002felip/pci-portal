"""
Databricks Apps entrypoint.

Apps tells the container which port to listen on via DATABRICKS_APP_PORT.
app.yaml's `command` is an exec-style list with no shell, so the port cannot be
interpolated there — this launcher reads it at runtime instead.

It also defaults PGUSER to the app's service principal client id, which is what
Lakebase expects as the Postgres role when the database resource is bound.

UNCHANGED FROM v1: still imports backend.app.main:app.
"""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    port = int(os.getenv("DATABRICKS_APP_PORT", os.getenv("PORT", "8000")))

    if not os.getenv("PGUSER") and os.getenv("DATABRICKS_CLIENT_ID"):
        os.environ["PGUSER"] = os.environ["DATABRICKS_CLIENT_ID"]

    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=port,
                workers=int(os.getenv("WEB_CONCURRENCY", "2")), access_log=True)


if __name__ == "__main__":
    main()
