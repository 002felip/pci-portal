from collections import Counter, defaultdict

from app.domain.enums import FavorableDirection, NodeType, TreeType
from app.modules.formulas.dependencies import detect_cycle, extract_references
from app.modules.formulas.errors import (
    FormulaSyntaxError,
    InvalidReferenceError,
    UnknownFunctionError,
)
from app.modules.formulas.parser import parse as parse_formula
from app.modules.imports.issues import IssueCollector
from app.modules.imports.models import ParsedTree, ParsedWorkbook

EXPECTED_TEMPLATE_VERSION = "1.2"
REGIONAL_TREE_TYPES = {TreeType.REGIONAL_FCF.value, TreeType.PRODUCTION.value, TreeType.COST.value}
NODE_TYPES = {t.value for t in NodeType}
DIRECTIONS = {d.value for d in FavorableDirection}


def validate_structure(parsed: ParsedWorkbook, issues: IssueCollector) -> None:
    _validate_metadata(parsed, issues)
    _validate_registry(parsed, issues)
    for tree in parsed.trees:
        if tree.worksheet is None:
            continue
        _validate_hierarchy(tree, issues)
        _validate_nodes(tree, issues)


def _validate_metadata(parsed: ParsedWorkbook, issues: IssueCollector) -> None:
    sheet = "01_Workbook"
    if parsed.template_version != EXPECTED_TEMPLATE_VERSION:
        issues.blocking(
            "TEMPLATE_VERSION_MISMATCH",
            f"Template version must be {EXPECTED_TEMPLATE_VERSION}, found {parsed.template_version!r}",
            sheet=sheet, row=5, column="C",
        )
    if parsed.workbook_type != "REGION":
        issues.blocking(
            "WORKBOOK_TYPE_MISMATCH",
            f"This importer accepts REGION workbooks, found {parsed.workbook_type!r}",
            sheet=sheet, row=6, column="C",
        )
    if not parsed.region_code:
        issues.blocking("MISSING_REGION_CODE", "Region Code is required",
                        sheet=sheet, row=7, column="C")
    if not parsed.region_name:
        issues.blocking("MISSING_REGION_NAME", "Region Name is required",
                        sheet=sheet, row=8, column="C")
    year = parsed.revision_cycle_year
    if year is None:
        issues.blocking("MISSING_REVISION_CYCLE_YEAR",
                        "Revision Cycle Year is required", sheet=sheet, row=9, column="C")
    elif not (1900 <= year <= 2999):
        issues.blocking("INVALID_REVISION_CYCLE_YEAR",
                        f"Revision Cycle Year must be a four-digit year, found {year!r}",
                        sheet=sheet, row=9, column="C")


def _validate_registry(parsed: ParsedWorkbook, issues: IssueCollector) -> None:
    sheet = "02_Trees"
    if not parsed.trees:
        issues.blocking("EMPTY_TREE_REGISTRY", "No trees registered", sheet=sheet, row=5)
        return

    for tree in parsed.trees:
        if not tree.tree_code:
            issues.blocking("MISSING_TREE_CODE", "Tree Code is required",
                            sheet=sheet, row=tree.registry_row, column="A")
        if tree.tree_type not in REGIONAL_TREE_TYPES:
            issues.blocking(
                "INVALID_TREE_TYPE",
                f"Tree Type must be one of {sorted(REGIONAL_TREE_TYPES)}, found {tree.tree_type!r}",
                sheet=sheet, row=tree.registry_row, column="C",
            )

    duplicates = [code for code, n in Counter(t.tree_code for t in parsed.trees).items()
                  if n > 1 and code]
    for code in duplicates:
        issues.blocking("DUPLICATE_TREE_CODE", f"Tree Code {code!r} is registered more than once",
                        sheet=sheet)

    fcf_count = sum(1 for t in parsed.trees if t.tree_type == TreeType.REGIONAL_FCF.value)
    if fcf_count != 1:
        issues.blocking(
            "REGIONAL_FCF_COUNT",
            f"A regional workbook must register exactly one REGIONAL_FCF tree, found {fcf_count}",
            sheet=sheet,
        )

    pairs = defaultdict(list)
    for tree in parsed.trees:
        if tree.tree_type in (TreeType.PRODUCTION.value, TreeType.COST.value):
            if not tree.pair_code:
                issues.blocking(
                    "MISSING_PAIR_CODE",
                    f"Tree {tree.tree_code!r} is {tree.tree_type} and requires a Pair Code",
                    sheet=sheet, row=tree.registry_row, column="D",
                )
            else:
                pairs[tree.pair_code].append(tree)
        elif tree.pair_code:
            issues.blocking(
                "UNEXPECTED_PAIR_CODE",
                f"Tree {tree.tree_code!r} is {tree.tree_type} and must not have a Pair Code",
                sheet=sheet, row=tree.registry_row, column="D",
            )

    if not pairs:
        issues.blocking("NO_PAIRS", "A regional workbook needs at least one Production/Cost pair",
                        sheet=sheet)
    for pair_code, members in pairs.items():
        types = sorted(t.tree_type for t in members)
        if types != [TreeType.COST.value, TreeType.PRODUCTION.value]:
            issues.blocking(
                "INCOMPLETE_PAIR",
                f"Pair {pair_code!r} must have exactly one PRODUCTION and one COST tree, found {types}",
                sheet=sheet,
            )


