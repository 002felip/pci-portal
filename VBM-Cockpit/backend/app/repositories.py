"""
The storage seam -- contracts and both implementations.

INTERFACE SEGREGATION (the 'I' that the old build did not have)
---------------------------------------------------------------
The previous version had ONE 13-method `Repository` Protocol. Every consumer
depended on all of it: the read-only analytics routes were structurally coupled
to `put_override` and to the upload path, and a hypothetical read-replica or
cache-only implementation would have had to stub methods it had no business
owning.

It is split into four narrow roles:

    PeriodSource     what periods exist          (periods.py depends on this)
    ReadRepository   query the register          (analytics routes)
    WriteRepository  create/patch/delete rows    (the Initiatives editor)
    OverrideStore    pinned headline figures     (the compare editor)

`FullRepository` is the union, and is what the two concrete classes satisfy.
Routers depend on the narrowest role they actually need (DIP), which is what
makes a read-only deployment or a caching decorator a drop-in rather than a
refactor.

LISKOV, CONCRETELY
------------------
Both implementations return the same plain dicts and delegate every calculation
to analytics.py, so no caller can tell them apart except by `backend`. That is
the property that lets `DATA_BACKEND` be a single environment variable.
"""

from __future__ import annotations

import json
import threading
import uuid as _uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Protocol, Sequence, runtime_checkable

from .analytics import (
    build_compare, build_completeness, build_monthly, build_quarters,
    build_stage_matrix, build_top, build_tree, summary_scope,
)
from .core import DEFAULT_SEED_DIR, get_settings, resolve_under_repo
from .periods import PeriodResolver, enrich_snapshot, years_from_metrics
from .registry import INITIATIVE_FIELDS, BY_COLUMN, Kind, coerce
from .schemas import (
    CompareOut, CompletenessOut, InitiativeListOut, InitiativeOut, MonthlySeries,
    OverrideOut, QuarterOut, SettingOut, SnapshotOut, StageMatrixOut, TopOut, TreeOut,
)

_LOCK = threading.RLock()
EMPTY: dict[str, Any] = {"snapshots": [], "initiatives": []}

COLUMNS = [f.column for f in INITIATIVE_FIELDS]
DERIVED = ("planned_end_year", "planned_end_quarter")


# ================================================================ contracts ==
@runtime_checkable
class PeriodSource(Protocol):
    def list_snapshots(self) -> list[SnapshotOut]: ...
    def distinct_years(self) -> list[int]: ...


@runtime_checkable
class ReadRepository(PeriodSource, Protocol):
    backend: str

    def list_initiatives(self, query) -> InitiativeListOut: ...
    def get_initiative(self, initiative_id: str) -> dict | None: ...
    def rows(self, snapshot: str, with_metrics: bool = False) -> list[dict]: ...


@runtime_checkable
class WriteRepository(Protocol):
    def create_initiative(self, payload: dict) -> dict: ...
    def patch_initiative(self, initiative_id: str, patch: dict,
                         actor: str | None = None) -> dict: ...
    def delete_initiative(self, initiative_id: str) -> bool: ...
    def upsert_snapshot(self, identity: dict) -> None: ...
    def replace_snapshot(self, snapshot: dict, records: list[dict]) -> dict[str, int]: ...


@runtime_checkable
class OverrideStore(Protocol):
    def get_overrides(self, scope: str) -> list[OverrideOut]: ...
    def override_map(self, scope: str) -> dict[str, dict]: ...
    def put_override(self, scope: str, scope_key: str, payload: dict) -> OverrideOut: ...
    def delete_override(self, scope: str, scope_key: str) -> None: ...


@runtime_checkable
class SettingStore(Protocol):
    """Shared UI/presentation configuration -- see `AppSetting` for the split
    from `OverrideStore`."""

    def get_setting(self, key: str) -> SettingOut | None: ...
    def put_setting(self, key: str, payload: dict) -> SettingOut: ...
    def delete_setting(self, key: str) -> None: ...


class FullRepository(ReadRepository, WriteRepository, OverrideStore, SettingStore,
                     Protocol):
    """The union. Concrete backends satisfy this; consumers should not ask for it."""


