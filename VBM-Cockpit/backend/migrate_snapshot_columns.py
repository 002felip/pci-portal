"""
Additive migration: add the Snapshots-page columns -- `archived_at`,
`archived_by`, `notes` and `uploaded_at` -- to an existing database.

WHY A STANDALONE SCRIPT
------------------------
There is no Alembic in this repo (see models.py's docstring): schema changes
go through `Base.metadata.create_all(checkfirst=True)`, which creates missing
*tables* but never adds a column to a table that already exists. So `make
migrate` will not apply this one, and the Snapshots page would 500 on a
database seeded before the columns were declared.

USAGE
-----
    python backend/migrate_snapshot_columns.py              # JSON backend
    python backend/migrate_snapshot_columns.py --dry-run
    DATA_BACKEND=sql python backend/migrate_snapshot_columns.py

Idempotent, and safe to extend: it adds only the columns that are missing, so
a later column can be appended to NEW_COLUMNS and the same script re-run. The
JSON backend needs no migration at all -- absent keys are defaulted on read by
`periods.enrich_snapshot` -- but the JSON path is implemented anyway so the
columns materialise in the seed file rather than appearing only after the
first write.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DATA = Path(__file__).resolve().parent / "data"

# (column, DDL type). Postgres `ADD COLUMN IF NOT EXISTS` makes the SQL path
# self-guarding; the JSON path guards by inspecting the stored dicts.
NEW_COLUMNS = (
    ("archived_at", "timestamptz"),
    ("archived_by", "varchar(256)"),
    ("notes", "text"),
    ("uploaded_at", "timestamptz"),
)


def migrate_json(dry_run: bool) -> int:
    """Materialise the three keys on every stored snapshot dict."""
    path = DATA / "initiatives.json"
    if not path.exists():
        print(f"No {path} -- nothing to migrate.")
        return 0

    data = json.loads(path.read_text("utf-8"))
    snapshots = data.get("snapshots", [])
    missing = [s for s in snapshots
               if any(c not in s for c, _ in NEW_COLUMNS)]
    if not missing:
        print(f"All {len(snapshots)} snapshot(s) already carry every column "
              f"-- nothing to migrate.")
        return 0

    for s in missing:
        for column, _ in NEW_COLUMNS:
            s.setdefault(column, None)

    if dry_run:
        print(f"[dry-run] Would add {[c for c, _ in NEW_COLUMNS]} to "
              f"{len(missing)} snapshot(s) in {path}.")
        return len(missing)

    shutil.copy2(path, path.with_suffix(".json.bak"))
    # Same serialisation as JsonRepository._flush, so the migration does not
    # reformat the whole seed file into an unreviewable diff.
    path.write_text(json.dumps(data, ensure_ascii=False, default=str), "utf-8")
    print(f"Added the missing columns to {len(missing)} snapshot(s). "
          f"Backup at {path.with_suffix('.json.bak')}.")
    return len(missing)


def migrate_sql(dry_run: bool) -> int:
    from sqlalchemy import text

    from backend.app.core import get_engine

    engine = get_engine()
    with engine.begin() as conn:
        present = {r[0] for r in conn.execute(text(
            "select column_name from information_schema.columns "
            "where table_name = 'snapshot'"))}
        todo = [(c, t) for c, t in NEW_COLUMNS if c not in present]
        if not todo:
            print("snapshot already has the archive columns -- nothing to migrate.")
            return 0

        for column, sqltype in todo:
            stmt = (f"alter table snapshot "
                    f"add column if not exists {column} {sqltype}")
            if dry_run:
                print(f"[dry-run] {stmt}")
                continue
            conn.execute(text(stmt))
            print(f"Added snapshot.{column} ({sqltype}).")

    return len(todo)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would change; write nothing.")
    args = parser.parse_args()

    import os
    backend = os.environ.get("DATA_BACKEND", "json")
    changed = migrate_sql(args.dry_run) if backend == "sql" \
        else migrate_json(args.dry_run)
    if changed and args.dry_run:
        print("\nRe-run without --dry-run to apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
