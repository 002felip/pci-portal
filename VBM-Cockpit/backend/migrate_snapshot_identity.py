"""
One-off migration: mint `snapshot_id` / `period_key` / `label` for every
pre-refactor snapshot (a bare code such as `Q1`, `FY27`) and rewrite every
reference -- initiatives, load batches, overrides -- from the old code to
the new id.

WHY A STANDALONE SCRIPT
------------------------
There is no Alembic in this repo (see models.py's docstring): schema changes
go through `Base.metadata.create_all()`, which is additive-only and cannot
rename a primary key or backfill existing rows. This is the one hand-written
step `create_all` cannot do for you, following the same standalone-script
pattern as `seed_demo.py`.

USAGE
-----
    python backend/migrate_snapshot_identity.py              # JSON backend
    python backend/migrate_snapshot_identity.py --dry-run
    DATA_BACKEND=sql python backend/migrate_snapshot_identity.py

Run `make migrate` first on the SQL backend so the new Snapshot columns
exist. The JSON backend writes a `.bak` of every file it touches before
changing it.

An old code that does not parse the legacy grammar (`periods.
normalise_legacy_code`) is never dropped or guessed at -- it is flagged
`needs_review` and listed in the printed report for a human to confirm the
fiscal year.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app.periods import (          # noqa: E402
    build_period_key, compute_sort_key, mint_snapshot_id, normalise_legacy_code,
)

DATA = Path(__file__).resolve().parent / "data"
_SUMMARY_KEY = re.compile(r"^summary:(?P<code>[^:]+):(?P<rest>.+)$")


def _build_identity(code: str, label: str | None, default_year: int,
                    is_baseline: bool = False) -> dict:
    year, ptype, ordinal, needs_review = normalise_legacy_code(code, default_year)
    return {
        "id": mint_snapshot_id(), "period_key": build_period_key(year, ptype, ordinal),
        "label": label or code, "as_of_date": None,
        "fiscal_year": year, "period_type": ptype, "period_ordinal": ordinal,
        "sort_key": compute_sort_key(year, ptype, ordinal),
        "state": "published", "revision": 1, "superseded_by": None,
        "pinned": is_baseline, "needs_review": needs_review,
        "stored_filename": None, "original_filename": None, "reason": None,
        "created_by": None, "published_by": None, "published_at": None,
        "is_baseline": is_baseline,
    }


def _print_report(identities: dict[str, dict]) -> list[dict]:
    report = []
    for code, ident in identities.items():
        flag = " -- NEEDS REVIEW (fiscal year is a guess)" if ident["needs_review"] else ""
        print(f"  {code} -> {ident['id']}  ({ident['period_key']}){flag}")
        if ident["needs_review"]:
            report.append({"code": code, "period_key": ident["period_key"]})
    return report


# ==================================================================== json ===
def migrate_json(dry_run: bool) -> list[dict]:
    init_path = DATA / "initiatives.json"
    overrides_path = DATA / "overrides.json"
    if not init_path.exists():
        print(f"No seed at {init_path}; nothing to migrate.")
        return []

    data = json.loads(init_path.read_text("utf-8"))
    snapshots = data.get("snapshots", [])
    if snapshots and "id" in snapshots[0]:
        print("Snapshots already carry an `id` -- nothing to migrate.")
        return []

    default_year = date.today().year
    identities = {s["code"]: _build_identity(
        s["code"], s.get("label"), default_year, bool(s.get("is_baseline")))
        for s in snapshots}

    if dry_run:
        print(f"Would migrate {len(identities)} snapshot(s):")
        return _print_report(identities)

    shutil.copy2(init_path, init_path.with_suffix(".json.bak"))
    if overrides_path.exists():
        shutil.copy2(overrides_path, overrides_path.with_suffix(".json.bak"))

    data["snapshots"] = list(identities.values())
    for row in data.get("initiatives", []):
        code = row.pop("snapshot_code", None)
        if code in identities:
            row["snapshot_id"] = identities[code]["id"]
            row["id"] = (f"{row['snapshot_id']}:{row.get('bu_code')}:"
                         f"{row.get('source_initiative_id')}")
    init_path.write_text(json.dumps(data, ensure_ascii=False, default=str), "utf-8")

    if overrides_path.exists():
        overrides = json.loads(overrides_path.read_text("utf-8"))
        rewritten = {}
        for key, value in overrides.items():
            m = _SUMMARY_KEY.match(key)
            if m and m.group("code") in identities:
                key = f"summary:{identities[m.group('code')]['id']}:{m.group('rest')}"
            elif any(code in key for code in identities):
                print(f"  WARNING: override key '{key}' references a legacy code "
                      f"outside the recognised `summary:<code>:...` form -- check "
                      f"it by hand.")
            rewritten[key] = value
        overrides_path.write_text(
            json.dumps(rewritten, indent=2, ensure_ascii=False), "utf-8")

    print(f"Migrated {len(identities)} snapshot(s).")
    return _print_report(identities)


# ===================================================================== sql ===
def migrate_sql(dry_run: bool) -> list[dict]:
    from sqlalchemy import select

    from backend.app.core import session_scope
    from backend.app.models import Initiative, LoadBatch, Override, Snapshot

    with session_scope() as session:
        legacy = [s for s in session.scalars(select(Snapshot)).all()
                  if not (s.period_key or "")]
        if not legacy:
            print("No legacy-shaped snapshots found -- nothing to migrate.")
            return []

        default_year = date.today().year
        identities = {s.id: _build_identity(s.id, s.label, default_year,
                                            bool(s.is_baseline)) for s in legacy}

        if dry_run:
            print(f"Would migrate {len(identities)} snapshot(s):")
            return _print_report(identities)

        # The PK changes value, and both children carry a plain FK (no
        # ON UPDATE CASCADE) -- so each old row is replaced rather than
        # updated in place: insert the new Snapshot, repoint every child,
        # then delete the old row.
        for old_code, ident in identities.items():
            session.add(Snapshot(**{k: v for k, v in ident.items() if k != "as_of_date"}))
            session.flush()
            session.execute(Initiative.__table__.update()
                            .where(Initiative.snapshot_id == old_code)
                            .values(snapshot_id=ident["id"]))
            session.execute(LoadBatch.__table__.update()
                            .where(LoadBatch.snapshot_id == old_code)
                            .values(snapshot_id=ident["id"]))
            for row in session.scalars(select(Override).where(
                    Override.scope == f"summary:{old_code}")).all():
                row.scope = f"summary/{ident['id']}"
            old = session.get(Snapshot, old_code)
            if old is not None:
                session.delete(old)

        print(f"Migrated {len(identities)} snapshot(s).")
        return _print_report(identities)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print what would change; write nothing.")
    parser.add_argument("--report-file", type=Path, default=None,
                        help="Write the needs_review report as JSON to this path.")
    args = parser.parse_args()

    import os
    backend = os.environ.get("DATA_BACKEND", "json")
    report = migrate_sql(args.dry_run) if backend == "sql" else migrate_json(args.dry_run)

    if report:
        print(f"\n{len(report)} snapshot(s) flagged needs_review -- "
              f"confirm the fiscal year by hand; nothing was auto-fixed.")
        if args.report_file:
            args.report_file.write_text(json.dumps(report, indent=2), "utf-8")
            print(f"Report written to {args.report_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
