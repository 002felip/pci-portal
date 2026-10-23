from dataclasses import dataclass
from decimal import Decimal
from typing import Optional

from app.domain.enums import NodeType, ValueContext, ValueStatus
from app.modules.comparisons.favorability import Favorability, compare_values
from app.modules.comparisons.selection import (
    ResolvedNodeValue,
    SelectionKey,
    is_value_overridden,
    resolve_selection,
)
from app.modules.datasets.formula_display import render_formula_display
from app.modules.datasets.graph_builder import build_dataset_graph
from app.modules.datasets.root_cause import RootCause, find_missing_root_causes
from app.modules.datasets.tree_repositories import SqliteTreeNodeRepository


@dataclass
class ComparisonRow:
    node_id: str
    node_code: str
    parent_node_id: Optional[str]
    kpi_name: str
    unit: Optional[str]
    node_type: str
    favorable_direction: Optional[str]
    baseline_status: ValueStatus
    baseline_value: Optional[Decimal]
    baseline_is_override: bool
    baseline_missing_root_causes: list[RootCause]
    comparator_status: ValueStatus
    comparator_value: Optional[Decimal]
    comparator_is_override: bool
    comparator_missing_root_causes: list[RootCause]
    delta: Optional[Decimal]
    percent_delta: Optional[Decimal]
    favorability: Favorability
    benchmark_status: Optional[ValueStatus]
    benchmark_value: Optional[Decimal]
    formula_display: Optional[str]


_NA = ResolvedNodeValue(ValueStatus.MISSING, None)


def compare_tree(
    conn, dataset_id: str, tree_code: str, baseline: SelectionKey, comparator: SelectionKey
) -> list[ComparisonRow]:
    baseline_resolved = resolve_selection(conn, dataset_id, tree_code, baseline)
    comparator_resolved = resolve_selection(conn, dataset_id, tree_code, comparator)

    # The Benchmark footer always follows the baseline's year and cycle, even
    # when the comparator comes from another one (v0 spec section 10).
    benchmark_key = SelectionKey(
        ValueContext.BENCHMARK, baseline.reference_year, baseline.revision_cycle_year)
    benchmark_resolved = resolve_selection(conn, dataset_id, tree_code, benchmark_key)

    node_repo = SqliteTreeNodeRepository(conn)
    baseline_nodes = {n.node_code: n for n in node_repo.list_all(baseline_resolved.tree_structure_id)}
    comparator_nodes = {n.node_code: n
                        for n in node_repo.list_all(comparator_resolved.tree_structure_id)}
    all_codes = sorted(set(baseline_nodes) | set(comparator_nodes))

    same_cycle = baseline_resolved.dataset_cycle_id == comparator_resolved.dataset_cycle_id
    baseline_graph = build_dataset_graph(conn, baseline_resolved.dataset_cycle_id)
    comparator_graph = (baseline_graph if same_cycle
                        else build_dataset_graph(conn, comparator_resolved.dataset_cycle_id))

    # Lazily resolved per tree actually visited, since a MISSING_DEPENDENCY's
    # real cause routinely lives in a different tree than the one requested -
    # each tree touched is resolved once and reused for every node in it.
    baseline_status_cache: dict[str, dict[str, ValueStatus]] = {}
    comparator_status_cache: dict[str, dict[str, ValueStatus]] = {}

    def make_status_of(graph, cache: dict[str, dict[str, ValueStatus]], key: SelectionKey):
        def status_of(node_key: str) -> ValueStatus:
            info = graph.node_index.get(node_key)
            if info is None:
                return ValueStatus.MISSING
            if info.tree_code not in cache:
                resolved = resolve_selection(conn, dataset_id, info.tree_code, key)
                cache[info.tree_code] = {
                    node_id: value.status for node_id, value in resolved.nodes.items()
                }
            return cache[info.tree_code].get(info.node_id, ValueStatus.MISSING)
        return status_of

    baseline_status_of = make_status_of(baseline_graph, baseline_status_cache, baseline)
    comparator_status_of = make_status_of(comparator_graph, comparator_status_cache, comparator)

    rows = []
    for node_code in all_codes:
        base_node = baseline_nodes.get(node_code)
        comp_node = comparator_nodes.get(node_code)
        # A node only present on one side (the two cycles' structures
        # genuinely differ) is real, correct data here - it simply has no
        # resolved value on the side that lacks it. node_id/parent_node_id
        # below are sourced from whichever side has this node_code,
        # preferring baseline; when structures are identical (the common
        # case, and every case before this change), baseline has every
        # node_code, so this never matters. Reconciling the *canvas
        # hierarchy* when they diverge is the Tree Explorer's own job -
        # see the design spec's Phase 2.
        representative = base_node or comp_node

        base = baseline_resolved.nodes.get(base_node.node_id, _NA) if base_node else _NA
        comp = comparator_resolved.nodes.get(comp_node.node_id, _NA) if comp_node else _NA
        bench = benchmark_resolved.nodes.get(base_node.node_id) if base_node else None

        if representative.node_type is NodeType.GROUP:
            outcome_delta, outcome_pct, outcome_fav = None, None, Favorability.NEUTRAL
            base_value = comp_value = None
        else:
            outcome = compare_values(base.status, base.value, comp.status, comp.value,
                                     representative.favorable_direction, comparator_is_target=True)
            outcome_delta, outcome_pct, outcome_fav = (
                outcome.delta, outcome.percent_delta, outcome.favorability)
            base_value, comp_value = base.value, comp.value

        node_key = f"{tree_code}.{node_code}"
        base_info = baseline_graph.node_index.get(node_key)
        comp_info = comparator_graph.node_index.get(node_key)
        info = base_info or comp_info

        formula_display = None
        if info is not None and info.formula:
            display_graph = baseline_graph if base_info is not None else comparator_graph
            formula_display = render_formula_display(info.formula, tree_code, display_graph.node_index)

        baseline_causes: list[RootCause] = []
        if base.status is ValueStatus.MISSING_DEPENDENCY:
            baseline_causes = find_missing_root_causes(baseline_graph, node_key, baseline_status_of)

        comparator_causes: list[RootCause] = []
        if comp.status is ValueStatus.MISSING_DEPENDENCY:
            comparator_causes = find_missing_root_causes(comparator_graph, node_key, comparator_status_of)

        rows.append(ComparisonRow(
            node_id=representative.node_id, node_code=node_code,
            parent_node_id=representative.parent_node_id,
            kpi_name=representative.kpi_name_original, unit=representative.unit_original,
            node_type=representative.node_type.value,
            favorable_direction=(representative.favorable_direction.value
                                 if representative.favorable_direction else None),
            baseline_status=base.status, baseline_value=base_value,
            baseline_is_override=is_value_overridden(
                base_node.node_type if base_node else representative.node_type, base.value_origin),
            baseline_missing_root_causes=baseline_causes,
            comparator_status=comp.status, comparator_value=comp_value,
            comparator_is_override=is_value_overridden(
                comp_node.node_type if comp_node else representative.node_type, comp.value_origin),
            comparator_missing_root_causes=comparator_causes,
            delta=outcome_delta, percent_delta=outcome_pct, favorability=outcome_fav,
            benchmark_status=bench.status if bench else None,
            benchmark_value=bench.value if bench else None,
            formula_display=formula_display,
        ))
    return rows
