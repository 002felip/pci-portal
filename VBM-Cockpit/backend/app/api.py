"""
All routes. Thin by construction -- every rule lives in registry.py,
analytics.py, periods.py or etl.py.

TWO STRUCTURAL CHANGES OVER THE PREVIOUS BUILD
----------------------------------------------
1. NO DEFAULT PERIOD IS WRITTEN HERE. There is no `snapshot_a: str = "Q1"` and
   no `year: int = 2026`. Every route resolves its window through
   `PeriodResolver`, which reads the data. An unknown code is a 400; it is never
   silently swapped for another quarter.

2. INITIATIVE CRUD. `/initiatives` gained POST / PATCH / DELETE, validated by
   the registry-generated `InitiativeCreate` / `InitiativePatch`, so the editor
   tab cannot write a value the ETL would have rejected.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import (
    APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile,
    status,
)

from .core import get_settings
from .periods import (
    NoPeriodsError, PeriodResolution, PeriodSelection, UnknownPeriodError,
    period_end_month, resolve_period,
)
from .registry import describe, groupable_dimensions
from .repositories import get_repository
from .schemas import (
    CompareOut, CompletenessOut, InitiativeCreate, InitiativeListOut,
    InitiativePatch, InitiativeQuery, MetaOut, MonthlySeries, OverrideIn,
    OverrideOut, PeriodOptions, QuarterOut, SettingIn, SettingOut, SnapshotOut,
    SnapshotPatch, SnapshotResolveOut, StageMatrixOut, TopOut, TreeOut,
    UploadReport, VocabItem,
)

log = logging.getLogger("cockpit.api")
router = APIRouter()

Repo = Annotated[Any, Depends(get_repository)]
def _actor(email: Annotated[str | None, Header(alias="X-Forwarded-Email")] = None,
           ) -> str | None:
    """The platform proxy's X-Forwarded-Email; locally, where there is no proxy,
    DEV_ACTOR stands in (ENVIRONMENT=local only -- see Settings.dev_actor)."""
    if email:
        return email
    s = get_settings()
    return s.dev_actor if s.environment == "local" else None


Actor = Annotated[str | None, Depends(_actor)]

DIMENSIONS = set(groupable_dimensions())


def _select(repo, snapshot: str | None = None, baseline: str | None = None,
            year: int | None = None, actor: str | None = None) -> PeriodSelection:
    """Resolve once, per request. The only entry point to a reporting window."""
    try:
        resolver = repo.resolver(actor)
        resolver.validate(snapshot, baseline)
        return resolver.resolve(snapshot, baseline, year)
    except UnknownPeriodError as exc:
        raise HTTPException(400, str(exc)) from exc
    except NoPeriodsError as exc:
        raise HTTPException(409, str(exc)) from exc


#: Fields a locked snapshot still accepts. `pinned` is picker placement, not a
#: figure -- a locked period stays in the pickers, so leadership must be able to
#: promote or demote it there without unlocking the numbers.
UNLOCKED_FIELDS = {"pinned"}


def _ensure_writable(repo, snapshot_id: str | None,
                     fields: set[str] | None = None) -> None:
    """A locked snapshot is the record of what leadership saw -- corrections
    always create a new revision rather than editing history in place. An
    archived snapshot is withdrawn from circulation, so editing it would be
    work nobody can see; restore it first.

    `fields` names the columns a caller intends to write; when every one of
    them is in `UNLOCKED_FIELDS` the locked check is skipped."""
    if not snapshot_id:
        return
    if fields and fields <= UNLOCKED_FIELDS:
        return
    snap = next((s for s in repo.list_snapshots() if s.id == snapshot_id), None)
    if snap is None:
        return
    if snap.state == "locked":
        raise HTTPException(409, f"Snapshot {snapshot_id} is locked; corrections "
                                 f"require a new revision.")
    if snap.archived_at:
        raise HTTPException(409, f"Snapshot {snapshot_id} is archived; restore it "
                                 f"before editing it.")


def _snapshot_id_from_scope(scope: str) -> str | None:
    prefix = "summary:"
    return scope[len(prefix):] if scope.startswith(prefix) else None


def _dimension(value: str, *, allow_none: bool = False) -> str:
    if value in DIMENSIONS or (allow_none and value == "none"):
        return value
    raise HTTPException(400, f"'{value}' is not a groupable dimension. "
                             f"Allowed: {sorted(DIMENSIONS)}")


_ORDINAL_RANGE = {"Q": (1, 4), "M": (1, 12), "H": (1, 2)}


def _validate_period_parts(period_type: str, period_ordinal: int | None) -> None:
    if period_type not in ("FY", "H", "Q", "M"):
        raise HTTPException(400, f"Invalid period_type '{period_type}'. "
                                 f"Allowed: FY, H, Q, M.")
    if period_type == "FY":
        if period_ordinal is not None:
            raise HTTPException(400, "period_ordinal must be omitted for period_type=FY.")
        return
    lo, hi = _ORDINAL_RANGE[period_type]
    if period_ordinal is None or not (lo <= period_ordinal <= hi):
        raise HTTPException(400, f"period_ordinal must be between {lo} and {hi} "
                                 f"for period_type={period_type}.")


def _resolve(repo, fiscal_year: int, period_type: str,
            period_ordinal: int | None, label: str | None = None) -> PeriodResolution:
    _validate_period_parts(period_type, period_ordinal)
    return resolve_period(repo.list_snapshots(), fiscal_year, period_type,
                          period_ordinal, label)


# ------------------------------------------------------------------ meta ----
@router.get("/health")
def health(repo: Repo) -> dict[str, Any]:
    s = get_settings()
    out: dict[str, Any] = {"status": "ok", "environment": s.environment,
                           "data_backend": s.data_backend, "lakebase": s.uses_lakebase}
    if hasattr(repo, "diagnostics"):
        out["seed"] = repo.diagnostics()
    if s.data_backend == "sql":
        from sqlalchemy import text

        from .core import get_engine
        try:
            with get_engine().connect() as conn:
                conn.execute(text("select 1"))
            out["database"] = "reachable"
        except Exception as exc:                     # noqa: BLE001
            out["status"] = "degraded"
            out["database"] = f"unreachable: {type(exc).__name__}"
    return out


@router.get("/meta", response_model=MetaOut)
def meta(repo: Repo, actor: Actor = None) -> MetaOut:
    """
    One call, everything the SPA needs to configure itself: which periods exist,
    what the vocabulary is, and the full field registry. The frontend builds its
    grid columns, editor form and filters from `registry` -- which is why a new
    field needs no TypeScript change.
    """
    reg = describe()
    return MetaOut(
        periods=repo.resolver(actor).options(),
        vocab={d: [VocabItem(**t) for t in v["terms"]] for d, v in reg["vocab"].items()},
        registry=reg,
        data_backend=repo.backend)


@router.get("/meta/periods", response_model=PeriodOptions)
def periods(repo: Repo, actor: Actor = None) -> PeriodOptions:
    """Cheap poll for the period pickers after an upload adds a new quarter."""
    return repo.resolver(actor).options()


@router.get("/snapshots/resolve", response_model=SnapshotResolveOut)
def resolve_snapshot(repo: Repo, fiscal_year: int, period_type: str,
                     period_ordinal: int | None = None,
                     actor: Actor = None) -> SnapshotResolveOut:
    """
    Backs the period builder's pre-submit state (spec §3.5): what loading
    this (fiscal_year, period_type, period_ordinal) would do, before the user
    commits to it. Cheap -- no file has been chosen yet.
    """
    res = _resolve(repo, fiscal_year, period_type, period_ordinal)
    ident = res.identity
    return SnapshotResolveOut(
        state=res.mode, existing_snapshot=res.existing,
        next_revision=ident["revision"],
        stored_filename=f"{ident['period_key']}_r{ident['revision']}_register",
        current_actor=actor)


@router.get("/meta/fields")
def fields() -> dict[str, Any]:
    """The registry as JSON. The contract between the schema and the UI."""
    return describe()


# ----------------------------------------------------------- initiatives ----
@router.get("/initiatives", response_model=InitiativeListOut)
def list_initiatives(
    repo: Repo,
    snapshot: str | None = None,
    filter_: list[str] | None = Query(default=None, alias="filter"),
    search: str | None = None,
    include_metrics: bool = False,
    limit: int = Query(default=5000, le=20000),
    offset: int = 0,
    actor: Actor = None,
) -> InitiativeListOut:
    """
    Filters are generic: `?filter=bu_code:SSG&filter=stage_code:IMPLEMENTING`.

    The old build had one query parameter per dimension, so a new filterable
    field meant editing this signature, the query model, both repositories and
    the UI. Now `filterable` in the registry is the only switch.
    """
    sel = _select(repo, snapshot, actor=actor)
    parsed: dict[str, list[str]] = {}
    for item in filter_ or []:
        column, _, value = item.partition(":")
        if column not in {f["column"] for f in describe()["fields"]}:
            raise HTTPException(400, f"Unknown filter field '{column}'.")
        parsed.setdefault(column, []).append(value)
    return repo.list_initiatives(InitiativeQuery(
        snapshot=sel.snapshot, filters=parsed, search=search,
        include_metrics=include_metrics, limit=limit, offset=offset))


@router.post("/initiatives", status_code=status.HTTP_201_CREATED)
def create_initiative(repo: Repo, body: InitiativeCreate,      # type: ignore[valid-type]
                      actor: Actor = None) -> dict[str, Any]:
    _ensure_writable(repo, getattr(body, "snapshot_id", None))
    try:
        return repo.create_initiative(body.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.patch("/initiatives/{initiative_id}")
def patch_initiative(repo: Repo, initiative_id: str,
                     body: InitiativePatch,                    # type: ignore[valid-type]
                     actor: Actor = None) -> dict[str, Any]:
    """
    PATCH, not PUT: the editor sends only the cells that changed, so two people
    editing different columns of the same initiative do not overwrite each other.
    Touched columns are recorded in `edited_fields` and the next Excel load
    leaves them alone.
    """
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(400, "Empty patch.")
    existing = repo.get_initiative(initiative_id)
    if existing is None:
        raise HTTPException(404, f"No initiative {initiative_id}.")
    _ensure_writable(repo, existing.get("snapshot_id"))
    try:
        return repo.patch_initiative(initiative_id, patch, actor)
    except KeyError as exc:
        raise HTTPException(404, f"No initiative {initiative_id}.") from exc


@router.delete("/initiatives/{initiative_id}")
def delete_initiative(repo: Repo, initiative_id: str) -> dict[str, bool]:
    existing = repo.get_initiative(initiative_id)
    if existing is not None:
        _ensure_writable(repo, existing.get("snapshot_id"))
    if not repo.delete_initiative(initiative_id):
        raise HTTPException(404, f"No initiative {initiative_id}.")
    return {"deleted": True}


# -------------------------------------------------------------- analytics ---
@router.get("/analytics/compare", response_model=CompareOut)
def compare(repo: Repo, snapshot: str | None = None,
            baseline: str | None = None, actor: Actor = None) -> CompareOut:
    """Any two snapshots. `baseline` defaults to the one before `snapshot`."""
    sel = _select(repo, snapshot, baseline, actor=actor)
    if sel.baseline is None:
        raise HTTPException(409, f"Only one snapshot ({sel.snapshot}) is loaded; "
                                 f"there is nothing to compare it with.")
    return repo.compare(*sel.pair)


@router.get("/analytics/top", response_model=TopOut)
def top(repo: Repo, snapshot: str | None = None, baseline: str | None = None,
        limit: int = Query(default=10, ge=3, le=25), actor: Actor = None) -> TopOut:
    sel = _select(repo, snapshot, baseline, actor=actor)
    if sel.baseline is None:
        raise HTTPException(409, "Need two snapshots to show movement.")
    return repo.top(*sel.pair, limit)


@router.get("/analytics/monthly", response_model=MonthlySeries)
def monthly(repo: Repo, snapshot: str | None = None,
            actor: Actor = None) -> MonthlySeries:
    """
    YTD financial target vs realized ($M) + KPI attainment. The year and the
    actuals cutoff both come from the snapshot: its fiscal year, and the last
    month its period covers (M05 -> May, Q3 -> September).
    """
    sel = _select(repo, snapshot, actor=actor)
    snap = next(s for s in repo.list_snapshots() if s.id == sel.snapshot)
    return repo.monthly(sel.snapshot, snap.fiscal_year,
                        period_end_month(snap.period_type, snap.period_ordinal))


@router.get("/analytics/quarters", response_model=QuarterOut)
def quarters(repo: Repo, snapshot: str | None = None,
             stack_by: str = "stage_code", actor: Actor = None) -> QuarterOut:
    sel = _select(repo, snapshot, actor=actor)
    return repo.quarters(sel.snapshot, _dimension(stack_by, allow_none=True))


@router.get("/analytics/stage-matrix", response_model=StageMatrixOut)
def stage_matrix(repo: Repo, snapshot: str | None = None,
                 actor: Actor = None) -> StageMatrixOut:
    return repo.stage_matrix(_select(repo, snapshot, actor=actor).snapshot)


@router.get("/analytics/tree", response_model=TreeOut)
def tree(repo: Repo, snapshot: str | None = None,
         levels: list[str] = Query(default=["bu_code", "stage_code"]),
         actor: Actor = None) -> TreeOut:
    """Powers the treemap AND the decomposition tree -- one grouping engine."""
    if not 1 <= len(levels) <= 5:
        raise HTTPException(400, "Provide between 1 and 5 levels.")
    return repo.tree(_select(repo, snapshot, actor=actor).snapshot,
                     [_dimension(l) for l in levels])


@router.get("/analytics/completeness", response_model=CompletenessOut)
def completeness(repo: Repo, snapshot: str | None = None,
                 scope: str = Query(default="required",
                                    pattern="^(required|all)$"),
                 actor: Actor = None) -> CompletenessOut:
    return repo.completeness(_select(repo, snapshot, actor=actor).snapshot, scope)


# ----------------------------------------------------------------- upload ---
@router.post("/uploads/excel", response_model=UploadReport)
async def upload_excel(repo: Repo, file: UploadFile = File(...),
                       fiscal_year: int = Form(...),
                       period_type: str = Form(...),
                       period_ordinal: int | None = Form(default=None),
                       label: str | None = Form(default=None),
                       reason: str | None = Form(default=None),
                       period_key: str | None = Form(default=None),
                       dry_run: bool = Form(default=False),
                       force: bool = Form(default=False),
                       actor: Actor = None) -> UploadReport:
    """
    Server-side parse + validation + idempotent load. The browser never
    interprets the workbook: it uploads bytes and receives a report.

    The period is a set of bounded dropdown selections (fiscal year, period
    type, ordinal), never a typed string -- `period_key` is derived here from
    those three values and rejected outright if the client sends one anyway.
    Identity is resolved before anything is parsed: a period that already has
    a published/locked snapshot becomes a revision (which requires `reason`);
    an existing draft is reloaded in place; anything else mints a new id.
    """
    if period_key is not None:
        raise HTTPException(400, "period_key is derived server-side; do not send it.")
    s = get_settings()
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm", ".xls")):
        raise HTTPException(400, "Upload a .xlsx or .xlsm workbook.")

    raw = await file.read()
    if len(raw) > s.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {s.max_upload_mb} MB.")

    resolution = _resolve(repo, fiscal_year, period_type, period_ordinal, label)
    if resolution.mode == "revision" and not (reason or "").strip():
        raise HTTPException(400, "A reason is required to create a new revision "
                                 "of an already-published period.")

    from datetime import datetime, timezone
    from io import BytesIO
    from pathlib import PurePosixPath

    from .etl import (
        LoadReport, load_parse_result, parse_workbook, records_to_json,
        sha256_bytes,
    )

    identity = dict(resolution.identity)
    if reason:
        identity["reason"] = reason
    # Whoever last loaded the bytes owns the draft. Reloading an existing draft
    # carries the previous owner's `created_by` forward (periods.resolve_period),
    # and a draft is only visible to its owner -- so without this transfer a
    # second uploader replaces the contents and then cannot find the snapshot.
    if actor or identity.get("created_by") is None:
        identity["created_by"] = actor
    # Re-stamped on every load, including a revision: the column answers how
    # fresh the current contents are. Safe to set before the dry-run branch --
    # neither backend persists the identity when nothing is written.
    identity["uploaded_at"] = datetime.now(timezone.utc).isoformat()
    ext = PurePosixPath(file.filename or "upload.xlsx").suffix or ".xlsx"
    identity["stored_filename"] = f"{identity['period_key']}_r{identity['revision']}_register{ext}"
    identity["original_filename"] = file.filename
    snapshot_id = identity["id"]

    try:
        parsed = parse_workbook(BytesIO(raw), snapshot_id=snapshot_id,
                                base_year=fiscal_year)
    except Exception as exc:                          # noqa: BLE001
        raise HTTPException(422, f"Could not parse workbook: {exc}") from exc

    name = file.filename or "upload.xlsx"

    if s.data_backend == "sql":
        from .core import session_scope
        with session_scope() as session:
            report = load_parse_result(session, parsed, raw_bytes=raw,
                                       source_name=name, snapshot_id=snapshot_id,
                                       dry_run=dry_run, force=force,
                                       snapshot_identity=identity)
        return UploadReport(**report.as_dict())

    digest = sha256_bytes(raw)
    warnings = [i.as_dict() for i in parsed.issues if i.severity == "warning"]
    errors = [i.as_dict() for i in parsed.errors]
    common = dict(batch_id="", snapshot_id=snapshot_id, period_key=identity["period_key"],
                  revision=identity.get("revision", 1), state=identity.get("state"),
                  stored_filename=identity.get("stored_filename"),
                  original_filename=identity.get("original_filename"),
                  source_name=name, content_sha256=digest, warnings=warnings, errors=errors)

    if errors:
        return UploadReport(**LoadReport(
            status="failed", **common,
            message=f"{len(errors)} blocking error(s); nothing written.").as_dict())
    if dry_run:
        return UploadReport(**LoadReport(
            status="dry_run", **common, initiatives_inserted=len(parsed.records),
            metric_rows=sum(len(r.metrics) for r in parsed.records),
            message="Validation only - no rows written.").as_dict())

    result = repo.replace_snapshot(
        identity, records_to_json(parsed.records, snapshot_id, digest[:12]))
    written = result["written"]
    return UploadReport(**LoadReport(
        status="loaded", **{**common, "batch_id": digest[:12]},
        initiatives_inserted=written,
        metric_rows=sum(len(r.metrics) for r in parsed.records),
        carried_edits=result["carried_edits"],
        carried_edits_flagged=result["carried_edits_flagged"],
        message=f"{written} initiatives written to the local JSON store.").as_dict())


# -------------------------------------------------------------- overrides ---
@router.get("/overrides/{scope}", response_model=list[OverrideOut])
def get_overrides(repo: Repo, scope: str) -> list[OverrideOut]:
    return repo.get_overrides(scope)


@router.put("/overrides/{scope}/{scope_key}", response_model=OverrideOut)
def put_override(repo: Repo, scope: str, scope_key: str,
                 body: OverrideIn) -> OverrideOut:
    _ensure_writable(repo, _snapshot_id_from_scope(scope))
    return repo.put_override(scope, scope_key, body.payload)


@router.delete("/overrides/{scope}/{scope_key}")
def delete_override(repo: Repo, scope: str, scope_key: str) -> dict[str, bool]:
    _ensure_writable(repo, _snapshot_id_from_scope(scope))
    repo.delete_override(scope, scope_key)
    return {"deleted": True}


# --------------------------------------------------------------- lifecycle ---
@router.get("/snapshots", response_model=list[SnapshotOut])
def list_snapshots(repo: Repo) -> list[SnapshotOut]:
    """
    Every snapshot, unfiltered -- the administrative view behind the Snapshots
    page. Deliberately bypasses `PeriodResolver`, which exists to answer a
    different question ("what may a picker offer?") and therefore hides locked,
    archived and other users' draft snapshots. Already ordered by sort_key.
    """
    return repo.list_snapshots()


def _ensure_may_unlock(actor: str | None) -> None:
    """Unlocking reverses a sign-off, so it is restricted to the operators named
    in UNLOCK_ADMINS. An unset list means nobody may unlock -- an environment
    that never configured this should not silently allow everyone."""
    allowed = get_settings().unlock_admin_list
    if not allowed:
        raise HTTPException(403, "Unlocking is not enabled in this environment. "
                                 "Set UNLOCK_ADMINS to the operators who may "
                                 "reopen a locked period.")
    if not actor or actor.strip().lower() not in allowed:
        raise HTTPException(403, f"{actor or 'This user'} may not unlock a "
                                 f"snapshot. Ask one of: {', '.join(allowed)}.")


def _refetch(repo, snapshot_id: str) -> SnapshotOut:
    snap = next((s for s in repo.list_snapshots() if s.id == snapshot_id), None)
    if snap is None:
        raise HTTPException(404, f"No snapshot {snapshot_id}.")
    return snap


@router.post("/snapshots/{snapshot_id}/publish", response_model=SnapshotOut)
def publish_snapshot(repo: Repo, snapshot_id: str, actor: Actor = None) -> SnapshotOut:
    """
    draft -> published. A published snapshot is the record of what leadership
    saw on that date -- publishing locks the prior published revision of the
    same period_key (it stays queryable, disappears from pickers) and stamps
    `superseded_by` on it.
    """
    from datetime import datetime, timezone

    snap = _refetch(repo, snapshot_id)
    if snap.state != "draft":
        raise HTTPException(409, f"Snapshot {snapshot_id} is not a draft "
                                 f"(state={snap.state}).")
    if snap.initiative_count == 0:
        raise HTTPException(409, "Cannot publish an empty snapshot.")

    now = datetime.now(timezone.utc).isoformat()
    updated = {**snap.model_dump(), "state": "published",
              "published_at": now, "published_by": actor}
    repo.upsert_snapshot(updated)

    prior = next((s for s in repo.list_snapshots()
                 if s.period_key == snap.period_key and s.id != snap.id
                 and s.state == "published"), None)
    if prior:
        repo.upsert_snapshot({**prior.model_dump(), "state": "locked",
                             "superseded_by": snap.id})

    return _refetch(repo, snapshot_id)


@router.post("/snapshots/{snapshot_id}/close", response_model=SnapshotOut)
def close_snapshot(repo: Repo, snapshot_id: str) -> SnapshotOut:
    """published -> locked, manually. Corrections after this create a new
    revision; nothing may write to a locked snapshot again except the fields in
    `UNLOCKED_FIELDS`.

    A locked snapshot STAYS in every picker: it is the record of what leadership
    saw, and they still need to open it on the portfolio pages. Withdrawing a
    period from circulation is what `archive_snapshot` is for."""
    snap = _refetch(repo, snapshot_id)
    if snap.state != "published":
        raise HTTPException(409, f"Only a published snapshot can be closed "
                                 f"(state={snap.state}).")
    repo.upsert_snapshot({**snap.model_dump(), "state": "locked"})
    return _refetch(repo, snapshot_id)


@router.delete("/snapshots/{snapshot_id}/close", response_model=SnapshotOut)
def reopen_snapshot(repo: Repo, snapshot_id: str,
                    actor: Actor = None) -> SnapshotOut:
    """
    locked -> published, reversing a sign-off. Restricted to UNLOCK_ADMINS (see
    `_ensure_may_unlock`) because a locked snapshot is the record of what
    leadership was shown; reopening it makes those figures editable again.

    The revision history is untouched, so the audit trail still shows the period
    was locked and by whom.
    """
    _ensure_may_unlock(actor)
    snap = _refetch(repo, snapshot_id)
    if snap.state != "locked":
        raise HTTPException(409, f"Only a locked snapshot can be reopened "
                                 f"(state={snap.state}).")
    repo.upsert_snapshot({**snap.model_dump(), "state": "published"})
    return _refetch(repo, snapshot_id)


@router.post("/snapshots/{snapshot_id}/plan-baseline", response_model=SnapshotOut)
def set_plan_baseline(repo: Repo, snapshot_id: str) -> SnapshotOut:
    """
    Designates this snapshot as its fiscal year's plan/budget baseline -- the
    fixed anchor the "plan" comparison mode resolves to, regardless of which
    period is currently selected (unlike "sequential"/"yoy", which shift with
    the current selection). Implies `pinned`, since an un-pinned plan
    baseline could otherwise age out of the picker. Clears the flag from any
    other snapshot in the same fiscal year first, since exactly one plan
    baseline should be resolvable.
    """
    snap = _refetch(repo, snapshot_id)
    for other in repo.list_snapshots():
        if other.fiscal_year == snap.fiscal_year and other.id != snap.id and other.is_baseline:
            repo.upsert_snapshot({**other.model_dump(), "is_baseline": False})
    repo.upsert_snapshot({**snap.model_dump(), "is_baseline": True, "pinned": True})
    return _refetch(repo, snapshot_id)


@router.delete("/snapshots/{snapshot_id}/plan-baseline", response_model=SnapshotOut)
def clear_plan_baseline(repo: Repo, snapshot_id: str) -> SnapshotOut:
    """Unsets the plan-baseline flag. Leaves `pinned` as-is -- a snapshot may
    still be worth pinning for other reasons."""
    snap = _refetch(repo, snapshot_id)
    repo.upsert_snapshot({**snap.model_dump(), "is_baseline": False})
    return _refetch(repo, snapshot_id)


@router.patch("/snapshots/{snapshot_id}", response_model=SnapshotOut)
def patch_snapshot(repo: Repo, snapshot_id: str, patch: SnapshotPatch) -> SnapshotOut:
    """
    Edits the three operator-owned fields (`label`, `notes`, `pinned`).
    Everything else about a snapshot is either derived from the period it
    describes or owned by a lifecycle transition -- see `SnapshotPatch`.
    """
    snap = _refetch(repo, snapshot_id)
    changes = patch.model_dump(exclude_unset=True)
    _ensure_writable(repo, snapshot_id, fields=set(changes))

    if "label" in changes:
        label = (changes["label"] or "").strip()
        if not label:
            raise HTTPException(400, "A snapshot label cannot be blank -- it is "
                                     "what every period picker shows.")
        changes["label"] = label[:120]
    if "notes" in changes:
        notes = (changes["notes"] or "").strip()
        changes["notes"] = notes or None
    if changes.get("pinned") is False and snap.is_baseline:
        raise HTTPException(409, f"'{snap.label}' is the plan baseline for FY"
                                 f"{snap.fiscal_year}, and the plan comparison "
                                 f"resolves only to a pinned baseline. Clear the "
                                 f"plan baseline first, then unpin.")
    if not changes:
        return snap

    repo.upsert_snapshot({**snap.model_dump(), **changes})
    return _refetch(repo, snapshot_id)


@router.post("/snapshots/{snapshot_id}/archive", response_model=SnapshotOut)
def archive_snapshot(repo: Repo, snapshot_id: str, actor: Actor = None) -> SnapshotOut:
    """
    Withdraws a snapshot from every picker without destroying anything -- the
    row, its initiatives and its lineage all survive, and `restore_snapshot`
    undoes this exactly. The recourse for a bad load (wrong workbook, mis-typed
    period, test upload), where publishing a corrective revision is the wrong
    tool because the snapshot should never have existed.

    Archiving is orthogonal to `state`, so a draft, a published and a locked
    snapshot can each be archived and each comes back as what it was.
    """
    from datetime import datetime, timezone

    snap = _refetch(repo, snapshot_id)
    if snap.archived_at:
        raise HTTPException(409, f"Snapshot {snapshot_id} is already archived.")
    if snap.is_baseline:
        raise HTTPException(409, f"'{snap.label}' is the plan baseline for FY"
                                 f"{snap.fiscal_year}. Clear the plan baseline "
                                 f"first, then archive it.")

    now = datetime.now(timezone.utc).isoformat()
    repo.upsert_snapshot({**snap.model_dump(), "archived_at": now,
                          "archived_by": actor})
    return _refetch(repo, snapshot_id)


@router.delete("/snapshots/{snapshot_id}/archive", response_model=SnapshotOut)
def restore_snapshot(repo: Repo, snapshot_id: str) -> SnapshotOut:
    """Puts an archived snapshot back in circulation, in whatever state it
    held before. Also happens implicitly when the period is re-uploaded."""
    snap = _refetch(repo, snapshot_id)
    if not snap.archived_at:
        raise HTTPException(409, f"Snapshot {snapshot_id} is not archived.")
    repo.upsert_snapshot({**snap.model_dump(), "archived_at": None,
                          "archived_by": None})
    return _refetch(repo, snapshot_id)


# ---------------------------------------------------------------- settings ---
# Shared UI/presentation configuration -- e.g. the funnel stage order/labels.
# Distinct from /overrides, which curates figures, not display config.
@router.get("/settings/{key}", response_model=SettingOut | None)
def get_setting(repo: Repo, key: str) -> SettingOut | None:
    return repo.get_setting(key)


@router.put("/settings/{key}", response_model=SettingOut)
def put_setting(repo: Repo, key: str, body: SettingIn) -> SettingOut:
    return repo.put_setting(key, body.payload)


@router.delete("/settings/{key}")
def delete_setting(repo: Repo, key: str) -> dict[str, bool]:
    repo.delete_setting(key)
    return {"deleted": True}
