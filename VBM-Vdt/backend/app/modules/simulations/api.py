from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.domain.enums import DatasetType, ValueContext
from app.modules.comparisons.selection import SelectionKey, SelectionNotFoundError
from app.modules.datasets.repositories import SqliteDatasetRepository
from app.modules.simulations.overrides import InvalidOverrideError, OverrideInput
from app.modules.simulations.service import SimulationService

router = APIRouter(prefix="/api/simulations", tags=["simulations"])


class BaselineRequest(BaseModel):
    context: str
    reference_year: int
    revision_cycle_year: int


class OverrideRequest(BaseModel):
    tree_code: str
    node_code: str
    value: Decimal   # a non-numeric value is rejected by Pydantic with a 422


class SimulationRequest(BaseModel):
    region_code: str
    baseline: BaselineRequest
    target: Optional[BaselineRequest] = None
    overrides: list[OverrideRequest] = []


@router.post("/evaluate")
def evaluate_simulation(request: Request, body: SimulationRequest):
    conn = request.app.state.db
    dataset = SqliteDatasetRepository(conn).get_by_code(DatasetType.REGION, body.region_code)
    if dataset is None:
        raise HTTPException(404, {"code": "DATASET_NOT_FOUND",
                                  "message": f"No published region {body.region_code!r}"})

    try:
        baseline = SelectionKey(ValueContext(body.baseline.context),
                                body.baseline.reference_year, body.baseline.revision_cycle_year)
        target = (SelectionKey(ValueContext(body.target.context),
                               body.target.reference_year, body.target.revision_cycle_year)
                  if body.target is not None else None)
    except ValueError as exc:
        raise HTTPException(400, {"code": "INVALID_CONTEXT", "message": str(exc)})

    overrides = [OverrideInput(o.tree_code, o.node_code, o.value) for o in body.overrides]

    try:
        rows = SimulationService(conn).evaluate(dataset.dataset_id, baseline, overrides, target=target)
    except InvalidOverrideError as exc:
        raise HTTPException(400, {"code": "INVALID_OVERRIDE", "message": str(exc)})
    except SelectionNotFoundError as exc:
        raise HTTPException(404, {"code": "SELECTION_NOT_FOUND", "message": str(exc)})

    return [
        {
            "tree_code": r.tree_code, "node_id": r.node_id, "node_code": r.node_code,
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
            "simulated_status": r.simulated_status.value,
            "simulated_value": str(r.simulated_value) if r.simulated_value is not None else None,
            "simulated_missing_root_causes": [
                {"tree_code": c.tree_code, "tree_name": c.tree_name, "node_code": c.node_code,
                 "node_id": c.node_id, "kpi_name": c.kpi_name}
                for c in r.simulated_missing_root_causes
            ],
            "delta": str(r.delta) if r.delta is not None else None,
            "percent_delta": str(r.percent_delta) if r.percent_delta is not None else None,
            "favorability": r.favorability.value,
            "is_override": r.is_override, "formula_overridden": r.formula_overridden,
            "blocked_children": r.blocked_children,
            "depends_on": r.depends_on,
            "benchmark_status": r.benchmark_status.value if r.benchmark_status else None,
            "benchmark_value": str(r.benchmark_value) if r.benchmark_value is not None else None,
            "formula_display": r.formula_display,
            "target_status": r.target_status.value if r.target_status else None,
            "target_value": str(r.target_value) if r.target_value is not None else None,
            "target_delta": str(r.target_delta) if r.target_delta is not None else None,
            "target_percent_delta": (str(r.target_percent_delta)
                                     if r.target_percent_delta is not None else None),
            "target_favorability": r.target_favorability.value,
        }
        for r in rows
    ]