# ================================================= shared analytics mixin ====
class AnalyticsMixin:
    """
    Template Method: the analytics surface is implemented ONCE against
    `rows()`, which is the only thing the two backends implement differently.

    This is the mechanical guarantee behind "the two backends cannot disagree" --
    there is no second copy of these six calls to drift.
    """

    def resolver(self, current_user: str | None = None) -> PeriodResolver:
        s = get_settings()
        return PeriodResolver(self.list_snapshots(), self.distinct_years(),
                              s.pinned_snapshot, s.pinned_year, current_user)

    def compare(self, snapshot_a: str, snapshot_b: str) -> CompareOut:
        return build_compare(
            self.rows(snapshot_a), self.rows(snapshot_b), snapshot_a, snapshot_b,
            self.override_map(summary_scope(snapshot_a)),
            self.override_map(summary_scope(snapshot_b)))

    def top(self, snapshot_a: str, snapshot_b: str, limit: int) -> TopOut:
        return build_top(self.rows(snapshot_a), self.rows(snapshot_b),
                         snapshot_a, snapshot_b, limit,
                         self.override_map(f"top:{snapshot_a}>{snapshot_b}")
                         or self.override_map("top10"))

    def monthly(self, snapshot: str, year: int,
                cutoff_month: int | None = None) -> MonthlySeries:
        return build_monthly(self.rows(snapshot, with_metrics=True), year, cutoff_month)

    def quarters(self, snapshot: str, stack_by: str) -> QuarterOut:
        return build_quarters(self.rows(snapshot), stack_by)

    def stage_matrix(self, snapshot: str) -> StageMatrixOut:
        return build_stage_matrix(self.rows(snapshot))

    def tree(self, snapshot: str, levels: list[str]) -> TreeOut:
        rows = self.rows(snapshot)
        return TreeOut(levels=levels, total=len(rows),
                       on_track=sum(1 for r in rows if r.get("track_code") == "ON"),
                       value_musd=round(sum(float(r.get("value_target_cy") or 0)
                                            for r in rows) / 1e6, 1),
                       nodes=build_tree(rows, levels))

    def completeness(self, snapshot: str, scope: str) -> CompletenessOut:
        return build_completeness(self.rows(snapshot, with_metrics=True), scope)


# ================================================================== helpers ==
def apply_registry_coercion(payload: dict) -> dict:
    """
    Every write goes through the registry's coercers. A hand-edit from the UI
    and a cell from the workbook are normalised by the same code, so the editor
    cannot introduce a value the ETL would have rejected.
    """
    out: dict[str, Any] = {}
    for column, value in payload.items():
        spec = BY_COLUMN.get(column)
        out[column] = coerce(spec, value) if spec else value
    if "planned_end" in out and out["planned_end"]:
        d = out["planned_end"]
        if isinstance(d, str):
            d = date.fromisoformat(d[:10])
        out["planned_end_year"] = d.year
        out["planned_end_quarter"] = (d.month - 1) // 3 + 1
    return out


def matches(row: dict, query) -> bool:
    for column, wanted in (query.filters or {}).items():
        if wanted and row.get(column) not in wanted:
            return False
    if query.search:
        hay = " ".join(str(row.get(k) or "") for k in
                       ("source_initiative_id", "name", "owner", "kpi_name", "site")).lower()
        if query.search.lower() not in hay:
            return False
    return True


# ============================================================== JSON backend ==
class SeedMissingError(RuntimeError):
    """DATA_BACKEND=json but there is no seed to serve."""


_SEED_HINT = 'make seed EXCEL="./resources/VBM_BU_Register_Master.xlsm"'


