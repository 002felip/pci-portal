import hashlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Optional

from app.domain.enums import (
    DatasetType,
    FavorableDirection,
    NodeType,
    TreeType,
    ValueContext,
    ValueOrigin,
    ValueStatus,
)
from app.domain.models import (
    Dataset,
    DatasetCycle,
    NodeDependency,
    NodeFormula,
    NodeValue,
    Region,
    Tree,
    TreeNode,
)
from app.infrastructure.db import unit_of_work
from app.modules.datasets.period_repository import SqliteReportingPeriodRepository
from app.modules.datasets.repositories import (
    SqliteDatasetCycleRepository,
    SqliteDatasetRepository,
    SqliteRegionRepository,
    SqliteRevisionCycleRepository,
)
from app.modules.datasets.structure_repositories import (
    SqliteNodeDependencyRepository,
    SqliteNodeFormulaRepository,
    SqliteTreeStructureRepository,
)
from app.modules.datasets.tree_repositories import SqliteTreeNodeRepository, SqliteTreeRepository
from app.modules.datasets.value_repositories import SqliteNodeValueRepository
from app.modules.formulas.dependencies import extract_references, topological_order
from app.modules.formulas.evaluator import ResolvedValue, evaluate
from app.modules.formulas.parser import parse as parse_formula
from app.modules.imports.models import ParsedWorkbook
from app.modules.imports.service import ImportResult
from app.modules.imports.structure_diff import OldNode, StructureChange, structure_diff

FORMULA_LANGUAGE_VERSION = "1.0"
CONTEXT_BY_LABEL = {
    "Actuals": ValueContext.ACTUALS,
    "Budget": ValueContext.BUDGET,
    "LoBP": ValueContext.LOBP,
    "Benchmark": ValueContext.BENCHMARK,
}


class StructureChangeRequiresConfirmationError(Exception):
    def __init__(self, change: StructureChange):
        super().__init__(
            "This cycle is already published with a different structure; "
            "confirm_structure_change must be true to replace it.")
        self.change = change


class NotPublishableError(Exception):
    pass


@dataclass
class PublicationSummary:
    dataset_id: str
    dataset_cycle_id: str
    node_count: int
    value_count: int


def _uuid() -> str:
    return str(uuid.uuid4())


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_expression_hash(expression: str) -> str:
    return hashlib.sha256(expression.strip().encode("utf-8")).hexdigest()


def _hierarchy_order(nodes):
    """Parents before children, so parent_node_id is always resolvable."""
    by_code = {n.node_code: n for n in nodes}
    ordered, visited = [], set()

    def visit(node):
        if node.node_code in visited:
            return
        visited.add(node.node_code)
        parent = by_code.get(node.parent_node_code) if node.parent_node_code else None
        if parent is not None:
            visit(parent)
        ordered.append(node)

    for node in nodes:
        visit(node)
    return ordered


def load_old_nodes(conn, dataset_cycle_id: str) -> list[OldNode]:
    """Every node currently published under one dataset_cycle, in the shape
    structure_diff compares against an incoming workbook. Used both by
    PublicationService (deciding whether a same-cycle republish needs
    confirmation) and by preview_structure_change (surfacing the same diff
    at /validate time, before the user ever reaches publish)."""
    trees_repo = SqliteTreeRepository(conn)
    structures = SqliteTreeStructureRepository(conn)
    nodes_repo = SqliteTreeNodeRepository(conn)
    formulas = SqliteNodeFormulaRepository(conn)

    old_nodes: list[OldNode] = []
    for tree in trees_repo.list_by_dataset_cycle(dataset_cycle_id):
        structure_id = structures.get_for_tree(tree.tree_id)
        if structure_id is None:
            continue
        by_id = {n.node_id: n for n in nodes_repo.list_all(structure_id)}
        for node in by_id.values():
            parent_code = (by_id[node.parent_node_id].node_code
                           if node.parent_node_id else None)
            formula = formulas.get_for_node(node.node_id)
            old_nodes.append(OldNode(
                tree_code=tree.tree_code, node_code=node.node_code,
                parent_node_code=parent_code, display_order=node.display_order,
                kpi_name=node.kpi_name_original, description=node.description_original,
                unit=node.unit_original, node_type=node.node_type.value,
                formula=formula.expression if formula else None,
                favorable_direction=(node.favorable_direction.value
                                     if node.favorable_direction else None),
            ))
    return old_nodes