def _validate_hierarchy(tree: ParsedTree, issues: IssueCollector) -> None:
    codes = [n.node_code for n in tree.nodes]
    known = set(codes)

    for code, n in Counter(codes).items():
        if n > 1:
            issues.blocking("DUPLICATE_NODE_CODE",
                            f"Node Code {code!r} appears {n} times in this tree",
                            sheet=tree.worksheet, node_code=code)

    roots = [n for n in tree.nodes if n.parent_node_code is None]
    if tree.nodes and not roots:
        issues.blocking("NO_ROOT", "Every node declares a parent, so the tree has no root",
                        sheet=tree.worksheet)
    # Multiple roots are permitted - see docs/architecture/vdt-database-design.md

    for node in tree.nodes:
        if node.parent_node_code and node.parent_node_code not in known:
            issues.blocking(
                "ORPHAN_NODE",
                f"Parent Node Code {node.parent_node_code!r} does not exist in this tree",
                sheet=tree.worksheet, row=node.row, column="B", node_code=node.node_code,
            )
        if node.parent_node_code == node.node_code:
            issues.blocking("SELF_PARENT", f"Node {node.node_code!r} is its own parent",
                            sheet=tree.worksheet, row=node.row, column="B",
                            node_code=node.node_code)

    seen = defaultdict(set)
    for node in tree.nodes:
        if node.display_order is None:
            issues.blocking("MISSING_DISPLAY_ORDER", "Display Order is required",
                            sheet=tree.worksheet, row=node.row, column="C",
                            node_code=node.node_code)
            continue
        if node.display_order <= 0:
            issues.blocking("INVALID_DISPLAY_ORDER",
                            f"Display Order must be greater than zero, found {node.display_order}",
                            sheet=tree.worksheet, row=node.row, column="C",
                            node_code=node.node_code)
        key = node.parent_node_code
        if node.display_order in seen[key]:
            issues.blocking(
                "DUPLICATE_DISPLAY_ORDER",
                f"Display Order {node.display_order} is used twice among the children of "
                f"{key or '(root)'}",
                sheet=tree.worksheet, row=node.row, column="C", node_code=node.node_code,
            )
        seen[key].add(node.display_order)

    _detect_hierarchy_cycle(tree, issues)


def _detect_hierarchy_cycle(tree: ParsedTree, issues: IssueCollector) -> None:
    parent_of = {n.node_code: n.parent_node_code for n in tree.nodes}
    for start in parent_of:
        seen = set()
        current = start
        while current is not None:
            if current in seen:
                issues.blocking("HIERARCHY_CYCLE",
                                f"Node {start!r} sits in a parent cycle",
                                sheet=tree.worksheet, node_code=start)
                break
            seen.add(current)
            current = parent_of.get(current)


