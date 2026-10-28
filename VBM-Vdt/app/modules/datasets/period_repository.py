import sqlite3
from typing import Optional


class SqliteReportingPeriodRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def get_by_year(self, year: int) -> Optional[int]:
        row = self._conn.execute(
            "SELECT period_id FROM ref_reporting_period WHERE period_code = ?", (f"{year}-FY",)
        ).fetchone()
        return row["period_id"] if row else None

    def get_or_create_for_year(self, year: int) -> int:
        existing = self.get_by_year(year)
        if existing is not None:
            return existing
        cursor = self._conn.execute(
            "INSERT INTO ref_reporting_period "
            "(period_code, granularity, calendar_year, period_start, period_end) "
            "VALUES (?, 'YEAR', ?, ?, ?)",
            (f"{year}-FY", year, f"{year}-01-01", f"{year}-12-31"),
        )
        return cursor.lastrowid

    def list_years_for_dataset_cycle(self, dataset_cycle_id: str) -> list[int]:
        rows = self._conn.execute(
            """
            SELECT DISTINCT p.calendar_year AS year
            FROM vdt_node_value v
            JOIN ref_reporting_period p ON p.period_id = v.period_id
            WHERE v.dataset_cycle_id = ?
            ORDER BY p.calendar_year
            """,
            (dataset_cycle_id,),
        ).fetchall()
        return [row["year"] for row in rows]
