"""
Wire contracts.

`InitiativeOut`, `InitiativeCreate` and `InitiativePatch` are BUILT from the
registry with `pydantic.create_model`, so the API surface cannot drift from the
table. The analytics contracts below are hand-written because they describe
*computed shapes*, not the register, and those shapes are stable.

Three models, three rules, one source:
    InitiativeOut     every field, all optional except the natural key
    InitiativeCreate  required fields are required, editable fields accepted
    InitiativePatch   every editable field optional  (PATCH semantics)
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, create_model

from .registry import INITIATIVE_FIELDS, FieldSpec, Kind

# ------------------------------------------------ registry -> pydantic ------
_PY_TYPE: dict[Kind, type] = {
    Kind.TEXT: str, Kind.LONGTEXT: str, Kind.VOCAB: str,
    Kind.BOOL: bool, Kind.DATE: date,
    Kind.INT: int, Kind.NUMBER: float, Kind.MONEY: float,
}


def _field_def(spec: FieldSpec, *, force_optional: bool) -> tuple[Any, Any]:
    py = _PY_TYPE[spec.kind]
    info = Field(default=None, description=spec.help or spec.label)
    if force_optional or not spec.required:
        return (Optional[py], info)
    return (py, Field(..., description=spec.help or spec.label))


def _build(name: str, *, force_optional: bool, only_editable: bool,
           extra: dict[str, tuple[Any, Any]] | None = None) -> type[BaseModel]:
    fields = {
        spec.column: _field_def(spec, force_optional=force_optional)
        for spec in INITIATIVE_FIELDS
        if not only_editable or spec.editable
    }
    fields.update(extra or {})
    return create_model(name, __config__=ConfigDict(from_attributes=True), **fields)


class MonthlyPoint(BaseModel):
    metric_code: str
    scenario_code: str
    period_month: date
    value: float | None = None


InitiativeOut = _build(
    "InitiativeOut", force_optional=True, only_editable=False,
    extra={
        "id": (str, ...),
        "snapshot_id": (str, ...),
        "planned_end_year": (Optional[int], None),
        "planned_end_quarter": (Optional[int], None),
        "updated_at": (Optional[str], None),
        "updated_by": (Optional[str], None),
        "edited_fields": (Optional[dict[str, Any]], None),
        "metrics": (list[MonthlyPoint], Field(default_factory=list)),
    },
)

InitiativeCreate = _build(
    "InitiativeCreate", force_optional=False, only_editable=False,
    extra={"snapshot_id": (str, ...)},
)

InitiativePatch = _build(
    "InitiativePatch", force_optional=True, only_editable=True,
)


# ------------------------------------------------------------------- meta --
class VocabItem(BaseModel):
    code: str
    label: str
    sort_order: int = 100
    color_hex: str | None = None


class SnapshotOut(BaseModel):
    id: str
    period_key: str
    label: str
    as_of_date: date | None = None
    fiscal_year: int
    period_type: Literal["FY", "H", "Q", "M"]
    period_ordinal: int | None = None
    sort_key: int = 0
    state: Literal["draft", "published", "locked"] = "published"
    revision: int = 1
    superseded_by: str | None = None
    pinned: bool = False
    needs_review: bool = False
    stored_filename: str | None = None
    original_filename: str | None = None
    reason: str | None = None
    created_by: str | None = None
    published_by: str | None = None
    published_at: str | None = None
    is_baseline: bool = False
    archived_at: str | None = None
    archived_by: str | None = None
    notes: str | None = None
    uploaded_at: str | None = None
    initiative_count: int = 0


class SnapshotPatch(BaseModel):
    """
    The only snapshot fields an operator may edit directly.

    Deliberately a whitelist. `period_key` / `sort_key` / `fiscal_year` /
    `period_type` / `period_ordinal` are *derived*, never typed -- changing
    one would silently rewrite a period's chronology and its comparison
    lineage. `state`, `revision` and `superseded_by` belong to the lifecycle
    endpoints, and `archived_at` to the archive pair.
    """

    label: str | None = None
    notes: str | None = None
    pinned: bool | None = None


class PeriodOptions(BaseModel):
    """
    Everything the period pickers need -- discovered, never configured.

    `snapshots` and `years` come from the data. `default_*` is the resolver's
    opinion (latest vs the one before it), which the UI uses on first load and
    the user then overrides. `by_year` groups the same snapshots for the
    tiered picker; `pinned` is the always-visible retention tier.
    """

    snapshots: list[SnapshotOut]
    years: list[int]
    default_snapshot: str | None = None
    default_baseline: str | None = None
    default_year: int | None = None
    comparable_pairs: list[list[str]] = Field(default_factory=list)
    by_year: list[dict[str, Any]] = Field(default_factory=list)
    pinned: list[SnapshotOut] = Field(default_factory=list)


class MetaOut(BaseModel):
    periods: PeriodOptions
    vocab: dict[str, list[VocabItem]]
    registry: dict[str, Any]
    data_backend: str
    app_version: str = "2.0.0"


class InitiativeQuery(BaseModel):
    snapshot: str | None = None
    filters: dict[str, list[str]] = Field(default_factory=dict)
    search: str | None = None
    include_metrics: bool = False
    limit: int = 5000
    offset: int = 0


class InitiativeListOut(BaseModel):
    total: int
    items: list[InitiativeOut]           # type: ignore[valid-type]


# ---------------------------------------------------------------- top n ----
class TopItem(BaseModel):
    rank: int
    key: str
    name: str
    value_musd: float
    source_initiative_id: str | None = None


class TopMovement(BaseModel):
    name: str
    status: Literal["carried", "new", "fell_out", "discontinued"]
    a_rank: int | None = None
    b_rank: int | None = None
    a_value_musd: float | None = None
    b_value_musd: float | None = None
    delta_musd: float | None = None


class TopBU(BaseModel):
    bu_code: str
    bu_label: str
    a_items: list[TopItem]
    b_items: list[TopItem]
    movements: list[TopMovement]
    a_total_musd: float
    b_total_musd: float
    delta_musd: float
    counts: dict[str, int]
    is_overridden: bool = False
    note: str | None = None


class TopOut(BaseModel):
    snapshot_a: str
    snapshot_b: str
    limit: int
    business_units: list[TopBU]
    totals: dict[str, float]


# -------------------------------------------------------------- compare ----
class CompareMetrics(BaseModel):
    total: float = 0
    in_execution: float = 0
    prioritized: float = 0
    value_musd: float = 0


class CompareRow(BaseModel):
    bu_code: str
    bu_label: str
    a: CompareMetrics
    b: CompareMetrics
    delta: CompareMetrics
    is_overridden: bool = False
    # A BU absent from one side (a reorg, not a real change) renders that
    # side as "--" with an unmatched pill instead of a delta.
    a_present: bool = True
    b_present: bool = True


class CompareOut(BaseModel):
    snapshot_a: str
    snapshot_b: str
    rows: list[CompareRow]
    totals: CompareRow
    # Excluded from `totals.delta`, which reflects only BUs present on both
    # sides -- a brand-new or discontinued BU should not read as growth or
    # decline.
    unmatched_count: int = 0


# -------------------------------------------------------------- monthly ----
class MonthlySeries(BaseModel):
    year: int
    months: list[str]
    financial_target_cum_musd: list[float]
    financial_actual_cum_musd: list[float]
    kpi_attainment_pct: list[float | None]
    kpi_sample: list[int]
    cutoff_index: int | None = None


# ------------------------------------------------------------- quarters ----
class QuarterBucket(BaseModel):
    key: str
    year: int | None
    quarter: int | None
    counts: dict[str, int]
    total: int


class QuarterOut(BaseModel):
    stack_by: str
    buckets: list[QuarterBucket]
    series: list[str]
    total: int
    scheduled: int
    unscheduled: int
    peak_key: str | None = None
    peak_count: int = 0


# ---------------------------------------------------------- stage matrix ---
class StageMatrixCell(BaseModel):
    bu_code: str
    lever_code: str
    stage_code: str
    count: int
    value_musd: float


class StageMatrixOut(BaseModel):
    cells: list[StageMatrixCell]
    funnel: dict[str, dict[str, float]]
    mapped: int
    total: int


# ------------------------------------------------------------------ tree ---
class TreeNode(BaseModel):
    name: str
    dimension: str
    count: int
    on_track: int
    value_musd: float
    children: list["TreeNode"] | None = None


TreeNode.model_rebuild()


class TreeOut(BaseModel):
    levels: list[str]
    total: int
    on_track: int
    value_musd: float
    nodes: list[TreeNode]


# ---------------------------------------------------------- completeness ---
class CompletenessRow(BaseModel):
    bu_code: str
    bu_label: str
    initiatives: int
    filled: int
    total: int
    pct: float
    fully_complete: int
    sections: dict[str, float]


class FieldGap(BaseModel):
    field: str
    label: str
    missing: int
    pct: float


class CompletenessOut(BaseModel):
    scope: str
    fields_scored: int
    initiatives: int
    filled: int
    total: int
    pct: float
    fully_complete: int
    sections: list[str]
    by_bu: list[CompletenessRow]
    field_gaps: list[FieldGap]
    distribution: dict[str, int]
    initiatives_detail: list[dict[str, Any]]


# ---------------------------------------------------------------- upload ---
class UploadReport(BaseModel):
    batch_id: str
    status: str
    snapshot_id: str
    period_key: str | None = None
    revision: int = 1
    state: str | None = None
    stored_filename: str | None = None
    original_filename: str | None = None
    source_name: str
    content_sha256: str
    initiatives_inserted: int = 0
    initiatives_updated: int = 0
    initiatives_deleted: int = 0
    metric_rows: int = 0
    carried_edits: int = 0
    carried_edits_flagged: int = 0
    warnings: list[dict[str, Any]] = Field(default_factory=list)
    errors: list[dict[str, Any]] = Field(default_factory=list)
    message: str | None = None


class SnapshotResolveOut(BaseModel):
    """Backs the period builder's pre-submit state (spec step 3, §3.5) --
    what loading this (fiscal_year, period_type, period_ordinal) combination
    would do, before the user commits to it."""

    state: Literal["new", "revision", "draft_exists"]
    existing_snapshot: SnapshotOut | None = None
    next_revision: int
    stored_filename: str
    # Echoes back who the platform says is asking, so the period builder can tell
    # "your own draft" from "someone else's draft" without guessing. None when no
    # auth is configured (local dev), where every draft is visible to everyone.
    current_actor: str | None = None


class OverrideIn(BaseModel):
    payload: dict[str, Any]


class OverrideOut(BaseModel):
    scope: str
    scope_key: str
    payload: dict[str, Any]
    updated_at: str | None = None


class SettingIn(BaseModel):
    payload: dict[str, Any]


class SettingOut(BaseModel):
    key: str
    payload: dict[str, Any]
    updated_at: str | None = None
