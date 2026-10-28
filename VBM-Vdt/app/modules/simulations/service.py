from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from app.domain.enums import NodeType, ValueContext, ValueOrigin, ValueStatus
from app.modules.comparisons.favorability import Favorability, compare_values
from app.modules.comparisons.selection import (
    SelectionKey,
    SelectionNotFoundError,
    is_value_overridden,
    resolve_selection,
)
from app.modules.datasets.formula_display import render_formula_display
from app.modules.datasets.repositories import (
    SqliteDatasetCycleRepository,
    SqliteRevisionCycleRepository,
)
from app.modules.datasets.root_cause import RootCause, find_missing_root_causes
from app.modules.datasets.tree_repositories import SqliteTreeRepository
from app.modules.formulas.dependencies import topological_order
from app.modules.formulas.evaluator import ResolvedValue, evaluate
from app.modules.formulas.parser import parse as parse_formula
from app.modules.simulations.ancestors import find_ancestors
from app.modules.datasets.graph_builder import build_dataset_graph
from app.modules.simulations.overrides import OverrideInput, validate_overrides


@dataclass
class SimulationRow:
    tree_code: str
    node_id: str
    node_code: str
    kpi_name: str
    unit: Optional[str]
    node_type: str
    favorable_direction: Optional[str]
    baseline_status: ValueStatus
    baseline_value: Optional[Decimal]
    baseline_is_override: bool
    baseline_missing_root_causes: list[RootCause]
    simulated_status: ValueStatus
    simulated_value: Optional[Decimal]
    simulated_missing_root_causes: list[RootCause]
    delta: Optional[Decimal]
    percent_delta: Optional[Decimal]
    favorability: Favorability
    is_override: bool
    formula_overridden: bool
    blocked_children: list[str]
    depends_on: list[str]
    benchmark_status: Optional[ValueStatus]
    benchmark_value: Optional[Decimal]
    formula_display: Optional[str]
    # Present only when the caller supplies a target selection - the
    # simulated value read as the actual result, compared against the
    # target as the goal (see favorability.py's comparator_is_target).
    # None/NEUTRAL for every row when no target was supplied, matching a
    # GROUP node's own benchmark fields above.
    target_status: Optional[ValueStatus] = None
    target_value: Optional[Decimal] = None
    target_delta: Optional[Decimal] = None
    target_percent_delta: Optional[Decimal] = None
    target_favorability: Favorability = Favorability.NEUTRAL


