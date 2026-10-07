from fastapi import APIRouter, HTTPException, Request

from app.domain.enums import ValueContext
from app.modules.comparisons.selection import SelectionKey, SelectionNotFoundError
from app.modules.comparisons.service import compare_tree
from app.modules.datasets.period_repository import SqliteReportingPeriodRepository
from app.modules.datasets.repositories import SqliteDatasetCycleRepository, SqliteRevisionCycleRepository
from app.modules.datasets.tree_repositories import SqliteTreeRepository
from app.modules.simulations.dependencies import list_dataset_dependencies

router = APIRouter(prefix="/api", tags=["comparisons"])


@router.get("/datasets")
def list_datasets(request: Request):
    conn = request.app.state.db
    datasets = conn.execute(
        "SELECT d.dataset_id, d.dataset_code, r.region_code, r.region_name "
        "FROM vdt_dataset d LEFT JOIN ref_region r ON r.region_id = d.region_id "
        "WHERE d.dataset_type = 'REGION'"
    ).fetchall()

    result = []
    for d in datasets:
        latest_cycle = SqliteDatasetCycleRepository(conn).get_latest(d["dataset_id"])
        trees = (SqliteTreeRepository(conn).list_by_dataset_cycle(latest_cycle.dataset_cycle_id)
                 if latest_cycle else [])
        result.append({
            "dataset_id": d["dataset_id"], "region_code": d["region_code"],
            "region_name": d["region_name"],
            "trees": [{"tree_id": t.tree_id, "tree_code": t.tree_code,
                       "tree_name": t.tree_name_original,
                       "tree_type": t.tree_type.value} for t in trees],
        })
    return result


@router.get("/datasets/{dataset_id}/selections")
def dataset_selections(request: Request, dataset_id: str):
    conn = request.app.state.db
    cycle_rows = conn.execute(
        "SELECT dc.dataset_cycle_id, rc.cycle_year FROM vdt_dataset_cycle dc "
        "JOIN ref_revision_cycle rc ON rc.revision_cycle_id = dc.revision_cycle_id "
        "WHERE dc.dataset_id = ? ORDER BY rc.cycle_year",
        (dataset_id,),
    ).fetchall()

    periods = SqliteReportingPeriodRepository(conn)
    cycles = [
        {"revision_cycle_year": row["cycle_year"],
         "reference_years": periods.list_years_for_dataset_cycle(row["dataset_cycle_id"])}
        for row in cycle_rows
    ]
    return {"revision_cycles": cycles, "contexts": [c.value for c in ValueContext]}


@router.get("/datasets/{dataset_id}/dependencies")
def dataset_dependencies(request: Request, dataset_id: str, revision_cycle_year: int):
    conn = request.app.state.db
    cycle = SqliteRevisionCycleRepository(conn).get_by_year(revision_cycle_year)
    if cycle is None:
        raise HTTPException(404, {"code": "SELECTION_NOT_FOUND",
                                  "message": f"No revision cycle {revision_cycle_year}"})
    dataset_cycle = SqliteDatasetCycleRepository(conn).get(dataset_id, cycle.revision_cycle_id)
    if dataset_cycle is None:
        raise HTTPException(404, {"code": "SELECTION_NOT_FOUND",
                                  "message": (f"Dataset {dataset_id} has no publication for "
                                              f"cycle {revision_cycle_year}")})
    deps = list_dataset_dependencies(conn, dataset_cycle.dataset_cycle_id)
    return [
        {"tree_code": d.tree_code, "tree_name": d.tree_name, "node_code": d.node_code,
         "node_id": d.node_id, "depends_on": d.depends_on}
        for d in deps
    ]


@router.get("/trees/{tree_id}/comparison")
def tree_comparison(
    request: Request, tree_id: str,
    baseline_context: str, baseline_year: int, baseline_cycle: int,
    comparator_context: str, comparator_year: int, comparator_cycle: int,
):
    conn = request.app.state.db
    try:
        baseline = SelectionKey(ValueContext(baseline_context), baseline_year, baseline_cycle)
        comparator = SelectionKey(ValueContext(comparator_context), comparator_year, comparator_cycle)
    except ValueError as exc:
        raise HTTPException(400, {"code": "INVALID_CONTEXT", "message": str(exc)})

    row = conn.execute(
        "SELECT t.tree_code, dc.dataset_id FROM vdt_tree t "
        "JOIN vdt_dataset_cycle dc ON dc.dataset_cycle_id = t.dataset_cycle_id "
        "WHERE t.tree_id = ?", (tree_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(404, {"code": "SELECTION_NOT_FOUND", "message": f"No tree {tree_id!r}"})

    try:
        rows = compare_tree(conn, row["dataset_id"], row["tree_code"], baseline, comparator)
    except SelectionNotFoundError as exc:
        raise HTTPException(404, {"code": "SELECTION_NOT_FOUND", "message": str(exc)})

    return [
        {
            "node_id": r.node_id, "node_code": r.node_code, "parent_node_id": r.parent_node_id,
            "kpi_name": r.kpi_name, "unit": r.unit, "node_type": r.node_type,
            "favorable_direction": r.favorable_direction,
            "baseline_status": r.baseline_status.value,
            "baseline_value": str(r.baseline_value) if r.baseline_value is not None else None,
            "baseline_is_override": r.baseline_is_override,
            "baseline_missing_root_causes": [
                {"tree_code": c.tree_code, "tree_name": c.tree_name, "node_code": c.node_code,
                 "node_id": c.node_id, "kpi_name": c.kpi_name}
                for c in r.baseline_missing_root_causes
            ],
            "comparator_status": r.comparator_status.value,
            "comparator_value": str(r.comparator_value) if r.comparator_value is not None else None,
            "comparator_is_override": r.comparator_is_override,
            "comparator_missing_root_causes": [
                {"tree_code": c.tree_code, "tree_name": c.tree_name, "node_code": c.node_code,
                 "node_id": c.node_id, "kpi_name": c.kpi_name}
                for c in r.comparator_missing_root_causes
            ],
            "delta": str(r.delta) if r.delta is not None else None,
            "percent_delta": str(r.percent_delta) if r.percent_delta is not None else None,
            "favorability": r.favorability.value,
            "benchmark_status": r.benchmark_status.value if r.benchmark_status else None,
            "benchmark_value": str(r.benchmark_value) if r.benchmark_value is not None else None,
            "formula_display": r.formula_display,
        }
        for r in rows
    ]
