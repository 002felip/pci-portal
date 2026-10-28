"""
Shared analytics. Every business rule lives here and nowhere else.

Computed over plain dictionaries so the JSON backend and the SQL backend
mathematically cannot disagree.

TWO THINGS CHANGED IN THIS REBUILD
----------------------------------
1. NO PERIOD IS BAKED IN. Every function takes the snapshot codes and the year
   it is told to use. There is no `= "Q1"` default anywhere below, and the
   comparison labels its own sides from its arguments.

2. NO FIELD LIST IS BAKED IN. Completeness sections, required-field scoring,
   stage semantics and lever direction all come from registry.py. Adding a
   required field changes the data-gaps page with no edit here.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import date
from typing import Any, Iterable

from .registry import (
    IN_EXECUTION_STAGES, LOWER_IS_BETTER_LEVERS, MONTHLY_COMPLETENESS,
    ON_TRACK_CODE, has_value, label_of, order_of, scored_fields, sections,
)
from .schemas import (
    CompareMetrics, CompareOut, CompareRow, CompletenessOut, CompletenessRow,
    FieldGap, MonthlySeries, QuarterBucket, QuarterOut, StageMatrixCell,
    StageMatrixOut, TopBU, TopItem, TopMovement, TopOut, TreeNode,
)

BU_ORDER = order_of("bu")
_PUNCT = re.compile(r"[^a-z0-9]+")


def _norm_name(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return _PUNCT.sub(" ", text.lower()).strip()


def _musd(value: Any) -> float:
    return round(float(value or 0.0) / 1_000_000.0, 4)


def _bu_label(code: str) -> str:
    return label_of("bu", code)


def _by_bu(rows: Iterable[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        out[r.get("bu_code") or "—"].append(r)
    return out


def _bu_codes(*maps: dict[str, list[dict]]) -> list[str]:
    codes: set[str] = set()
    for m in maps:
        codes |= set(m)
    return sorted(codes, key=lambda c: (BU_ORDER.get(c, 999), c))


# ============================================================== actuals ===
def _ytd_at(points: dict[int, float], month: int) -> float:
    """Last YTD value on or before `month` (1-12): gaps carry forward."""
    return next((points[m] for m in range(month, 0, -1) if m in points), 0.0)


def annotate_actuals(rows: list[dict], year: int, cutoff_month: int) -> list[dict]:
    """
    Per-row financial actuals from the monthly ACTUAL block (7C), in USD:
      value_actual_ytd  the YTD figure at the snapshot's period end
      value_actual_fy   the December figure -- months past the period end are
                        the BU's forecast, so this is actuals + forecast
    The block is already year-to-date, so neither is ever re-accumulated.
    Rows need their `metrics`; without them both figures are 0.
    """
    for r in rows:
        points: dict[int, float] = {}
        for m in r.get("metrics") or []:
            if m.get("metric_code") != "FINANCIAL_VALUE" or m.get("scenario_code") != "ACTUAL":
                continue
            pm = m.get("period_month")
            if isinstance(pm, str):
                pm = date.fromisoformat(pm[:10])
            if pm is None or pm.year != year or m.get("value") is None:
                continue
            points[pm.month] = float(m["value"])
        r["value_actual_ytd"] = _ytd_at(points, min(max(cutoff_month, 1), 12))
        r["value_actual_fy"] = _ytd_at(points, 12)
    return rows


# ============================================== snapshot A vs snapshot B ===
def _metrics_for(rows: Iterable[dict]) -> CompareMetrics:
    total = in_exec = 0
    value = ytd = fy = 0.0
    for r in rows:
        total += 1
        if (r.get("stage_code") or "") in IN_EXECUTION_STAGES:
            in_exec += 1
        value += float(r.get("value_target_cy") or 0.0)
        ytd += float(r.get("value_actual_ytd") or 0.0)
        fy += float(r.get("value_actual_fy") or 0.0)
    return CompareMetrics(total=total, in_execution=in_exec,
                          value_musd=round(value / 1_000_000.0, 1),
                          actual_ytd_musd=round(ytd / 1_000_000.0, 1),
                          actual_fy_musd=round(fy / 1_000_000.0, 1))


def _delta(a: CompareMetrics, b: CompareMetrics) -> CompareMetrics:
    return CompareMetrics(total=b.total - a.total,
                          in_execution=b.in_execution - a.in_execution,
                          value_musd=round(b.value_musd - a.value_musd, 1),
                          actual_ytd_musd=round(b.actual_ytd_musd - a.actual_ytd_musd, 1),
                          actual_fy_musd=round(b.actual_fy_musd - a.actual_fy_musd, 1))


def build_compare(rows_a: list[dict], rows_b: list[dict],
                  snapshot_a: str, snapshot_b: str) -> CompareOut:
    """Any two snapshots, in any order. Figures come straight from the rows."""
    by_a, by_b = _by_bu(rows_a), _by_bu(rows_b)

    out_rows: list[CompareRow] = []
    for code in _bu_codes(by_a, by_b):
        a, b = _metrics_for(by_a.get(code, [])), _metrics_for(by_b.get(code, []))
        out_rows.append(CompareRow(bu_code=code, bu_label=_bu_label(code), a=a, b=b,
                                   delta=_delta(a, b),
                                   a_present=code in by_a, b_present=code in by_b))

    matched = [r for r in out_rows if r.a_present and r.b_present]
    unmatched_count = len(out_rows) - len(matched)
    metric_keys = ("total", "in_execution", "value_musd", "actual_ytd_musd", "actual_fy_musd")

    def _sum(attr: str, side: str, rows: list[CompareRow]) -> float:
        return round(sum(getattr(getattr(r, side), attr) for r in rows), 1)

    ta = CompareMetrics(**{k: _sum(k, "a", out_rows) for k in metric_keys})
    tb = CompareMetrics(**{k: _sum(k, "b", out_rows) for k in metric_keys})
    # The delta is scoped to BUs present on both sides -- a BU appearing or
    # disappearing across a reorg should not read as portfolio growth/decline.
    ta_matched = CompareMetrics(**{k: _sum(k, "a", matched) for k in metric_keys})
    tb_matched = CompareMetrics(**{k: _sum(k, "b", matched) for k in metric_keys})

    return CompareOut(
        snapshot_a=snapshot_a, snapshot_b=snapshot_b, rows=out_rows,
        unmatched_count=unmatched_count,
        totals=CompareRow(bu_code="TOTAL", bu_label="Portfolio total",
                          a=ta, b=tb, delta=_delta(ta_matched, tb_matched)))


# ================================================================= top N ===
def _top_key(r: dict) -> str:
    """Identity within a BU. Names repeat across initiatives and change across
    quarters; the Initiative ID does neither. Curated override items may carry
    only a name, so those fall back to it."""
    sid = r.get("source_initiative_id")
    return f"id:{sid}" if sid not in (None, "") else f"name:{_norm_name(r.get('name'))}"


# What the ranking and the $M on each side are read from.
TOP_BASIS_FIELD = {"target": "value_target_cy", "actual_ytd": "value_actual_ytd",
                   "actual_fy": "value_actual_fy"}


def _rank(rows: list[dict], limit: int, field: str = "value_target_cy") -> list[TopItem]:
    ordered = sorted(rows, key=lambda r: float(r.get(field) or 0), reverse=True)
    non_zero = [r for r in ordered if float(r.get(field) or 0) > 50_000]
    chosen = non_zero[:limit] if len(non_zero) >= limit else ordered[:limit]
    return [TopItem(rank=i + 1, key=_top_key(r), name=r.get("name") or "—",
                    value_musd=_musd(r.get(field)),
                    source_initiative_id=r.get("source_initiative_id"))
            for i, r in enumerate(chosen)]


def build_top(rows_a: list[dict], rows_b: list[dict], snapshot_a: str,
              snapshot_b: str, limit: int = 10,
              overrides: dict[str, dict] | None = None,
              basis: str = "target") -> TopOut:
    """
    Movement between any two snapshots. Status is derived by Initiative ID
    match within the BU (a renamed initiative is still `carried`):
      carried | new | fell_out (still registered, out of the top N) | discontinued

    `basis` picks what is ranked and summed: CY target, actuals YTD or actuals
    + forecast. Curated overrides carry hand-picked target values, so they
    only apply to `target`.
    """
    field = TOP_BASIS_FIELD[basis]
    overrides = (overrides or {}) if basis == "target" else {}
    by_a, by_b = _by_bu(rows_a), _by_bu(rows_b)
    bus: list[TopBU] = []

    for code in _bu_codes(by_a, by_b):
        ov = overrides.get(code) or {}
        if ov.get("a_items") or ov.get("b_items"):
            def _items(key: str) -> list[TopItem]:
                return [TopItem(rank=i + 1, key=_top_key(x),
                                name=x.get("name", "—"),
                                value_musd=float(x.get("value_musd") or 0),
                                source_initiative_id=x.get("source_initiative_id"))
                        for i, x in enumerate(ov.get(key, []))]
            a_items, b_items, overridden = _items("a_items"), _items("b_items"), True
        else:
            a_items = _rank(by_a.get(code, []), limit, field)
            b_items = _rank(by_b.get(code, []), limit, field)
            overridden = False

        b_all = {_top_key(r) for r in by_b.get(code, [])}
        b_rank = {it.key: it for it in b_items}
        a_keys = {it.key for it in a_items}

        movements: list[TopMovement] = []
        for it in a_items:
            match = b_rank.get(it.key)
            if match:
                renamed = _norm_name(it.name) != _norm_name(match.name)
                movements.append(TopMovement(
                    name=match.name, status="carried", a_rank=it.rank, b_rank=match.rank,
                    source_initiative_id=match.source_initiative_id,
                    renamed=renamed, prev_name=it.name if renamed else None,
                    a_value_musd=it.value_musd, b_value_musd=match.value_musd,
                    delta_musd=round(match.value_musd - it.value_musd, 1)))
            else:
                movements.append(TopMovement(
                    name=it.name, source_initiative_id=it.source_initiative_id,
                    status="fell_out" if it.key in b_all else "discontinued",
                    a_rank=it.rank, a_value_musd=it.value_musd))
        movements += [TopMovement(name=it.name, status="new", b_rank=it.rank,
                                  source_initiative_id=it.source_initiative_id,
                                  b_value_musd=it.value_musd)
                      for it in b_items if it.key not in a_keys]

        a_total = round(sum(i.value_musd for i in a_items), 1)
        b_total = round(sum(i.value_musd for i in b_items), 1)
        bus.append(TopBU(
            bu_code=code, bu_label=_bu_label(code), a_items=a_items, b_items=b_items,
            movements=movements, a_total_musd=a_total, b_total_musd=b_total,
            delta_musd=round(b_total - a_total, 1),
            counts={s: sum(1 for m in movements if m.status == s)
                    for s in ("carried", "new", "fell_out", "discontinued")},
            is_overridden=overridden, note=ov.get("note")))

    totals: dict[str, float] = {
        "a_total_musd": round(sum(b.a_total_musd for b in bus), 1),
        "b_total_musd": round(sum(b.b_total_musd for b in bus), 1),
        **{k: sum(b.counts[k] for b in bus)
           for k in ("carried", "new", "fell_out", "discontinued")},
    }
    totals["delta_musd"] = round(totals["b_total_musd"] - totals["a_total_musd"], 1)

    return TopOut(snapshot_a=snapshot_a, snapshot_b=snapshot_b, limit=limit,
                  basis=basis, business_units=bus, totals=totals)


# ======================================================== monthly phasing ===
def build_monthly(rows: list[dict], year: int,
                  cutoff_month: int | None = None) -> MonthlySeries:
    """
    Cumulative financial target vs realized ($M) for ANY year present in the
    facts, plus KPI attainment and cumulative milestones planned vs completed.

    The register's financial monthly blocks (7A/7C) are ALREADY year-to-date,
    so each row's series is carried forward across gaps and summed across rows;
    it is never accumulated again. The milestone blocks (8.) are YTD too and
    are treated the same way.

    KPI direction matters: for the levers listed in
    `registry.LOWER_IS_BETTER_LEVERS` a lower actual beats the target, so
    attainment is evaluated in the correct direction per row. Averaging naively
    would flatter cost initiatives.

    `cutoff_index` is the snapshot's period end (`cutoff_month`, 1-12) -- the UI
    dashes the forecast beyond it instead of drawing a cliff to zero. Without a
    `cutoff_month` it falls back to the last month with any actuals.
    """
    fin_t, fin_a = [0.0] * 12, [0.0] * 12
    ms_t, ms_a = [0.0] * 12, [0.0] * 12
    kpi_hit, kpi_tot = [0] * 12, [0] * 12
    last_actual = -1

    for r in rows:
        lower_better = (r.get("lever_code") or "") in LOWER_IS_BETTER_LEVERS
        kt: dict[int, float] = {}
        ka: dict[int, float] = {}
        ft: dict[int, float] = {}
        fa: dict[int, float] = {}
        mt: dict[int, float] = {}
        ma: dict[int, float] = {}
        for m in r.get("metrics") or []:
            pm = m.get("period_month")
            if isinstance(pm, str):
                pm = date.fromisoformat(pm[:10])
            if pm is None or pm.year != year:
                continue
            idx = pm.month - 1
            val = float(m.get("value") or 0.0)
            code, scen = m.get("metric_code"), m.get("scenario_code")
            if code == "FINANCIAL_VALUE":
                if scen == "TARGET":
                    ft[idx] = val
                elif scen == "ACTUAL":
                    fa[idx] = val
                    if val:
                        last_actual = max(last_actual, idx)
            elif code == "KPI":
                (kt if scen == "TARGET" else ka)[idx] = val
            elif code == "MILESTONES":
                if scen == "TARGET":
                    mt[idx] = val
                elif scen == "ACTUAL":
                    ma[idx] = val
                    if val:
                        last_actual = max(last_actual, idx)

        for series, into in ((ft, fin_t), (fa, fin_a), (mt, ms_t), (ma, ms_a)):
            carried = 0.0
            for idx in range(12):
                carried = series.get(idx, carried)
                into[idx] += carried

        for idx in range(12):
            t, a = kt.get(idx), ka.get(idx)
            if t is None or a is None or (t == 0 and a == 0):
                continue
            kpi_tot[idx] += 1
            if (a <= t * 1.001) if lower_better else (a >= t * 0.999):
                kpi_hit[idx] += 1
            last_actual = max(last_actual, idx)

    cum_t = [round(v / 1e6, 2) for v in fin_t]
    cum_a = [round(v / 1e6, 2) for v in fin_a]
    if cutoff_month is not None:
        last_actual = min(max(cutoff_month, 1), 12) - 1

    return MonthlySeries(
        year=year, months=[f"{year}-{m:02d}" for m in range(1, 13)],
        financial_target_cum_musd=cum_t, financial_actual_cum_musd=cum_a,
        kpi_attainment_pct=[round(100 * kpi_hit[i] / kpi_tot[i], 1)
                            if kpi_tot[i] else None for i in range(12)],
        kpi_sample=kpi_tot,
        milestones_target_cum=[round(v, 1) for v in ms_t],
        milestones_actual_cum=[round(v, 1) for v in ms_a],
        cutoff_index=last_actual if last_actual >= 0 else None)


# =============================================================== quarters ===
def build_quarters(rows: list[dict], stack_by: str) -> QuarterOut:
    """Initiative counts by value-landing quarter, stacked by any dimension."""
    buckets: dict[tuple[int, int] | None, dict[str, int]] = \
        defaultdict(lambda: defaultdict(int))
    for r in rows:
        y, q = r.get("planned_end_year"), r.get("planned_end_quarter")
        key = (y, q or 4) if y else None
        buckets[key][str(r.get(stack_by) or "—")] += 1

    out = [QuarterBucket(key=f"Q{q} {str(y)[-2:]}", year=y, quarter=q,
                         counts=dict(buckets[(y, q)]),
                         total=sum(buckets[(y, q)].values()))
           for (y, q) in sorted(k for k in buckets if k is not None)]
    if None in buckets:
        out.append(QuarterBucket(key="Unscheduled", year=None, quarter=None,
                                 counts=dict(buckets[None]),
                                 total=sum(buckets[None].values())))

    peak = max((b for b in out if b.year), key=lambda b: b.total, default=None)
    return QuarterOut(stack_by=stack_by, buckets=out,
                      series=sorted({s for b in out for s in b.counts}),
                      total=sum(b.total for b in out),
                      scheduled=sum(b.total for b in out if b.year),
                      unscheduled=sum(b.total for b in out if not b.year),
                      peak_key=peak.key if peak else None,
                      peak_count=peak.total if peak else 0)


# =========================================================== stage matrix ===
def build_stage_matrix(rows: list[dict]) -> StageMatrixOut:
    """BU x Value Lever grid, each cell split by stage; plus the stage funnel."""
    cells: dict[tuple[str, str], dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(lambda: {"count": 0.0, "value_musd": 0.0,
                                     "actual_ytd_musd": 0.0, "actual_fy_musd": 0.0}))
    funnel: dict[str, dict[str, float]] = defaultdict(
        lambda: {"count": 0.0, "value_musd": 0.0, "actual_ytd_musd": 0.0, "actual_fy_musd": 0.0})

    for r in rows:
        bu, lever, stage = r.get("bu_code"), r.get("lever_code"), r.get("stage_code")
        if not (bu and lever and stage):
            continue
        add = {"count": 1, "value_musd": _musd(r.get("value_target_cy")),
               "actual_ytd_musd": _musd(r.get("value_actual_ytd")),
               "actual_fy_musd": _musd(r.get("value_actual_fy"))}
        for into in (cells[(bu, lever)][stage], funnel[stage]):
            for k, v in add.items():
                into[k] += v

    out_cells = [StageMatrixCell(bu_code=bu, lever_code=lever, stage_code=stage,
                                 count=int(v["count"]),
                                 value_musd=round(v["value_musd"], 1),
                                 actual_ytd_musd=round(v["actual_ytd_musd"], 1),
                                 actual_fy_musd=round(v["actual_fy_musd"], 1))
                 for (bu, lever), stages in cells.items()
                 for stage, v in stages.items()]
    return StageMatrixOut(
        cells=out_cells,
        funnel={s: {"count": int(v["count"]),
                    **{k: round(v[k], 1)
                       for k in ("value_musd", "actual_ytd_musd", "actual_fy_musd")}}
                for s, v in funnel.items()},
        mapped=sum(c.count for c in out_cells), total=len(rows))


# ==================================================================== tree ==
def build_tree(rows: list[dict], levels: list[str]) -> list[TreeNode]:
    """One grouping engine, two visuals: the treemap and the decomposition tree."""

    def group(items: list[dict], depth: int) -> list[TreeNode]:
        if depth >= len(levels):
            return []
        dim = levels[depth]
        buckets: dict[str, list[dict]] = defaultdict(list)
        for r in items:
            buckets[str(r.get(dim) or "—")].append(r)
        nodes = [TreeNode(
            name=name, dimension=dim, count=len(arr),
            on_track=sum(1 for x in arr if x.get("track_code") == ON_TRACK_CODE),
            value_musd=round(sum(_musd(x.get("value_target_cy")) for x in arr), 1),
            actual_ytd_musd=round(sum(_musd(x.get("value_actual_ytd")) for x in arr), 1),
            actual_fy_musd=round(sum(_musd(x.get("value_actual_fy")) for x in arr), 1),
            children=group(arr, depth + 1) or None)
            for name, arr in buckets.items()]
        nodes.sort(key=lambda n: (-n.count, n.name))
        return nodes

    return group(rows, 0)


# =========================================================== completeness ===
def build_completeness(rows: list[dict], scope: str = "required",
                       required_by_stage: dict[str, list[str]] | None = None,
                       ) -> CompletenessOut:
    """
    Field completeness by BU, section, field and initiative.

    The field list, the sections and what counts as "answered" all come from
    registry.py -- this function contains no column names. `scope='required'`
    scores, per initiative, the keys `required_by_stage` lists for its stage
    (falling back to the registry's `required` flags for an unlisted stage);
    `scope='all'` scores every canonical field. A deliberate value always
    counts as answered; a no-data placeholder ('Unknown' track, 'Not set'
    confidence) does not.
    """
    all_fields = scored_fields("all")
    base_fields = scored_fields(scope)
    by_stage = {stage: [f for f in all_fields if f[0] in set(keys)]
                for stage, keys in (required_by_stage or {}).items()} \
        if scope == "required" else {}
    all_sections = sections()

    by_bu: dict[str, dict[str, float]] = defaultdict(
        lambda: {"filled": 0, "total": 0, "n": 0, "full": 0})
    by_section: dict[tuple[str, str], dict[str, float]] = defaultdict(
        lambda: {"filled": 0, "total": 0})
    gaps: dict[tuple[str, str], int] = defaultdict(int)
    scored: dict[tuple[str, str], int] = defaultdict(int)
    per_init: list[dict] = []

    for r in rows:
        bu = r.get("bu_code") or "—"
        fields = by_stage.get(r.get("stage_code") or "", base_fields)
        n_fields = len(fields)
        filled = 0
        missing: list[str] = []
        for column, label, section in fields:
            ok = has_value(r, column)
            scored[(column, label)] += 1
            by_bu[bu]["total"] += 1
            by_section[(bu, section)]["total"] += 1
            if ok:
                filled += 1
                by_bu[bu]["filled"] += 1
                by_section[(bu, section)]["filled"] += 1
            else:
                gaps[(column, label)] += 1
                missing.append(label)
        by_bu[bu]["n"] += 1
        if filled == n_fields:
            by_bu[bu]["full"] += 1
        per_init.append({
            "id": r.get("source_initiative_id"), "uuid": r.get("id"),
            "name": r.get("name"), "bu_code": bu, "stage_code": r.get("stage_code"),
            "missing_count": n_fields - filled,
            "completeness_pct": round(100 * filled / n_fields, 1) if n_fields else 0.0,
            "missing_fields": missing})

    bu_rows = [CompletenessRow(
        bu_code=bu, bu_label=_bu_label(bu), initiatives=int(v["n"]),
        filled=int(v["filled"]), total=int(v["total"]),
        pct=round(100 * v["filled"] / v["total"], 1) if v["total"] else 0.0,
        fully_complete=int(v["full"]),
        sections={sec: round(100 * by_section[(bu, sec)]["filled"]
                             / by_section[(bu, sec)]["total"], 1)
                  for sec in all_sections
                  if by_section.get((bu, sec), {}).get("total")})
        for bu, v in by_bu.items()]
    bu_rows.sort(key=lambda r: -r.pct)

    field_gaps = sorted(
        [FieldGap(field=f, label=label, missing=n,
                  pct=round(100 * n / scored[(f, label)], 1))
         for (f, label), n in gaps.items()], key=lambda g: -g.missing)

    bands = ["0–20", "20–40", "40–60", "60–80", "80–<100", "100"]
    dist = dict.fromkeys(bands, 0)
    for p in per_init:
        v = p["completeness_pct"]
        dist["100" if v >= 100 else "80–<100" if v >= 80 else "60–80" if v >= 60
             else "40–60" if v >= 40 else "20–40" if v >= 20 else "0–20"] += 1

    # Portfolio-wide per-section score: the BU cells above, summed across BUs
    # so the matrix's total row is cell-weighted rather than an average of %.
    sec_tot: dict[str, dict[str, float]] = defaultdict(lambda: {"filled": 0, "total": 0})
    for (_bu, sec), v in by_section.items():
        sec_tot[sec]["filled"] += v["filled"]
        sec_tot[sec]["total"] += v["total"]
    section_pct = {sec: round(100 * sec_tot[sec]["filled"] / sec_tot[sec]["total"], 1)
                   for sec in all_sections if sec_tot.get(sec, {}).get("total")}

    total_cells = sum(v["total"] for v in by_bu.values())
    total_filled = sum(v["filled"] for v in by_bu.values())

    return CompletenessOut(
        scope=scope, fields_scored=len(scored) or len(base_fields),
        initiatives=len(rows),
        filled=int(total_filled), total=int(total_cells),
        pct=round(100 * total_filled / total_cells, 1) if total_cells else 0.0,
        fully_complete=sum(int(v["full"]) for v in by_bu.values()),
        sections=all_sections, section_pct=section_pct, by_bu=bu_rows,
        field_gaps=field_gaps,
        distribution=dist,
        initiatives_detail=sorted(per_init, key=lambda p: -p["missing_count"]))
