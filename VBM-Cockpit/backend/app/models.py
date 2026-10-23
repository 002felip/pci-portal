"""
Physical schema -- GENERATED from registry.INITIATIVE_FIELDS.

There is no hand-written column list here. `Initiative` is assembled at import
time from the registry, which means:

    add a FieldSpec  ->  the table gains a column
    change its Kind  ->  the column type follows
    rename it        ->  one edit, one place

and `Base.metadata` stays the authority for DDL, so `create_all()` and Alembic
autogenerate both see the change with no second edit.

The three structural decisions that are NOT derived, because they are about
shape rather than fields, are stated explicitly below: narrow monthly facts,
lineage on every row, and the snapshot in the natural key.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Index, Integer,
    Numeric, String, Text, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .registry import INITIATIVE_FIELDS, FieldSpec, Kind


class Base(DeclarativeBase):
    pass


# ----------------------------------------------------- registry -> columns --
def _sa_type(spec: FieldSpec):
    """The ONE mapping from a declared Kind to a Postgres type."""
    if spec.kind is Kind.TEXT:
        return String(spec.max_length) if spec.max_length else Text
    if spec.kind is Kind.LONGTEXT:
        return Text
    if spec.kind is Kind.VOCAB:
        return String(64)
    if spec.kind is Kind.BOOL:
        return Boolean
    if spec.kind is Kind.DATE:
        return Date
    if spec.kind is Kind.INT:
        return Integer
    if spec.kind is Kind.MONEY:
        # USD units, never $M. Storing $M is how rounding errors get baked in.
        return Numeric(20, 2)
    return Numeric(20, 6)


def _initiative_columns() -> dict[str, Any]:
    cols: dict[str, Any] = {}
    for spec in INITIATIVE_FIELDS:
        # `bu_code` and `source_initiative_id` are part of the natural key, so
        # they are NOT NULL; everything else tolerates an unanswered cell,
        # because a half-filled register still has to load.
        nullable = spec.column not in {"bu_code", "source_initiative_id", "name"}
        cols[spec.column] = Column(spec.column, _sa_type(spec), nullable=nullable)
    return cols


class LoadBatch(Base):
    """Lineage. Any figure on screen traces back to the bytes that produced it."""

    __tablename__ = "load_batch"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
                                          default=uuid.uuid4)
    source_name: Mapped[str] = mapped_column(String(512))
    source_kind: Mapped[str] = mapped_column(String(32), default="excel")
    content_sha256: Mapped[str] = mapped_column(String(64))
    snapshot_id: Mapped[str] = mapped_column(
        ForeignKey("snapshot.id", ondelete="CASCADE"))
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True),
                                                          nullable=True)

    __table_args__ = (
        # The idempotency guarantee: same bytes + same snapshot = one batch.
        UniqueConstraint("content_sha256", "snapshot_id",
                         name="uq_load_batch_content_snapshot"),
    )


class VocabTerm(Base):
    __tablename__ = "vocab_term"
    domain: Mapped[str] = mapped_column(String(48), primary_key=True)
    code: Mapped[str] = mapped_column(String(64), primary_key=True)
    label: Mapped[str] = mapped_column(String(160))
    sort_order: Mapped[int] = mapped_column(Integer, default=100)
    color_hex: Mapped[str | None] = mapped_column(String(9), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class VocabAlias(Base):
    __tablename__ = "vocab_alias"
    domain: Mapped[str] = mapped_column(String(48), primary_key=True)
    alias_norm: Mapped[str] = mapped_column(String(200), primary_key=True)
    code: Mapped[str] = mapped_column(String(64))


class Snapshot(Base):
    """
    A reporting period. `Q1 vs Q2` was never a special case -- it is two rows
    of this table, which is why the comparison generalises to Q3, Q4, FY27
    without a code change.

    Identity (`id`), ordering (`sort_key`, derived from `fiscal_year` +
    `period_type` + `period_ordinal`) and display (`label`) are three
    different jobs. `period_key` is the canonical, derived-not-typed grammar
    (`YYYY-Q3` / `YYYY-M07` / `YYYY-H1` / `YYYY-FY`) that everything joins on
    except the user-facing label.
    """

    __tablename__ = "snapshot"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    period_key: Mapped[str] = mapped_column(String(16))
    label: Mapped[str] = mapped_column(String(120))
    as_of_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    fiscal_year: Mapped[int] = mapped_column(Integer)
    period_type: Mapped[str] = mapped_column(String(4))
    period_ordinal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sort_key: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(16), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    superseded_by: Mapped[str | None] = mapped_column(
        ForeignKey("snapshot.id"), nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    needs_review: Mapped[bool] = mapped_column(Boolean, default=False)
    stored_filename: Mapped[str | None] = mapped_column(String(256), nullable=True)
    original_filename: Mapped[str | None] = mapped_column(String(256), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(256), nullable=True)
    published_by: Mapped[str | None] = mapped_column(String(256), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    # The "plan" comparison mode resolves its baseline to the pinned +
    # is_baseline snapshot for the fiscal year.
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False)
    # Archive is orthogonal to `state`, not a fourth value of it: a snapshot
    # can be archived while draft, published or locked, and restoring it has
    # to put back the state it had. Archived means "hidden from every picker",
    # never "deleted" -- the row, its initiatives and its lineage all survive.
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    archived_by: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Operator commentary, editable at any time. Distinct from `reason`, which
    # is the immutable justification captured when a revision was uploaded.
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # When the workbook currently behind this period was loaded. Re-stamped by
    # every revision, because a revision replaces the contents in place -- so
    # this answers "how fresh are these numbers?", not "when did this period
    # first appear". Null for anything loaded before the column existed.
    uploaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_snapshot_period_key", "period_key"),
    )


class Initiative(Base):
    __tablename__ = "initiative"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
                                          default=uuid.uuid4)
    snapshot_id: Mapped[str] = mapped_column(
        ForeignKey("snapshot.id", ondelete="CASCADE"))

    # -------- generated from the registry; do not hand-edit ---------------
    locals().update(_initiative_columns())
    # ----------------------------------------------------------------------

    # Derived once at write time so the quarter chart is a GROUP BY, not a scan.
    planned_end_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    planned_end_quarter: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Anything the workbook carried that the registry does not model yet.
    # Nothing is silently dropped; promoting a key to a real column later is a
    # FieldSpec plus a backfill.
    extra: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    load_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("load_batch.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # Set by the Initiatives editor. The next Excel load reads it and refuses to
    # clobber a hand-edited field -- curation survives ingestion.
    edited_fields: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    metrics: Mapped[list["InitiativeMetricMonthly"]] = relationship(
        back_populates="initiative", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("snapshot_id", "bu_code", "source_initiative_id",
                         name="uq_initiative_natural_key"),
        Index("ix_initiative_snapshot_bu", "snapshot_id", "bu_code"),
        Index("ix_initiative_stage", "snapshot_id", "stage_code"),
    )


class InitiativeMetricMonthly(Base):
    """
    Narrow monthly fact: one row per (initiative, metric, scenario, month).

    The workbook is wide -- 6A/6B/6C/6D/7A/7C x 12 months x 2 years. Wide is a
    dead end because every new year is a schema change. Narrow means a new year
    is rows, which is the whole reason the year picker on the frontend can be
    populated from data instead of from a constant.
    """

    __tablename__ = "initiative_metric_monthly"

    initiative_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("initiative.id", ondelete="CASCADE"), primary_key=True)
    metric_code: Mapped[str] = mapped_column(String(48), primary_key=True)
    scenario_code: Mapped[str] = mapped_column(String(24), primary_key=True)
    period_month: Mapped[date] = mapped_column(Date, primary_key=True)

    value: Mapped[float | None] = mapped_column(Numeric(24, 6), nullable=True)
    load_batch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("load_batch.id", ondelete="SET NULL"), nullable=True)

    initiative: Mapped[Initiative] = relationship(back_populates="metrics")

    __table_args__ = (
        Index("ix_metric_lookup", "metric_code", "scenario_code", "period_month"),
        Index("ix_metric_year", "period_month"),
    )


class Override(Base):
    """User curation of headline figures that must survive the next load."""

    __tablename__ = "override"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    scope: Mapped[str] = mapped_column(String(48))
    scope_key: Mapped[str] = mapped_column(String(128))
    payload: Mapped[dict] = mapped_column(JSONB)
    updated_by: Mapped[str | None] = mapped_column(String(256), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("scope", "scope_key", name="uq_override"),)


class AppSetting(Base):
    """
    Shared UI/presentation configuration -- how the portfolio is DISPLAYED.

    Deliberately separate from `Override`, which curates the FIGURES. Mixing the
    two would mean a stage rename and a pinned headline number share a uniqueness
    constraint and an audit trail that mean different things.
    """

    __tablename__ = "app_setting"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    updated_by: Mapped[str | None] = mapped_column(String(256), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


def ddl(dialect: str = "postgresql") -> str:
    """
    Emit CREATE TABLE for the current registry.

    Replaces the hand-maintained migrations/001_init.sql, which could drift from
    models.py. `python -m backend.app.models` prints it.
    """
    from sqlalchemy.schema import CreateIndex, CreateTable
    from sqlalchemy.dialects.postgresql import dialect as pg

    d = pg()
    parts: list[str] = []
    for table in Base.metadata.sorted_tables:
        parts.append(str(CreateTable(table).compile(dialect=d)).strip() + ";")
        for idx in table.indexes:
            parts.append(str(CreateIndex(idx).compile(dialect=d)).strip() + ";")
    return "\n\n".join(parts)


if __name__ == "__main__":   # pragma: no cover
    print(ddl())