def preview_structure_change(conn, parsed: ParsedWorkbook) -> Optional[StructureChange]:
    """The same diff PublicationService.publish would require confirmation
    for, computed without publishing anything - lets /api/imports/validate
    show it before the user ever clicks publish. None means either this is
    a brand-new cycle (nothing to diff against) or nothing would change."""
    if parsed.region_code is None or parsed.revision_cycle_year is None:
        return None
    dataset = SqliteDatasetRepository(conn).get_by_code(DatasetType.REGION, parsed.region_code)
    if dataset is None:
        return None
    cycle = SqliteRevisionCycleRepository(conn).get_by_year(parsed.revision_cycle_year)
    if cycle is None:
        return None
    existing_cycle = SqliteDatasetCycleRepository(conn).get(
        dataset.dataset_id, cycle.revision_cycle_id)
    if existing_cycle is None:
        return None
    change = structure_diff(load_old_nodes(conn, existing_cycle.dataset_cycle_id), parsed)
    return change if change else None


class PublicationService:
    def __init__(self, conn, archive_dir=None):
        self._conn = conn
        self._archive_dir = Path(archive_dir) if archive_dir else None

    def publish(
        self, result: ImportResult, template_version: str = "1.2",
        confirm_structure_change: bool = False,
    ) -> PublicationSummary:
        if not result.is_publishable:
            raise NotPublishableError("Workbook has blocking issues and cannot be published")

        parsed = result.parsed
        with unit_of_work(self._conn):
            region_id = self._ensure_region(parsed.region_code, parsed.region_name)
            dataset = self._ensure_dataset(parsed.region_code, region_id)
            cycle = SqliteRevisionCycleRepository(self._conn).get_or_create_by_year(
                parsed.revision_cycle_year)

            existing_cycle = SqliteDatasetCycleRepository(self._conn).get(
                dataset.dataset_id, cycle.revision_cycle_id)

            if existing_cycle is not None:
                change = structure_diff(
                    load_old_nodes(self._conn, existing_cycle.dataset_cycle_id), parsed)
                if change and not confirm_structure_change:
                    raise StructureChangeRequiresConfirmationError(change)
                self._wipe_cycle(existing_cycle.dataset_cycle_id)

            dataset_cycle_id = _uuid()
            SqliteDatasetCycleRepository(self._conn).publish(DatasetCycle(
                dataset_cycle_id=dataset_cycle_id, dataset_id=dataset.dataset_id,
                revision_cycle_id=cycle.revision_cycle_id, template_version=template_version,
                publication_id=_uuid(), published_at=_utcnow(),
            ))

            structure = self._create_structure(parsed, dataset_cycle_id)
            value_count = self._calculate_and_store(parsed, structure, dataset_cycle_id)

        return PublicationSummary(
            dataset_id=dataset.dataset_id, dataset_cycle_id=dataset_cycle_id,
            node_count=sum(len(t.nodes) for t in parsed.trees), value_count=value_count,
        )

    # -- scope -------------------------------------------------------------

    def _ensure_region(self, region_code: str, region_name: str) -> str:
        repo = SqliteRegionRepository(self._conn)
        existing = repo.get_by_code(region_code)
        if existing:
            return existing.region_id
        region_id = _uuid()
        repo.create(Region(region_id, region_code, region_name, True))
        return region_id

    def _ensure_dataset(self, region_code: str, region_id: str) -> Dataset:
        repo = SqliteDatasetRepository(self._conn)
        existing = repo.get_by_code(DatasetType.REGION, region_code)
        if existing:
            return existing
        dataset = Dataset(_uuid(), DatasetType.REGION, region_id, region_code)
        repo.create(dataset)
        return dataset

    # -- structure -----------------------------------------------------------

    def _wipe_cycle(self, dataset_cycle_id: str) -> None:
        """Deletes everything belonging to one dataset_cycle - values, then
        the tree structure itself - child-before-parent (foreign_keys=ON
        checks immediately). Used only when re-publishing an
        already-published cycle; never touches any other cycle's rows."""
        self._conn.execute(
            "DELETE FROM vdt_calculation_issue WHERE node_value_id IN "
            "(SELECT node_value_id FROM vdt_node_value WHERE dataset_cycle_id = ?)",
            (dataset_cycle_id,),
        )
        self._conn.execute(
            "DELETE FROM vdt_node_value WHERE dataset_cycle_id = ?", (dataset_cycle_id,))
        self._conn.execute(
            "DELETE FROM vdt_node_dependency WHERE result_node_id IN ("
            "  SELECT n.node_id FROM vdt_tree_node n "
            "  JOIN vdt_tree_structure s ON s.tree_structure_id = n.tree_structure_id "
            "  JOIN vdt_tree t ON t.tree_id = s.tree_id WHERE t.dataset_cycle_id = ?)",
            (dataset_cycle_id,),
        )
        self._conn.execute(
            "DELETE FROM vdt_node_formula WHERE node_id IN ("
            "  SELECT n.node_id FROM vdt_tree_node n "
            "  JOIN vdt_tree_structure s ON s.tree_structure_id = n.tree_structure_id "
            "  JOIN vdt_tree t ON t.tree_id = s.tree_id WHERE t.dataset_cycle_id = ?)",
            (dataset_cycle_id,),
        )
        self._conn.execute(
            "DELETE FROM vdt_tree_node WHERE tree_structure_id IN ("
            "  SELECT s.tree_structure_id FROM vdt_tree_structure s "
            "  JOIN vdt_tree t ON t.tree_id = s.tree_id WHERE t.dataset_cycle_id = ?)",
            (dataset_cycle_id,),
        )
        self._conn.execute(
            "DELETE FROM vdt_tree_structure WHERE tree_id IN ("
            "  SELECT tree_id FROM vdt_tree WHERE dataset_cycle_id = ?)",
            (dataset_cycle_id,),
        )
        self._conn.execute("DELETE FROM vdt_tree WHERE dataset_cycle_id = ?", (dataset_cycle_id,))

    def _create_structure(self, parsed, dataset_cycle_id: str) -> dict:
        """Always creates fresh - a dataset_cycle's tree is either brand new
        or was just wiped by _wipe_cycle; there is never an existing node to
        reuse (that reuse-by-code behavior is gone along with the cycles it
        used to reuse across). Returns {tree_code: {node_code: node_id}}."""
        trees_repo = SqliteTreeRepository(self._conn)
        structures = SqliteTreeStructureRepository(self._conn)
        nodes_repo = SqliteTreeNodeRepository(self._conn)
        formulas = SqliteNodeFormulaRepository(self._conn)
        dependencies = SqliteNodeDependencyRepository(self._conn)

        index: dict[str, dict[str, str]] = {}
        structure_ids: dict[str, str] = {}

        for tree in parsed.trees:
            tree_id = _uuid()
            trees_repo.create(Tree(tree_id, dataset_cycle_id, tree.tree_code, tree.tree_name,
                                   TreeType(tree.tree_type), tree.worksheet))
            structure_id = _uuid()
            structures.create(structure_id, tree_id)
            structure_ids[tree.tree_code] = structure_id
            index[tree.tree_code] = {}

        # Nodes: parents must exist first, so insert in hierarchy order.
        for tree in parsed.trees:
            structure_id = structure_ids[tree.tree_code]
            for node in _hierarchy_order(tree.nodes):
                node_id = _uuid()
                parent_id = (index[tree.tree_code].get(node.parent_node_code)
                             if node.parent_node_code else None)
                nodes_repo.create(TreeNode(
                    node_id=node_id, tree_structure_id=structure_id, node_code=node.node_code,
                    parent_node_id=parent_id, display_order=node.display_order,
                    kpi_name_original=node.kpi_name, description_original=node.description,
                    unit_original=node.unit, node_type=NodeType(node.node_type),
                    favorable_direction=(FavorableDirection(node.favorable_direction)
                                         if node.favorable_direction else None),
                ))
                index[tree.tree_code][node.node_code] = node_id

        # Formulas and dependencies, once every node id exists.
        for tree in parsed.trees:
            for node in tree.nodes:
                if node.node_type != NodeType.CALCULATED.value or not node.formula:
                    continue
                node_id = index[tree.tree_code][node.node_code]
                formula_id = _uuid()
                formulas.create(NodeFormula(
                    formula_id=formula_id, node_id=node_id, expression=node.formula,
                    formula_language_version=FORMULA_LANGUAGE_VERSION,
                    expression_hash=canonical_expression_hash(node.formula), is_active=True,
                ))
                for ref in extract_references(parse_formula(node.formula)):
                    target_tree = ref.tree_code or tree.tree_code
                    source_id = index.get(target_tree, {}).get(ref.node_code)
                    dependencies.create(NodeDependency(
                        dependency_id=_uuid(), formula_id=formula_id, result_node_id=node_id,
                        source_node_id=source_id, reference_scope=ref.scope,
                        source_region_code=ref.region_code,
                        source_tree_code=ref.tree_code or tree.tree_code,
                        source_node_code=ref.node_code,
                        resolution_status="RESOLVED" if source_id else "MISSING_DEPENDENCY",
                    ))
        return index

    # -- values ------------------------------------------------------------

    def _calculate_and_store(self, parsed, index: dict, dataset_cycle_id: str) -> int:
        values_repo = SqliteNodeValueRepository(self._conn)
        periods = SqliteReportingPeriodRepository(self._conn)

        node_by_key = {}
        graph: dict[str, set[str]] = {}
        for tree in parsed.trees:
            for node in tree.nodes:
                key = f"{tree.tree_code}.{node.node_code}"
                node_by_key[key] = (tree, node)
                deps = set()
                if node.node_type == NodeType.CALCULATED.value and node.formula:
                    for ref in extract_references(parse_formula(node.formula)):
                        deps.add(f"{ref.tree_code or tree.tree_code}.{ref.node_code}")
                graph[key] = deps

        order = topological_order(graph)
        years = sorted({b.year for t in parsed.trees for b in t.year_blocks})
        stored = 0

        for year in years:
            period_id = periods.get_or_create_for_year(year)
            for label, context in CONTEXT_BY_LABEL.items():
                computed: dict[str, tuple[ValueStatus, Optional[Decimal]]] = {}
                for key in order:
                    tree, node = node_by_key[key]
                    status, value, is_override = self._value_for(
                        node, year, label, context, computed, tree)
                    computed[key] = (status, value)

                    if node.node_type == NodeType.GROUP.value:
                        continue
                    origin = (ValueOrigin.INPUT if is_override
                              else ValueOrigin.CALCULATED
                              if node.node_type == NodeType.CALCULATED.value
                              else ValueOrigin.INPUT)
                    values_repo.upsert(NodeValue(
                        node_value_id=_uuid(), dataset_cycle_id=dataset_cycle_id,
                        node_id=index[tree.tree_code][node.node_code],
                        value_context=context, period_id=period_id,
                        value=value, value_status=status, value_origin=origin, formula_id=None,
                    ))
                    stored += 1
        return stored

    def _value_for(self, node, year, label, context, computed, tree):
        if node.node_type == NodeType.GROUP.value:
            return ValueStatus.MISSING, None, False

        if node.node_type == NodeType.INPUT.value or not node.formula:
            supplied = next((v.value for v in node.values
                             if v.year == year and v.context == label), None)
            if supplied is not None:
                return ValueStatus.AVAILABLE, supplied, False
            return ((ValueStatus.NOT_INFORMED if context is ValueContext.BENCHMARK
                     else ValueStatus.MISSING), None, False)

        # A CALCULATED node's own supplied value, when present for this exact
        # (year, context) cell, wins over the formula - the business case is a
        # forward estimate (typically LoBP) given only at this node's own level,
        # where the children needed to compute it bottom-up were never estimated
        # that far out. Every other cell of the same node still falls through to
        # the formula below.
        overridden = next((v.value for v in node.values
                           if v.year == year and v.context == label), None)
        if overridden is not None:
            return ValueStatus.AVAILABLE, overridden, True

        def resolver(ref):
            key = f"{ref.tree_code or tree.tree_code}.{ref.node_code}"
            status, value = computed.get(key, (ValueStatus.MISSING_DEPENDENCY, None))
            return ResolvedValue(status, value)

        outcome = evaluate(parse_formula(node.formula), resolver)
        return outcome.status, outcome.value, False