class JsonRepository(AnalyticsMixin):
    """
    Zero-infrastructure backend: local dev, CI, demos on a laptop, and the
    fallback when Lakebase is unreachable. Same canonical shapes as SQL.

    Read paths never create directories -- that is what turned a configuration
    error into a silently empty dashboard in the previous build. The cache is
    keyed on (mtime, size) so re-seeding a running server is picked up.
    """

    backend = "json"

    def __init__(self, seed_dir: str | Path | None = None) -> None:
        s = get_settings()
        self.dir = resolve_under_repo(seed_dir or s.seed_dir or DEFAULT_SEED_DIR)
        self._cache: dict[str, Any] | None = None
        self._stamp: tuple[float, int] | None = None

    @property
    def initiatives_path(self) -> Path:
        return self.dir / "initiatives.json"

    @property
    def overrides_path(self) -> Path:
        return self.dir / "overrides.json"

    @property
    def settings_path(self) -> Path:
        return self.dir / "settings.json"

    @staticmethod
    def _stamp_of(path: Path) -> tuple[float, int] | None:
        try:
            st = path.stat()
        except FileNotFoundError:
            return None
        return (st.st_mtime, st.st_size)

    def _load(self) -> dict[str, Any]:
        with _LOCK:
            stamp = self._stamp_of(self.initiatives_path)
            if stamp is None:
                raise SeedMissingError(
                    f"No seed at {self.initiatives_path}.\n"
                    f"  Build it with: {_SEED_HINT}\n"
                    f"  Or set SEED_DIR=/abs/path, or DATA_BACKEND=sql.")
            if self._cache is None or stamp != self._stamp:
                self._cache = json.loads(self.initiatives_path.read_text("utf-8"))
                self._stamp = stamp
            return self._cache

    def _load_or_empty(self) -> dict[str, Any]:
        try:
            return self._load()
        except SeedMissingError:
            return json.loads(json.dumps(EMPTY))

    def _flush(self, data: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)     # writing MAY create
        self.initiatives_path.write_text(json.dumps(data, ensure_ascii=False,
                                                    default=str), "utf-8")
        self._cache = data
        self._stamp = self._stamp_of(self.initiatives_path)

    # ------------------------------------------------------------ periods --
    def list_snapshots(self) -> list[SnapshotOut]:
        data = self._load()
        counts: dict[str, int] = {}
        for r in data.get("initiatives", []):
            counts[r.get("snapshot_id", "?")] = counts.get(r.get("snapshot_id", "?"), 0) + 1
        out = []
        for s in data.get("snapshots", []):
            merged = {**enrich_snapshot(s["id"], s.get("label"), snapshot_id=s["id"]), **s}
            merged["initiative_count"] = counts.get(s["id"], 0)
            out.append(SnapshotOut(**{k: v for k, v in merged.items()
                                      if k in SnapshotOut.model_fields}))
        return out

    def distinct_years(self) -> list[int]:
        return sorted(years_from_metrics(self._load_or_empty().get("initiatives", [])))

    # --------------------------------------------------------------- read --
    def rows(self, snapshot: str | None, with_metrics: bool = False) -> list[dict]:
        rows = self._load().get("initiatives", [])
        return [r for r in rows if r.get("snapshot_id") == snapshot] if snapshot else rows

    def get_initiative(self, initiative_id: str) -> dict | None:
        return next((r for r in self._load().get("initiatives", [])
                     if str(r.get("id")) == initiative_id), None)

    def list_initiatives(self, query) -> InitiativeListOut:
        filtered = [r for r in self.rows(query.snapshot) if matches(r, query)]
        page = filtered[query.offset: query.offset + query.limit]
        items = []
        for r in page:
            payload = dict(r)
            payload["id"] = str(payload.get("id"))
            if not query.include_metrics:
                payload["metrics"] = []
            items.append(InitiativeOut(**{k: v for k, v in payload.items()
                                          if k in InitiativeOut.model_fields}))
        return InitiativeListOut(total=len(filtered), items=items)

    # -------------------------------------------------------------- write --
    def create_initiative(self, payload: dict) -> dict:
        with _LOCK:
            data = self._load_or_empty()
            row = apply_registry_coercion(payload)
            snapshot = row.get("snapshot_id") or payload.get("snapshot_id")
            row["snapshot_id"] = snapshot
            row.setdefault("source_initiative_id", f"NEW-{_uuid.uuid4().hex[:6].upper()}")
            row["id"] = f"{snapshot}:{row.get('bu_code')}:{row['source_initiative_id']}"
            row.setdefault("metrics", [])
            row["updated_at"] = datetime.now(timezone.utc).isoformat()
            # Created by hand, not by a workbook load -- no source_value to
            # carry-forward-compare against, ever.
            row["edited_fields"] = {k: {"source_value": None, "needs_review": False}
                                    for k in payload if k in COLUMNS}
            if any(str(r.get("id")) == row["id"] for r in data["initiatives"]):
                raise ValueError(f"Initiative {row['id']} already exists.")
            data["initiatives"].append(row)
            self._ensure_snapshot(data, snapshot)
            self._flush(data)
            return row

    def patch_initiative(self, initiative_id: str, patch: dict,
                         actor: str | None = None) -> dict:
        with _LOCK:
            data = self._load_or_empty()
            for row in data["initiatives"]:
                if str(row.get("id")) != initiative_id:
                    continue
                edited = dict(row.get("edited_fields") or {})
                coerced = apply_registry_coercion(patch)
                for column in coerced:
                    if column not in COLUMNS:
                        continue
                    # `source_value` is the workbook value this edit overrides --
                    # captured once, before the patch lands, so a later cross-
                    # snapshot carry-forward (replace_snapshot) has something to
                    # compare the next workbook load against. Re-editing an
                    # already-edited field just clears any pending review flag;
                    # it does not move the baseline.
                    prior = edited.get(column)
                    if isinstance(prior, dict):
                        prior["needs_review"] = False
                    else:
                        edited[column] = {"source_value": row.get(column),
                                          "needs_review": False}
                row.update(coerced)
                row["updated_at"] = datetime.now(timezone.utc).isoformat()
                row["updated_by"] = actor
                row["edited_fields"] = edited
                self._flush(data)
                return row
            raise KeyError(initiative_id)

    def delete_initiative(self, initiative_id: str) -> bool:
        with _LOCK:
            data = self._load_or_empty()
            before = len(data["initiatives"])
            data["initiatives"] = [r for r in data["initiatives"]
                                   if str(r.get("id")) != initiative_id]
            changed = len(data["initiatives"]) != before
            if changed:
                self._flush(data)
            return changed

    @staticmethod
    def _ensure_snapshot(data: dict, snapshot_id: str, label: str | None = None) -> None:
        """Fallback used by `create_initiative`, where `snapshot_id` is
        expected to already name a real snapshot -- this only synthesises one
        if it somehow does not exist yet."""
        snaps = {s["id"]: s for s in data.get("snapshots", [])}
        snaps.setdefault(snapshot_id, enrich_snapshot(
            snapshot_id, label, snapshot_id=snapshot_id))
        data["snapshots"] = sorted(snaps.values(), key=lambda s: s.get("sort_key", 999999))

    def upsert_snapshot(self, identity: dict) -> None:
        with _LOCK:
            data = self._load_or_empty()
            snaps = {s["id"]: s for s in data.get("snapshots", [])}
            snaps[identity["id"]] = {**snaps.get(identity["id"], {}), **identity}
            data["snapshots"] = sorted(snaps.values(), key=lambda s: s.get("sort_key", 999999))
            self._flush(data)

    def replace_snapshot(self, snapshot: dict, records: list[dict]) -> dict[str, int]:
        """
        `snapshot` is a fully-resolved identity dict (see
        `periods.enrich_snapshot`), not a raw code -- the caller resolves
        identity once, before parsing, so every record already carries the
        real `snapshot_id`.

        Curation continuity, in two tiers:
          * in-place reload (same snapshot_id): a hand-edit always wins outright.
          * cross-snapshot carry-forward (spec step 5.1): for a natural key with
            no in-place edit, inherit curation from the most recent OTHER
            published/locked snapshot that has it. Each carried field tracks
            its own `source_value` -- the workbook value it was edited away
            from. If this load's incoming value still matches that baseline,
            the curation carries silently and the baseline is unchanged; if it
            differs, the curated value still wins but the field is flagged
            `needs_review`, and the baseline rolls forward to this load's
            value (so the flag clears again once the source stabilises).
        """
        with _LOCK:
            data = self._load_or_empty()
            snapshot_id = snapshot["id"]
            snaps_by_id = {s["id"]: s for s in data.get("snapshots", [])}

            in_place = {r["id"]: (r.get("edited_fields") or {}, r)
                       for r in data["initiatives"]
                       if r.get("snapshot_id") == snapshot_id and r.get("edited_fields")}

            carry_candidates: dict[tuple[str, str], tuple[int, dict]] = {}
            for r in data["initiatives"]:
                if r.get("snapshot_id") == snapshot_id or not r.get("edited_fields"):
                    continue
                src = snaps_by_id.get(r.get("snapshot_id"))
                if not src or src.get("state") not in ("published", "locked"):
                    continue
                key = (r.get("bu_code"), r.get("source_initiative_id"))
                rank = src.get("sort_key", 0)
                if key not in carry_candidates or rank > carry_candidates[key][0]:
                    carry_candidates[key] = (rank, r)

            data["initiatives"] = [r for r in data["initiatives"]
                                   if r.get("snapshot_id") != snapshot_id]

            carried = carried_flagged = 0
            for rec in records:
                same = in_place.get(rec.get("id"))
                if same:
                    kept, old = same
                    rec.update({k: old.get(k) for k in kept})
                    rec["edited_fields"] = kept
                    continue
                key = (rec.get("bu_code"), rec.get("source_initiative_id"))
                prior = carry_candidates.get(key)
                if not prior:
                    continue
                _, old = prior
                new_edited: dict[str, Any] = {}
                for column, entry in (old.get("edited_fields") or {}).items():
                    if not entry:
                        continue
                    baseline = entry.get("source_value") if isinstance(entry, dict) else None
                    incoming = rec.get(column)
                    unchanged = isinstance(entry, dict) and incoming == baseline
                    new_edited[column] = {
                        "source_value": baseline if unchanged else incoming,
                        "needs_review": not unchanged,
                    }
                    rec[column] = old.get(column)          # the curated value wins
                if new_edited:
                    carried += 1
                    if any(v.get("needs_review") for v in new_edited.values()):
                        carried_flagged += 1
                    rec["edited_fields"] = new_edited

            data["initiatives"].extend(records)
            snaps = {s["id"]: s for s in data.get("snapshots", [])}
            snaps[snapshot_id] = {**snaps.get(snapshot_id, {}), **snapshot}
            data["snapshots"] = sorted(snaps.values(), key=lambda s: s.get("sort_key", 999999))
            self._flush(data)
            return {"written": len(records), "carried_edits": carried,
                    "carried_edits_flagged": carried_flagged}

    # ---------------------------------------------------------- overrides --
    def _overrides(self) -> dict[str, dict[str, Any]]:
        if not self.overrides_path.exists():
            return {}
        return json.loads(self.overrides_path.read_text("utf-8"))

    def _write_overrides(self, data: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.overrides_path.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                                       "utf-8")

    def override_map(self, scope: str) -> dict[str, dict]:
        prefix = f"{scope}:"
        return {k[len(prefix):]: v["payload"]
                for k, v in self._overrides().items() if k.startswith(prefix)}

    def get_overrides(self, scope: str) -> list[OverrideOut]:
        prefix = f"{scope}:"
        return [OverrideOut(scope=scope, scope_key=k[len(prefix):],
                            payload=v["payload"], updated_at=v.get("updated_at"))
                for k, v in self._overrides().items() if k.startswith(prefix)]

    def put_override(self, scope: str, scope_key: str, payload: dict) -> OverrideOut:
        with _LOCK:
            data = self._overrides()
            now = datetime.now(timezone.utc).isoformat()
            data[f"{scope}:{scope_key}"] = {"payload": payload, "updated_at": now}
            self._write_overrides(data)
        return OverrideOut(scope=scope, scope_key=scope_key, payload=payload,
                           updated_at=now)

    def delete_override(self, scope: str, scope_key: str) -> None:
        with _LOCK:
            data = self._overrides()
            data.pop(f"{scope}:{scope_key}", None)
            self._write_overrides(data)

    # ----------------------------------------------------------- settings --
    def _settings(self) -> dict[str, dict[str, Any]]:
        if not self.settings_path.exists():
            return {}
        return json.loads(self.settings_path.read_text("utf-8"))

    def _write_settings(self, data: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                                      "utf-8")

    def get_setting(self, key: str) -> SettingOut | None:
        row = self._settings().get(key)
        if row is None:
            return None
        return SettingOut(key=key, payload=row["payload"], updated_at=row.get("updated_at"))

    def put_setting(self, key: str, payload: dict) -> SettingOut:
        with _LOCK:
            data = self._settings()
            now = datetime.now(timezone.utc).isoformat()
            data[key] = {"payload": payload, "updated_at": now}
            self._write_settings(data)
        return SettingOut(key=key, payload=payload, updated_at=now)

    def delete_setting(self, key: str) -> None:
        with _LOCK:
            data = self._settings()
            data.pop(key, None)
            self._write_settings(data)

    def diagnostics(self) -> dict[str, Any]:
        stamp = self._stamp_of(self.initiatives_path)
        out = {"seed_dir": str(self.dir), "initiatives_file": str(self.initiatives_path),
               "seed_present": stamp is not None}
        if stamp is None:
            out["hint"] = f"Run: {_SEED_HINT}"
            return out
        rows = self._load().get("initiatives", [])
        counts: dict[str, int] = {}
        for r in rows:
            counts[r.get("snapshot_id", "?")] = counts.get(r.get("snapshot_id", "?"), 0) + 1
        out.update({"initiatives": len(rows), "by_snapshot": counts,
                    "years": self.distinct_years(), "file_bytes": stamp[1]})
        return out


