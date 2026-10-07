import sqlite3
from typing import Optional

from app.domain.enums import FavorableDirection, NodeType, TreeType
from app.domain.models import Tree, TreeNode


class SqliteTreeRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def create(self, tree: Tree) -> None:
        self._conn.execute(
            """
            INSERT INTO vdt_tree
                (tree_id, dataset_cycle_id, tree_code, tree_name_original, tree_type, source_worksheet)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (tree.tree_id, tree.dataset_cycle_id, tree.tree_code, tree.tree_name_original,
             tree.tree_type.value, tree.source_worksheet),
        )

    def get_by_code(self, dataset_cycle_id: str, tree_code: str) -> Optional[Tree]:
        row = self._conn.execute(
            """
            SELECT tree_id, dataset_cycle_id, tree_code, tree_name_original, tree_type, source_worksheet
            FROM vdt_tree WHERE dataset_cycle_id = ? AND tree_code = ?
            """,
            (dataset_cycle_id, tree_code),
        ).fetchone()
        if row is None:
            return None
        return self._to_tree(row)

    def get_by_id(self, tree_id: str) -> Optional[Tree]:
        row = self._conn.execute(
            """
            SELECT tree_id, dataset_cycle_id, tree_code, tree_name_original, tree_type, source_worksheet
            FROM vdt_tree WHERE tree_id = ?
            """,
            (tree_id,),
        ).fetchone()
        if row is None:
            return None
        return self._to_tree(row)

    def list_by_dataset_cycle(self, dataset_cycle_id: str) -> list[Tree]:
        rows = self._conn.execute(
            """
            SELECT tree_id, dataset_cycle_id, tree_code, tree_name_original, tree_type, source_worksheet
            FROM vdt_tree WHERE dataset_cycle_id = ?
            """,
            (dataset_cycle_id,),
        ).fetchall()
        return [self._to_tree(row) for row in rows]

    @staticmethod
    def _to_tree(row: sqlite3.Row) -> Tree:
        return Tree(
            tree_id=row["tree_id"],
            dataset_cycle_id=row["dataset_cycle_id"],
            tree_code=row["tree_code"],
            tree_name_original=row["tree_name_original"],
            tree_type=TreeType(row["tree_type"]),
            source_worksheet=row["source_worksheet"],
        )


class SqliteTreeNodeRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def create(self, node: TreeNode) -> None:
        self._conn.execute(
            """
            INSERT INTO vdt_tree_node
                (node_id, tree_structure_id, node_code, parent_node_id, display_order,
                 kpi_name_original, description_original, unit_original, node_type, favorable_direction)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (node.node_id, node.tree_structure_id, node.node_code, node.parent_node_id,
             node.display_order, node.kpi_name_original, node.description_original,
             node.unit_original, node.node_type.value,
             node.favorable_direction.value if node.favorable_direction else None),
        )

    def list_all(self, tree_structure_id: str) -> list[TreeNode]:
        rows = self._conn.execute(
            "SELECT * FROM vdt_tree_node WHERE tree_structure_id = ?", (tree_structure_id,)
        ).fetchall()
        return [self._to_node(row) for row in rows]

    def get_by_code(self, tree_structure_id: str, node_code: str) -> Optional[TreeNode]:
        row = self._conn.execute(
            "SELECT * FROM vdt_tree_node WHERE tree_structure_id = ? AND node_code = ?",
            (tree_structure_id, node_code),
        ).fetchone()
        if row is None:
            return None
        return self._to_node(row)

    def list_roots(self, tree_structure_id: str) -> list[TreeNode]:
        rows = self._conn.execute(
            """
            SELECT * FROM vdt_tree_node
            WHERE tree_structure_id = ? AND parent_node_id IS NULL
            ORDER BY display_order
            """,
            (tree_structure_id,),
        ).fetchall()
        return [self._to_node(row) for row in rows]

    def list_children(self, tree_structure_id: str, parent_node_id: Optional[str]) -> list[TreeNode]:
        if parent_node_id is None:
            return self.list_roots(tree_structure_id)
        rows = self._conn.execute(
            """
            SELECT * FROM vdt_tree_node
            WHERE tree_structure_id = ? AND parent_node_id = ?
            ORDER BY display_order
            """,
            (tree_structure_id, parent_node_id),
        ).fetchall()
        return [self._to_node(row) for row in rows]

    @staticmethod
    def _to_node(row: sqlite3.Row) -> TreeNode:
        return TreeNode(
            node_id=row["node_id"],
            tree_structure_id=row["tree_structure_id"],
            node_code=row["node_code"],
            parent_node_id=row["parent_node_id"],
            display_order=row["display_order"],
            kpi_name_original=row["kpi_name_original"],
            description_original=row["description_original"],
            unit_original=row["unit_original"],
            node_type=NodeType(row["node_type"]),
            favorable_direction=(
                FavorableDirection(row["favorable_direction"]) if row["favorable_direction"] else None
            ),
        )
