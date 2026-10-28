import sqlite3
from typing import Optional

from app.domain.models import NodeDependency, NodeFormula


class SqliteTreeStructureRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def create(self, tree_structure_id: str, tree_id: str,
               structure_code: str = "MVP_STATIC") -> None:
        self._conn.execute(
            "INSERT INTO vdt_tree_structure (tree_structure_id, tree_id, structure_code) "
            "VALUES (?, ?, ?)",
            (tree_structure_id, tree_id, structure_code),
        )

    def get_for_tree(self, tree_id: str) -> Optional[str]:
        row = self._conn.execute(
            "SELECT tree_structure_id FROM vdt_tree_structure WHERE tree_id = ?",
            (tree_id,),
        ).fetchone()
        return row["tree_structure_id"] if row else None


class SqliteNodeFormulaRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def create(self, formula: NodeFormula) -> None:
        self._conn.execute(
            """
            INSERT INTO vdt_node_formula
                (formula_id, node_id, expression, formula_language_version, expression_hash, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (formula.formula_id, formula.node_id, formula.expression,
             formula.formula_language_version, formula.expression_hash, int(formula.is_active)),
        )

    def get_for_node(self, node_id: str) -> Optional[NodeFormula]:
        row = self._conn.execute(
            "SELECT * FROM vdt_node_formula WHERE node_id = ? AND is_active = 1", (node_id,)
        ).fetchone()
        if row is None:
            return None
        return NodeFormula(
            formula_id=row["formula_id"], node_id=row["node_id"], expression=row["expression"],
            formula_language_version=row["formula_language_version"],
            expression_hash=row["expression_hash"], is_active=bool(row["is_active"]),
        )


class SqliteNodeDependencyRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def create(self, dependency: NodeDependency) -> None:
        self._conn.execute(
            """
            INSERT INTO vdt_node_dependency
                (dependency_id, formula_id, result_node_id, source_node_id, reference_scope,
                 source_region_code, source_tree_code, source_node_code, resolution_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (dependency.dependency_id, dependency.formula_id, dependency.result_node_id,
             dependency.source_node_id, dependency.reference_scope, dependency.source_region_code,
             dependency.source_tree_code, dependency.source_node_code,
             dependency.resolution_status),
        )

    def list_for_result_node(self, node_id: str) -> list[NodeDependency]:
        rows = self._conn.execute(
            "SELECT * FROM vdt_node_dependency WHERE result_node_id = ?", (node_id,)
        ).fetchall()
        return [
            NodeDependency(
                dependency_id=r["dependency_id"], formula_id=r["formula_id"],
                result_node_id=r["result_node_id"], source_node_id=r["source_node_id"],
                reference_scope=r["reference_scope"], source_region_code=r["source_region_code"],
                source_tree_code=r["source_tree_code"], source_node_code=r["source_node_code"],
                resolution_status=r["resolution_status"],
            )
            for r in rows
        ]