# =============================================================== SQL backend ==
class SqlRepository(AnalyticsMixin):
    """Postgres / Lakebase. Identical contract; `DATA_BACKEND=sql` is the switch."""

    backend = "sql"

    def __init__(self, session) -> None:
        self.session = session

    # ------------------------------------------------------- row -> dict --
    @staticmethod
    def _to_dict(row, with_metrics: bool = False) -> dict[str, Any]:
        out: dict[str, Any] = {"id": str(row.id), "snapshot_id": row.snapshot_id}
        for column in COLUMNS + list(DERIVED):
            val = getattr(row, column, None)
            if hasattr(val, "__float__") and not isinstance(val, (bool, int, str, date)):
                val = float(val)
            out[column] = val
        out["edited_fields"] = row.edited_fields
        out["updated_at"] = row.updated_at.isoformat() if row.updated_at else None
        out["updated_by"] = row.updated_by
        if with_metrics:
            out["metrics"] = [
                {"metric_code": m.metric_code, "scenario_code": m.scenario_code,
                 "period_month": m.period_month,
                 "value": float(m.value) if m.value is not None else None}
                for m in sorted(row.metrics, key=lambda m: m.period_month)]
        else:
            out["metrics"] = []
        return out

    # ------------------------------------------------------------ periods --
    def list_snapshots(self) -> list[SnapshotOut]:
        from sqlalchemy import func, select

        from .models import Initiative, Snapshot

        counts = dict(self.session.execute(
            select(Initiative.snapshot_id, func.count()).group_by(
                Initiative.snapshot_id)).all())
        snaps = self.session.scalars(
            select(Snapshot).order_by(Snapshot.sort_key, Snapshot.id)).all()
        out = []
        for s in snaps:
            out.append(SnapshotOut(
                id=s.id, period_key=s.period_key, label=s.label,
                as_of_date=s.as_of_date, fiscal_year=s.fiscal_year,
                period_type=s.period_type, period_ordinal=s.period_ordinal,
                sort_key=s.sort_key, state=s.state, revision=s.revision,
                superseded_by=s.superseded_by, pinned=s.pinned,
                needs_review=s.needs_review, stored_filename=s.stored_filename,
                original_filename=s.original_filename, reason=s.reason,
                created_by=s.created_by, published_by=s.published_by,
                published_at=s.published_at.isoformat() if s.published_at else None,
                is_baseline=s.is_baseline,
                archived_at=s.archived_at.isoformat() if s.archived_at else None,
                archived_by=s.archived_by, notes=s.notes,
                uploaded_at=s.uploaded_at.isoformat() if s.uploaded_at else None,
                initiative_count=int(counts.get(s.id, 0))))
        return out

    def distinct_years(self) -> list[int]:
        from sqlalchemy import distinct, extract, select

        from .models import Initiative, InitiativeMetricMonthly

        years = set(self.session.scalars(select(distinct(
            extract("year", InitiativeMetricMonthly.period_month)))).all())
        years |= set(self.session.scalars(
            select(distinct(Initiative.planned_end_year))).all())
        return sorted(int(y) for y in years if y)

    # --------------------------------------------------------------- read --
    def _base(self, snapshot: str | None):
        from sqlalchemy import select

        from .models import Initiative

        stmt = select(Initiative)
        return stmt.where(Initiative.snapshot_id == snapshot) if snapshot else stmt

    def rows(self, snapshot: str | None, with_metrics: bool = False) -> list[dict]:
        from sqlalchemy.orm import selectinload

        from .models import Initiative

        stmt = self._base(snapshot)
        if with_metrics:
            stmt = stmt.options(selectinload(Initiative.metrics))
        return [self._to_dict(r, with_metrics) for r in self.session.scalars(stmt).all()]

    def get_initiative(self, initiative_id: str) -> dict | None:
        from sqlalchemy.orm import selectinload

        from .models import Initiative

        row = self.session.get(Initiative, _uuid.UUID(initiative_id),
                               options=[selectinload(Initiative.metrics)])
        return self._to_dict(row, with_metrics=True) if row else None

    def list_initiatives(self, query) -> InitiativeListOut:
        from sqlalchemy import func, select
        from sqlalchemy.orm import selectinload

        from .models import Initiative

        stmt = self._base(query.snapshot)
        # Filters are registry-driven: any `filterable` field works with no
        # per-column branch here.
        for column, wanted in (query.filters or {}).items():
            if wanted and column in COLUMNS:
                stmt = stmt.where(getattr(Initiative, column).in_(wanted))
        if query.search:
            like = f"%{query.search.lower()}%"
            stmt = stmt.where(
                func.lower(Initiative.name).like(like)
                | func.lower(Initiative.source_initiative_id).like(like)
                | func.lower(func.coalesce(Initiative.owner, "")).like(like)
                | func.lower(func.coalesce(Initiative.kpi_name, "")).like(like))

        total = self.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        stmt = (stmt.order_by(Initiative.bu_code, Initiative.source_initiative_id)
                .offset(query.offset).limit(query.limit))
        if query.include_metrics:
            stmt = stmt.options(selectinload(Initiative.metrics))

        items = [InitiativeOut(**{k: v for k, v in
                                  self._to_dict(r, query.include_metrics).items()
                                  if k in InitiativeOut.model_fields})
                 for r in self.session.scalars(stmt).all()]
        return InitiativeListOut(total=total, items=items)

    # -------------------------------------------------------------- write --
    def create_initiative(self, payload: dict) -> dict:
        from .models import Initiative, Snapshot

        data = apply_registry_coercion(payload)
        snapshot = payload.get("snapshot_id")
        if not self.session.get(Snapshot, snapshot):
            self.session.add(Snapshot(**{k: v for k, v in
                                         enrich_snapshot(snapshot, snapshot_id=snapshot).items()
                                         if k != "as_of_date"}))
            self.session.flush()      # parent first; see etl.load_parse_result
        data.setdefault("source_initiative_id", f"NEW-{_uuid.uuid4().hex[:6].upper()}")
        row = Initiative(snapshot_id=snapshot,
                         edited_fields={k: True for k in payload if k in COLUMNS},
                         **{k: v for k, v in data.items()
                            if k in COLUMNS + list(DERIVED)})
        self.session.add(row)
        self.session.flush()
        return self._to_dict(row)

    def patch_initiative(self, initiative_id: str, patch: dict,
                         actor: str | None = None) -> dict:
        from .models import Initiative

        row = self.session.get(Initiative, _uuid.UUID(initiative_id))
        if row is None:
            raise KeyError(initiative_id)
        for column, value in apply_registry_coercion(patch).items():
            if column in COLUMNS + list(DERIVED):
                setattr(row, column, value)
        edited = dict(row.edited_fields or {})
        edited.update({k: True for k in patch if k in COLUMNS})
        row.edited_fields = edited
        row.updated_by = actor
        self.session.flush()
        return self._to_dict(row)

    def delete_initiative(self, initiative_id: str) -> bool:
        from .models import Initiative

        row = self.session.get(Initiative, _uuid.UUID(initiative_id))
        if row is None:
            return False
        self.session.delete(row)
        return True

    def upsert_snapshot(self, identity: dict) -> None:
        from .models import Snapshot

        row = self.session.get(Snapshot, identity["id"])
        fields = {k: v for k, v in identity.items() if k != "as_of_date"}
        if row is None:
            self.session.add(Snapshot(**fields))
        else:
            for k, v in fields.items():
                setattr(row, k, v)
        self.session.flush()

    def replace_snapshot(self, snapshot: dict, records: list[dict]) -> dict[str, int]:
        # SQL loading is the ETL's job (etl.load_parse_result), which owns the
        # batch/lineage transaction. Present only to satisfy WriteRepository.
        raise NotImplementedError(
            "Use etl.load_parse_result for the SQL backend -- it owns lineage.")

    # ---------------------------------------------------------- overrides --
    def override_map(self, scope: str) -> dict[str, dict]:
        from sqlalchemy import select

        from .models import Override

        return {r.scope_key: r.payload for r in self.session.scalars(
            select(Override).where(Override.scope == scope)).all()}

    def get_overrides(self, scope: str) -> list[OverrideOut]:
        from sqlalchemy import select

        from .models import Override

        return [OverrideOut(scope=r.scope, scope_key=r.scope_key, payload=r.payload,
                            updated_at=r.updated_at.isoformat() if r.updated_at else None)
                for r in self.session.scalars(
                    select(Override).where(Override.scope == scope)).all()]

    def put_override(self, scope: str, scope_key: str, payload: dict) -> OverrideOut:
        from sqlalchemy import select

        from .models import Override

        row = self.session.scalar(select(Override).where(
            Override.scope == scope, Override.scope_key == scope_key))
        if row is None:
            row = Override(scope=scope, scope_key=scope_key, payload=payload)
            self.session.add(row)
        else:
            row.payload = payload
        self.session.flush()
        return OverrideOut(scope=scope, scope_key=scope_key, payload=payload,
                           updated_at=row.updated_at.isoformat() if row.updated_at else None)

    def delete_override(self, scope: str, scope_key: str) -> None:
        from sqlalchemy import select

        from .models import Override

        row = self.session.scalar(select(Override).where(
            Override.scope == scope, Override.scope_key == scope_key))
        if row is not None:
            self.session.delete(row)

    # ----------------------------------------------------------- settings --
    def get_setting(self, key: str) -> SettingOut | None:
        from .models import AppSetting

        row = self.session.get(AppSetting, key)
        if row is None:
            return None
        return SettingOut(key=key, payload=row.payload,
                          updated_at=row.updated_at.isoformat() if row.updated_at else None)

    def put_setting(self, key: str, payload: dict) -> SettingOut:
        from .models import AppSetting

        row = self.session.get(AppSetting, key)
        if row is None:
            row = AppSetting(key=key, payload=payload)
            self.session.add(row)
        else:
            row.payload = payload
        self.session.flush()
        return SettingOut(key=key, payload=payload,
                          updated_at=row.updated_at.isoformat() if row.updated_at else None)

    def delete_setting(self, key: str) -> None:
        from .models import AppSetting

        row = self.session.get(AppSetting, key)
        if row is not None:
            self.session.delete(row)


# ================================================================ selection ==
_json_singleton: JsonRepository | None = None


def json_repository() -> JsonRepository:
    global _json_singleton
    if _json_singleton is None:
        _json_singleton = JsonRepository()
    return _json_singleton


def get_repository():
    """
    FastAPI dependency. The ONLY place that knows which implementation is live
    (Dependency Inversion: routers receive a role, never a class).
    """
    s = get_settings()
    if s.data_backend == "sql":
        from .core import session_scope
        with session_scope() as session:
            yield SqlRepository(session)
    else:
        yield json_repository()
