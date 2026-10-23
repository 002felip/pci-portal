import sqlite3
from datetime import datetime, timezone
from typing import Optional

from app.domain.enums import DatasetType
from app.domain.models import Dataset, DatasetCycle, Region, RevisionCycle


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class SqliteRegionRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def create(self, region: Region) -> None:
        now = _utcnow()
        self._conn.execute(
            """
            INSERT INTO ref_region (region_id, region_code, region_name, is_active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (region.region_id, region.region_code, region.region_name, int(region.is_active), now, now),
        )

    def get_by_code(self, region_code: str) -> Optional[Region]:
        row = self._conn.execute(
            "SELECT region_id, region_code, region_name, is_active FROM ref_region WHERE region_code = ?",
            (region_code,),
        ).fetchone()
        if row is None:
            return None
        return self._to_region(row)

    def list_all(self) -> list[Region]:
        rows = self._conn.execute(
            "SELECT region_id, region_code, region_name, is_active FROM ref_region"
        ).fetchall()
        return [self._to_region(row) for row in rows]

    @staticmethod
    def _to_region(row: sqlite3.Row) -> Region:
        return Region(
            region_id=row["region_id"],
            region_code=row["region_code"],
            region_name=row["region_name"],
            is_active=bool(row["is_active"]),
        )


class SqliteRevisionCycleRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def get_by_year(self, cycle_year: int) -> Optional[RevisionCycle]:
        row = self._conn.execute(
            """
            SELECT revision_cycle_id, cycle_year, cycle_code, is_active
            FROM ref_revision_cycle WHERE cycle_year = ?
            """,
            (cycle_year,),
        ).fetchone()
        if row is None:
            return None
        return RevisionCycle(
            revision_cycle_id=row["revision_cycle_id"],
            cycle_year=row["cycle_year"],
            cycle_code=row["cycle_code"],
            is_active=bool(row["is_active"]),
        )

    def get_or_create_by_year(self, cycle_year: int) -> RevisionCycle:
        existing = self.get_by_year(cycle_year)
        if existing is not None:
            return existing
        cycle_code = f"CY{cycle_year}"
        cursor = self._conn.execute(
            "INSERT INTO ref_revision_cycle (cycle_year, cycle_code, is_active) VALUES (?, ?, 1)",
            (cycle_year, cycle_code),
        )
        return RevisionCycle(
            revision_cycle_id=cursor.lastrowid,
            cycle_year=cycle_year,
            cycle_code=cycle_code,
            is_active=True,
        )


class SqliteDatasetRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def create(self, dataset: Dataset) -> None:
        self._conn.execute(
            """
            INSERT INTO vdt_dataset (dataset_id, dataset_type, region_id, dataset_code, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (dataset.dataset_id, dataset.dataset_type.value, dataset.region_id,
             dataset.dataset_code, _utcnow()),
        )

    def get_by_code(self, dataset_type: DatasetType, dataset_code: str) -> Optional[Dataset]:
        row = self._conn.execute(
            """
            SELECT dataset_id, dataset_type, region_id, dataset_code
            FROM vdt_dataset WHERE dataset_type = ? AND dataset_code = ?
            """,
            (dataset_type.value, dataset_code),
        ).fetchone()
        if row is None:
            return None
        return Dataset(
            dataset_id=row["dataset_id"],
            dataset_type=DatasetType(row["dataset_type"]),
            region_id=row["region_id"],
            dataset_code=row["dataset_code"],
        )


class SqliteDatasetCycleRepository:
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def publish(self, dataset_cycle: DatasetCycle) -> None:
        self._conn.execute(
            """
            INSERT INTO vdt_dataset_cycle
                (dataset_cycle_id, dataset_id, revision_cycle_id, template_version, publication_id, published_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (dataset_id, revision_cycle_id) DO UPDATE SET
                dataset_cycle_id = excluded.dataset_cycle_id,
                template_version = excluded.template_version,
                publication_id = excluded.publication_id,
                published_at = excluded.published_at
            """,
            (dataset_cycle.dataset_cycle_id, dataset_cycle.dataset_id, dataset_cycle.revision_cycle_id,
             dataset_cycle.template_version, dataset_cycle.publication_id, dataset_cycle.published_at),
        )

    def get(self, dataset_id: str, revision_cycle_id: int) -> Optional[DatasetCycle]:
        row = self._conn.execute(
            """
            SELECT dataset_cycle_id, dataset_id, revision_cycle_id, template_version, publication_id, published_at
            FROM vdt_dataset_cycle WHERE dataset_id = ? AND revision_cycle_id = ?
            """,
            (dataset_id, revision_cycle_id),
        ).fetchone()
        if row is None:
            return None
        return DatasetCycle(
            dataset_cycle_id=row["dataset_cycle_id"],
            dataset_id=row["dataset_id"],
            revision_cycle_id=row["revision_cycle_id"],
            template_version=row["template_version"],
            publication_id=row["publication_id"],
            published_at=row["published_at"],
        )

    def get_latest(self, dataset_id: str) -> Optional[DatasetCycle]:
        row = self._conn.execute(
            """
            SELECT dataset_cycle_id, dataset_id, revision_cycle_id, template_version, publication_id, published_at
            FROM vdt_dataset_cycle WHERE dataset_id = ? ORDER BY published_at DESC LIMIT 1
            """,
            (dataset_id,),
        ).fetchone()
        if row is None:
            return None
        return DatasetCycle(
            dataset_cycle_id=row["dataset_cycle_id"],
            dataset_id=row["dataset_id"],
            revision_cycle_id=row["revision_cycle_id"],
            template_version=row["template_version"],
            publication_id=row["publication_id"],
            published_at=row["published_at"],
        )