def _validate_nodes(tree: ParsedTree, issues: IssueCollector) -> None:
    for node in tree.nodes:
        loc = dict(sheet=tree.worksheet, row=node.row, node_code=node.node_code)

        if node.node_type not in NODE_TYPES:
            issues.blocking("INVALID_NODE_TYPE",
                            f"Node Type must be one of {sorted(NODE_TYPES)}, found {node.node_type!r}",
                            column="G", **loc)
            continue

        if not node.kpi_name:
            issues.blocking("MISSING_KPI_NAME", "KPI Name is required", column="D", **loc)

        has_values = any(v.value is not None for v in node.values)

        if node.node_type == NodeType.GROUP.value:
            if node.formula:
                issues.blocking("GROUP_WITH_FORMULA", "A GROUP node must not have a formula",
                                column="H", **loc)
            if node.favorable_direction:
                issues.blocking("GROUP_HAS_FAVORABLE_DIRECTION",
                                "A GROUP node must leave Favorable Direction blank",
                                column="I", **loc)
            if has_values:
                issues.blocking("GROUP_WITH_VALUES", "A GROUP node must not carry values", **loc)
            continue

        if node.favorable_direction is None:
            issues.blocking("MISSING_FAVORABLE_DIRECTION",
                            f"{node.node_type} nodes require a Favorable Direction",
                            column="I", **loc)
        elif node.favorable_direction not in DIRECTIONS:
            issues.blocking("INVALID_FAVORABLE_DIRECTION",
                            f"Favorable Direction must be one of {sorted(DIRECTIONS)}, "
                            f"found {node.favorable_direction!r}",
                            column="I", **loc)

        if node.node_type == NodeType.INPUT.value and node.formula:
            issues.blocking("INPUT_WITH_FORMULA", "An INPUT node must not have a formula",
                            column="H", **loc)

        if node.node_type == NodeType.CALCULATED.value:
            if not node.formula:
                issues.blocking("CALCULATED_WITHOUT_FORMULA",
                                "A CALCULATED node requires a formula", column="H", **loc)
            elif node.formula.startswith("="):
                issues.blocking(
                    "FORMULA_LOOKS_LIKE_EXCEL",
                    "The Formula column holds controlled-language text, not an Excel formula; "
                    "remove the leading '='",
                    column="H", **loc,
                )
            if has_values:
                issues.warning(
                    "CALCULATED_WITH_VALUES",
                    "A value supplied for a CALCULATED node overrides its formula "
                    "for that specific year and context only; every other cell of "
                    "this node still computes from the formula",
                    **loc,
                )


def validate_formulas(parsed: ParsedWorkbook, issues: IssueCollector) -> None:
    # tree_code -> {node_code: node_type}
    index = {
        tree.tree_code: {n.node_code: n.node_type for n in tree.nodes}
        for tree in parsed.trees
    }
    graph: dict[str, set[str]] = {
        f"{tree.tree_code}.{node.node_code}": set()
        for tree in parsed.trees for node in tree.nodes
    }

    for tree in parsed.trees:
        for node in tree.nodes:
            if node.node_type != NodeType.CALCULATED.value or not node.formula:
                continue
            loc = dict(sheet=tree.worksheet, row=node.row, column="H", node_code=node.node_code)
            text = node.formula[1:] if node.formula.startswith("=") else node.formula

            try:
                ast = parse_formula(text)
                references = extract_references(ast)
            except FormulaSyntaxError as exc:
                issues.blocking("FORMULA_SYNTAX_ERROR", str(exc), **loc)
                continue
            except UnknownFunctionError as exc:
                issues.blocking("FORMULA_UNKNOWN_FUNCTION", str(exc), **loc)
                continue
            except InvalidReferenceError as exc:
                issues.blocking("INVALID_REFERENCE", str(exc), **loc)
                continue

            key = f"{tree.tree_code}.{node.node_code}"
            for ref in references:
                if ref.region_code is not None:
                    issues.blocking(
                        "CROSS_REGION_REFERENCE",
                        f"A regional formula cannot reference another region "
                        f"({ref.region_code}.{ref.tree_code}.{ref.node_code})",
                        **loc,
                    )
                    continue
                target_tree = ref.tree_code or tree.tree_code
                if target_tree not in index:
                    issues.blocking(
                        "INVALID_TREE_REFERENCE",
                        f"Formula references tree {target_tree!r}, which is not registered",
                        **loc,
                    )
                    continue
                target_type = index[target_tree].get(ref.node_code)
                if target_type is None:
                    issues.blocking(
                        "INVALID_REFERENCE",
                        f"Formula references {target_tree}.{ref.node_code}, which does not exist",
                        **loc,
                    )
                    continue
                if target_type == NodeType.GROUP.value:
                    issues.blocking(
                        "REFERENCE_TO_GROUP",
                        f"Formula references {target_tree}.{ref.node_code}, a GROUP node, "
                        f"which never carries a value",
                        **loc,
                    )
                    continue
                graph[key].add(f"{target_tree}.{ref.node_code}")

    cycle = detect_cycle(graph)
    if cycle is not None:
        issues.blocking(
            "FORMULA_DEPENDENCY_CYCLE",
            "Formulas form a dependency cycle: " + " -> ".join(cycle),
        )
