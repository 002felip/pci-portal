import sqlite3
from decimal import Decimal
from typing import Optional

from app.domain.enums import ValueContext, ValueOrigin, ValueStatus
from app.domain.models import NodeValue


class SqliteNodeValueRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def upsert(self, value: NodeValue) -> None:
        self._conn.execute(
            """
            INSERT INTO vdt_node_value
                (node_value_id, dataset_cycle_id, node_id, value_context, period_id,
                 value, value_status, value_origin, formula_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (dataset_cycle_id, node_id, value_context, period_id) DO UPDATE SET
                node_value_id = excluded.node_value_id,
                value = excluded.value,
                value_status = excluded.value_status,
                value_origin = excluded.value_origin,
                formula_id = excluded.formula_id
            """,
            (
                value.node_value_id, value.dataset_cycle_id, value.node_id,
                value.value_context.value, value.period_id,
                str(value.value) if value.value is not None else None,
                value.value_status.value, value.value_origin.value, value.formula_id,
            ),
        )

    def get(
        self, dataset_cycle_id: str, node_id: str, value_context: ValueContext, period_id: int
    ) -> Optional[NodeValue]:
        row = self._conn.execute(
            """
            SELECT node_value_id, dataset_cycle_id, node_id, value_context, period_id,
                   value, value_status, value_origin, formula_id
            FROM vdt_node_value
            WHERE dataset_cycle_id = ? AND node_id = ? AND value_context = ? AND period_id = ?
            """,
            (dataset_cycle_id, node_id, value_context.value, period_id),
        ).fetchone()
        if row is None:
            return None
        return NodeValue(
            node_value_id=row["node_value_id"],
            dataset_cycle_id=row["dataset_cycle_id"],
            node_id=row["node_id"],
            value_context=ValueContext(row["value_context"]),
            period_id=row["period_id"],
            value=Decimal(row["value"]) if row["value"] is not None else None,
            value_status=ValueStatus(row["value_status"]),
            value_origin=ValueOrigin(row["value_origin"]),
            formula_id=row["formula_id"],
        )

    def list_for_cycle_context(
        self, dataset_cycle_id: str, value_context: ValueContext, period_id: int
    ) -> dict[str, NodeValue]:
        rows = self._conn.execute(
            """
            SELECT node_value_id, dataset_cycle_id, node_id, value_context, period_id,
                   value, value_status, value_origin, formula_id
            FROM vdt_node_value
            WHERE dataset_cycle_id = ? AND value_context = ? AND period_id = ?
            """,
            (dataset_cycle_id, value_context.value, period_id),
        ).fetchall()
        return {
            row["node_id"]: NodeValue(
                node_value_id=row["node_value_id"], dataset_cycle_id=row["dataset_cycle_id"],
                node_id=row["node_id"], value_context=ValueContext(row["value_context"]),
                period_id=row["period_id"],
                value=Decimal(row["value"]) if row["value"] is not None else None,
                value_status=ValueStatus(row["value_status"]),
                value_origin=ValueOrigin(row["value_origin"]), formula_id=row["formula_id"],
            )
            for row in rows
        }