class SimulationService:
    def __init__(self, conn):
        self._conn = conn

    def evaluate(
        self, dataset_id: str, baseline: SelectionKey, overrides: list[OverrideInput],
        target: Optional[SelectionKey] = None,
    ) -> list[SimulationRow]:
        cycle = SqliteRevisionCycleRepository(self._conn).get_by_year(baseline.revision_cycle_year)
        if cycle is None:
            raise SelectionNotFoundError(f"No revision cycle {baseline.revision_cycle_year}")
        dataset_cycle = SqliteDatasetCycleRepository(self._conn).get(
            dataset_id, cycle.revision_cycle_id)
        if dataset_cycle is None:
            raise SelectionNotFoundError(
                f"Dataset {dataset_id} has no publication for cycle {baseline.revision_cycle_year}")

        graph = build_dataset_graph(self._conn, dataset_cycle.dataset_cycle_id)
        override_map = validate_overrides(graph, overrides)  # raises before anything else runs

        trees = SqliteTreeRepository(self._conn).list_by_dataset_cycle(dataset_cycle.dataset_cycle_id)
        benchmark_key = SelectionKey(
            ValueContext.BENCHMARK, baseline.reference_year, baseline.revision_cycle_year)

        baseline_values: dict[str, ResolvedValue] = {}
        # Tracked alongside rather than on ResolvedValue: that class is the
        # formula evaluator's own resolver protocol and stays minimal.
        baseline_origins: dict[str, Optional[ValueOrigin]] = {}
        benchmark_values: dict[str, ResolvedValue] = {}
        target_values: dict[str, ResolvedValue] = {}
        for tree in trees:
            resolved = resolve_selection(self._conn, dataset_id, tree.tree_code, baseline)
            for node_id, value in resolved.nodes.items():
                key = graph.node_id_to_key.get(node_id)
                if key:
                    baseline_values[key] = ResolvedValue(value.status, value.value)
                    baseline_origins[key] = value.value_origin

            # The footer always shows the baseline's benchmark, unchanged by
            # simulation (spec section 13) - resolved the same way
            # compare_tree resolves it, just for every tree in the dataset
            # instead of one, since the impact chain routinely shows nodes
            # from trees the user never selected.
            bench_resolved = resolve_selection(self._conn, dataset_id, tree.tree_code, benchmark_key)
            for node_id, value in bench_resolved.nodes.items():
                key = graph.node_id_to_key.get(node_id)
                if key:
                    benchmark_values[key] = ResolvedValue(value.status, value.value)

            if target is not None:
                target_resolved = resolve_selection(self._conn, dataset_id, tree.tree_code, target)
                for node_id, value in target_resolved.nodes.items():
                    key = graph.node_id_to_key.get(node_id)
                    if key:
                        target_values[key] = ResolvedValue(value.status, value.value)

        # Overrides are seeded before any recalculation, and are never part of
        # `affected`. That is the cut-point rule: an overridden node's manual
        # value simply *is* its value, and nothing recomputes it from a formula.
        computed: dict[str, ResolvedValue] = dict(baseline_values)
        for key, value in override_map.items():
            computed[key] = ResolvedValue(ValueStatus.AVAILABLE, value)

        affected = find_ancestors(graph.reverse, set(override_map))
        order = [key for key in topological_order(graph.forward) if key in affected]

        for key in order:
            info = graph.node_index[key]

            def resolver(ref, _owner=info.tree_code):
                dep_key = f"{ref.tree_code or _owner}.{ref.node_code}"
                return computed.get(dep_key, ResolvedValue(ValueStatus.MISSING_DEPENDENCY, None))

            outcome = evaluate(parse_formula(info.formula), resolver)
            computed[key] = ResolvedValue(outcome.status, outcome.value)

        rows = []
        for key, info in graph.node_index.items():
            base = baseline_values.get(key, ResolvedValue(ValueStatus.MISSING, None))
            sim = computed.get(key, base)
            is_override = key in override_map
            bench = benchmark_values.get(key)
            tgt = target_values.get(key)

            if info.node_type is NodeType.GROUP:
                outcome_delta, outcome_pct, outcome_fav = None, None, Favorability.NEUTRAL
                base_value = sim_value = None
                sim_status = base.status
                target_delta, target_pct, target_fav = None, None, Favorability.NEUTRAL
            else:
                outcome = compare_values(base.status, base.value, sim.status, sim.value,
                                         info.favorable_direction)
                outcome_delta, outcome_pct, outcome_fav = (
                    outcome.delta, outcome.percent_delta, outcome.favorability)
                base_value, sim_value = base.value, sim.value
                sim_status = sim.status

                if tgt is not None:
                    # The simulated value plays the "actual result" role and
                    # the target plays the "goal" role - same convention
                    # compare_tree uses for Baseline x Target.
                    target_outcome = compare_values(
                        sim.status, sim.value, tgt.status, tgt.value,
                        info.favorable_direction, comparator_is_target=True)
                    target_delta, target_pct, target_fav = (
                        target_outcome.delta, target_outcome.percent_delta,
                        target_outcome.favorability)
                else:
                    target_delta, target_pct, target_fav = None, None, Favorability.NEUTRAL

            formula_overridden = is_override and info.node_type is NodeType.CALCULATED
            depends_on = sorted(graph.forward.get(key, set()))
            blocked_children = depends_on if formula_overridden else []

            formula_display = None
            if info.formula:
                formula_display = render_formula_display(info.formula, info.tree_code, graph.node_index)

            baseline_causes: list[RootCause] = []
            if base.status is ValueStatus.MISSING_DEPENDENCY:
                baseline_status_of = lambda k: baseline_values.get(  # noqa: E731
                    k, ResolvedValue(ValueStatus.MISSING, None)).status
                baseline_causes = find_missing_root_causes(graph, key, baseline_status_of)

            simulated_causes: list[RootCause] = []
            if sim_status is ValueStatus.MISSING_DEPENDENCY:
                simulated_status_of = lambda k: computed.get(  # noqa: E731
                    k, ResolvedValue(ValueStatus.MISSING, None)).status
                simulated_causes = find_missing_root_causes(graph, key, simulated_status_of)

            rows.append(SimulationRow(
                tree_code=info.tree_code, node_id=info.node_id, node_code=info.node_code,
                kpi_name=info.kpi_name, unit=info.unit, node_type=info.node_type.value,
                favorable_direction=(info.favorable_direction.value
                                     if info.favorable_direction else None),
                baseline_status=base.status, baseline_value=base_value,
                baseline_is_override=is_value_overridden(
                    info.node_type, baseline_origins.get(key)),
                baseline_missing_root_causes=baseline_causes,
                simulated_status=sim_status, simulated_value=sim_value,
                simulated_missing_root_causes=simulated_causes,
                delta=outcome_delta, percent_delta=outcome_pct, favorability=outcome_fav,
                is_override=is_override, formula_overridden=formula_overridden,
                blocked_children=blocked_children, depends_on=depends_on,
                benchmark_status=bench.status if bench else None,
                benchmark_value=bench.value if bench else None,
                formula_display=formula_display,
                target_status=tgt.status if tgt else None,
                target_value=tgt.value if tgt else None,
                target_delta=target_delta, target_percent_delta=target_pct,
                target_favorability=target_fav,
            ))
        return rows
