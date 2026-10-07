"""
Periods: discovered, not configured.

WHAT THIS REPLACES
------------------
The old build hard-coded the reporting window in four places: a `DEFAULT_SNAPSHOT=Q2`
env var, `snapshot_a: str = "Q1"` defaults on three endpoints, `year: int = 2026`
on the monthly endpoint, and a literal "Q1 vs Q2" tab label in the UI. Q3 would
have been a redeploy and a code change.

Here, the only authority is the data:
  * snapshots come from the `snapshot` table (or the JSON seed's snapshot list),
  * years come from the distinct years present in the monthly facts, unioned
    with the planned-end years on the register.

`resolve()` then answers the only question the API actually needs answering:
"given what the user asked for, which two snapshots and which year am I
reporting on?" -- falling back to *latest vs the one before it*.

IDENTITY VS ORDERING VS LABEL
------------------------------
A snapshot's `id` is opaque and permanent. Its `period_key` (`2026-Q3`,
`2026-M07`, `2026-H1`, `2026-FY`) is derived, never typed, and is what
`sort_key` is computed from -- string collation is never trusted for
ordering ("Q10" sorting before "Q2" is how a wrong number reaches a board
slide). `label` is the one free-text, user-owned field; nothing sorts, joins
or keys on it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Iterable, Sequence

from .schemas import PeriodOptions, SnapshotOut

PERIOD_TYPES = ("FY", "H", "Q", "M")
_PERIOD_TYPE_RANK = {"FY": 0, "H": 1, "Q": 2, "M": 3}
_PERIOD_KEY_RE = re.compile(r"^(?P<year>\d{4})-(?P<token>Q[1-4]|M(?:0[1-9]|1[0-2])|H[1-2]|FY)$")


def parse_period_key(period_key: str) -> tuple[int, str, int | None] | None:
    """`2026-Q3` -> (2026, "Q", 3). Returns None for anything that does not
    match the canonical grammar exactly -- this parser is never used to guess,
    only to decompose a key this codebase itself produced."""
    m = _PERIOD_KEY_RE.match((period_key or "").strip())
    if not m:
        return None
    year = int(m.group("year"))
    token = m.group("token")
    if token == "FY":
        return year, "FY", None
    if token[0] == "M":
        return year, "M", int(token[1:])
    return year, token[0], int(token[1])


def build_period_key(fiscal_year: int, period_type: str, period_ordinal: int | None) -> str:
    if period_type == "FY":
        return f"{fiscal_year}-FY"
    if period_type == "M":
        return f"{fiscal_year}-M{(period_ordinal or 0):02d}"
    return f"{fiscal_year}-{period_type}{period_ordinal}"


def compute_sort_key(fiscal_year: int, period_type: str, period_ordinal: int | None) -> int:
    """Orders periods within a year by increasing granularity, then by
    ordinal, and orders years correctly across boundaries. Never derived from
    string collation."""
    return fiscal_year * 10000 + _PERIOD_TYPE_RANK[period_type] * 100 + (period_ordinal or 0)


def period_end_month(period_type: str, period_ordinal: int | None) -> int:
    """Last calendar month (1-12) a period covers: M05 -> 5, Q3 -> 9, H1 -> 6, FY -> 12."""
    n = period_ordinal or 0
    if period_type == "M":
        return min(max(n, 1), 12)
    if period_type == "Q":
        return min(max(n, 1), 4) * 3
    if period_type == "H":
        return min(max(n, 1), 2) * 6
    return 12


# ----------------------------------------------------- legacy code bridge ----
# Q2, Q2-26, Q2 2026, 2026Q2, FY27, H1-27, M09-2026, BASELINE
_LEGACY_PATTERNS = (
    re.compile(r"^(?:FY)?(?P<y>\d{4})[-_ ]?Q(?P<i>[1-4])$", re.I),
    re.compile(r"^Q(?P<i>[1-4])[-_ ]?(?:FY)?(?P<y>\d{2,4})$", re.I),
    re.compile(r"^Q(?P<i>[1-4])$", re.I),
    re.compile(r"^H(?P<i>[1-2])[-_ ]?(?:FY)?(?P<y>\d{2,4})$", re.I),
    re.compile(r"^(?:FY)?(?P<y>\d{4})$", re.I),
    re.compile(r"^M(?P<i>\d{1,2})[-_ ](?P<y>\d{4})$", re.I),
)


def normalise_legacy_code(code: str, default_year: int) -> tuple[int, str, int | None, bool]:
    """
    Best-effort normalisation of a pre-refactor bare snapshot code (`Q3`,
    `FY27`, ...) into (fiscal_year, period_type, period_ordinal, needs_review).

    Used by the one-off identity migration and, until the structured period
    builder replaces free-text upload codes, by the upload bridge. A code that
    does not parse is never dropped -- it is flagged `needs_review` with
    `period_type="FY"` for a human to confirm the fiscal year.
    """
    text = (code or "").strip()
    for pat in _LEGACY_PATTERNS:
        m = pat.match(text)
        if not m:
            continue
        groups = m.groupdict()
        raw_y = groups.get("y")
        year = default_year
        if raw_y:
            year = int(raw_y)
            if year < 100:                       # '26' -> 2026
                year += 2000
        idx = int(groups["i"]) if groups.get("i") else None
        if pat is _LEGACY_PATTERNS[5]:
            return year, "M", idx, False
        if pat is _LEGACY_PATTERNS[3]:
            return year, "H", idx, False
        if pat is _LEGACY_PATTERNS[4]:
            return year, "FY", None, False
        return year, "Q", idx, False
    return default_year, "FY", None, True


@dataclass(frozen=True)
class PeriodSelection:
    """The resolved answer. Everything downstream takes this, not raw strings.
    `snapshot`/`baseline` are `snapshot_id`s."""

    snapshot: str                # the "current" / B side
    baseline: str | None         # the "previous" / A side, None if only one exists
    year: int

    @property
    def pair(self) -> tuple[str, str]:
        return (self.baseline or self.snapshot, self.snapshot)


class PeriodResolver:
    """
    Single Responsibility: turn whatever the data and the caller offer into a
    valid PeriodSelection. Nothing else in the codebase is allowed to invent a
    default period.
    """

    def __init__(self, snapshots: Sequence[SnapshotOut], years: Iterable[int],
                 pinned_snapshot: str | None = None,
                 pinned_year: int | None = None,
                 current_user: str | None = None) -> None:
        # Kept unfiltered so `validate()`/`resolve()` can find any snapshot by
        # id; `self.snapshots`/`self.ids` below is the picker-facing subset.
        # An ARCHIVED snapshot is invisible in every picker but still resolvable
        # when asked for by id, so existing deep links keep returning 200 rather
        # than 400. A locked snapshot is in both sets -- see below.
        self._all = {s.id: s for s in snapshots}

        # Latest revision of each period_key only -- a superseded revision is
        # reachable from the snapshot detail view, never from a picker. A
        # draft is visible only to the user who created it -- unless nobody
        # is identified (`created_by` unset, e.g. no auth configured), in
        # which case it stays visible rather than vanishing for everyone.
        #
        # A LOCKED snapshot stays visible: locking freezes the figures, it does
        # not retire the period, and leadership still opens signed-off quarters
        # on the portfolio pages. Archiving is the way to withdraw a period from
        # the pickers, and it is reversible.
        visible = [s for s in snapshots
                   if s.archived_at is None and (
                       s.state != "draft" or s.created_by is None
                       or s.created_by == current_user)]
        self.snapshots = self.sort(visible)
        self.years = sorted({int(y) for y in years})
        self._pinned_snapshot = pinned_snapshot
        self._pinned_year = pinned_year

    # -------------------------------------------------------------- order --
    @staticmethod
    def sort(snapshots: Sequence[SnapshotOut]) -> list[SnapshotOut]:
        return sorted(snapshots, key=lambda s: (s.sort_key, s.id))

    @property
    def ids(self) -> list[str]:
        return [s.id for s in self.snapshots]

    # ------------------------------------------------------------ defaults --
    def latest(self) -> str | None:
        if self._pinned_snapshot and self._pinned_snapshot in self.ids:
            return self._pinned_snapshot
        # Prefer a snapshot that actually has rows; an empty period is usually a
        # half-finished load, not the number you want on the front page.
        populated = [s.id for s in self.snapshots if s.initiative_count > 0]
        return (populated or self.ids)[-1] if (populated or self.ids) else None

    def previous(self, of: str | None = None) -> str | None:
        target = of or self.latest()
        if target is None:
            return None
        if target in self.ids:
            idx = self.ids.index(target)
            return self.ids[idx - 1] if idx > 0 else None
        # `target` is addressable but not picker-visible (locked or archived).
        # A deep link to one still has to compare against *something*, so fall
        # back to its nearest visible predecessor rather than returning None
        # and letting /analytics/compare 409 with "nothing to compare it with".
        snap = self._all.get(target)
        if snap is None:
            return None
        earlier = [s for s in self.snapshots
                   if (s.sort_key, s.id) < (snap.sort_key, snap.id)]
        return earlier[-1].id if earlier else None

    def default_year(self) -> int:
        if self._pinned_year:
            return self._pinned_year
        if not self.years:
            return date.today().year
        # The current calendar year if we hold data for it, else the most recent.
        this_year = date.today().year
        return this_year if this_year in self.years else self.years[-1]

    def comparable_pairs(self) -> list[list[str]]:
        """Consecutive pairs, newest first. Drives the picker's quick-select."""
        return [[a, b] for a, b in zip(self.ids, self.ids[1:])][::-1]

    def by_year(self) -> list[dict]:
        groups: dict[int, list[SnapshotOut]] = {}
        for s in self.snapshots:
            groups.setdefault(s.fiscal_year, []).append(s)
        return [{"year": y, "snapshots": groups[y]} for y in sorted(groups, reverse=True)]

    def pinned(self) -> list[SnapshotOut]:
        return [s for s in self.snapshots if s.pinned]

    # ------------------------------------------------------------- resolve --
    def resolve(self, snapshot: str | None = None, baseline: str | None = None,
                year: int | None = None) -> PeriodSelection:
        """
        Caller-supplied values win when they exist in the data; otherwise the
        discovered default applies. An unknown id is a 400 at the router, not
        a silent substitution -- quietly reporting a different quarter than the
        one asked for is how a board pack goes out wrong.
        """
        chosen = snapshot if snapshot in self._all else self.latest()
        if chosen is None:
            raise NoPeriodsError(
                "No snapshots found. Upload a register (Snapshots tab) or run "
                "`make load` before opening the cockpit.")
        base = baseline if (baseline in self._all and baseline != chosen) \
            else self.previous(chosen)
        return PeriodSelection(snapshot=chosen, baseline=base,
                               year=year if year in self.years else self.default_year())

    def sequential_baseline(self, snapshot_id: str) -> str | None:
        target = next((s for s in self.snapshots if s.id == snapshot_id), None)
        if target is None:
            return None
        candidates = [s for s in self.snapshots
                      if s.period_type == target.period_type and s.sort_key < target.sort_key]
        return candidates[-1].id if candidates else None

    def yoy_baseline(self, snapshot_id: str) -> str | None:
        target = next((s for s in self.snapshots if s.id == snapshot_id), None)
        if target is None:
            return None
        for s in self.snapshots:
            if (s.fiscal_year == target.fiscal_year - 1
                    and s.period_type == target.period_type
                    and s.period_ordinal == target.period_ordinal):
                return s.id
        return None

    def plan_baseline(self, fiscal_year: int | None = None) -> str | None:
        candidates = [s for s in self.snapshots if s.pinned and s.is_baseline
                      and (fiscal_year is None or s.fiscal_year == fiscal_year)]
        return candidates[-1].id if candidates else None

    def validate(self, *ids: str | None) -> None:
        unknown = [c for c in ids if c and c not in self._all]
        if unknown:
            raise UnknownPeriodError(
                f"Unknown snapshot(s): {unknown}. Available: {self.ids}")

    # --------------------------------------------------------------- wire --
    def options(self) -> PeriodOptions:
        latest = self.latest()
        return PeriodOptions(
            snapshots=self.snapshots,
            years=self.years,
            default_snapshot=latest,
            default_baseline=self.previous(latest),
            default_year=self.default_year(),
            comparable_pairs=self.comparable_pairs(),
            by_year=self.by_year(),
            pinned=self.pinned(),
        )


class NoPeriodsError(RuntimeError):
    """No snapshots at all -- an empty install, not a bad request."""


class UnknownPeriodError(ValueError):
    """Caller asked for a period that does not exist."""


def mint_snapshot_id() -> str:
    import uuid
    return f"snp_{uuid.uuid4().hex}"


def enrich_snapshot(code_or_id: str, label: str | None = None,
                    *, snapshot_id: str | None = None,
                    existing: Sequence[SnapshotOut] | None = None) -> dict:
    """
    Used when a snapshot is created implicitly by an upload (the free-text
    code path, ahead of the structured period builder replacing it). Derives
    `period_key` / ordering fields from the code so chronology is right the
    first time, with no operator step. A code that does not parse the legacy
    grammar is never dropped -- it is flagged `needs_review` rather than
    guessed at.

    Identity is never the typed string, even on this legacy path: when
    `existing` is given and one of those snapshots already has the derived
    `period_key`, its `id` is reused (this upload is a revision, not a new
    period); otherwise a fresh id is minted.
    """
    year, ptype, ordinal, needs_review = normalise_legacy_code(
        code_or_id, date.today().year)
    period_key = build_period_key(year, ptype, ordinal)
    if existing is not None:
        match = next((s for s in existing if s.period_key == period_key), None)
        if match is not None:
            merged = match.model_dump()
            merged["label"] = label or merged["label"]
            return merged
    return {
        "id": snapshot_id or mint_snapshot_id(),
        "period_key": period_key,
        "label": label or code_or_id,
        "fiscal_year": year,
        "period_type": ptype,
        "period_ordinal": ordinal,
        "sort_key": compute_sort_key(year, ptype, ordinal),
        "state": "published",
        "revision": 1,
        "superseded_by": None,
        "pinned": False,
        "needs_review": needs_review,
        "stored_filename": None,
        "original_filename": None,
        "reason": None,
        "created_by": None,
        "published_by": None,
        "published_at": None,
        "is_baseline": False,
        "as_of_date": None,
        "archived_at": None,
        "archived_by": None,
        "notes": None,
        "uploaded_at": None,
    }


@dataclass(frozen=True)
class PeriodResolution:
    """What loading (fiscal_year, period_type, period_ordinal) would do --
    the period builder's pre-submit state (spec step 3, §3.5)."""

    mode: str                    # "new" | "revision" | "draft_exists"
    existing: SnapshotOut | None
    identity: dict                # ready to persist


def resolve_period(existing: Sequence[SnapshotOut], fiscal_year: int,
                   period_type: str, period_ordinal: int | None,
                   label: str | None = None) -> PeriodResolution:
    """
    The structured period builder's identity resolution: given the dropdown
    selections, derives `period_key` and decides whether this is a brand-new
    period, a revision of an already-published/locked one (requires a
    `reason`), or a reload of an existing draft -- never from a typed string.
    """
    period_key = build_period_key(fiscal_year, period_type, period_ordinal)
    sort_key = compute_sort_key(fiscal_year, period_type, period_ordinal)
    match = next((s for s in existing if s.period_key == period_key), None)

    if match is None:
        identity = {
            "id": mint_snapshot_id(), "period_key": period_key,
            "label": label or period_key, "as_of_date": None,
            "fiscal_year": fiscal_year, "period_type": period_type,
            "period_ordinal": period_ordinal, "sort_key": sort_key,
            "state": "draft", "revision": 1, "superseded_by": None,
            "pinned": False, "needs_review": False, "stored_filename": None,
            "original_filename": None, "reason": None, "created_by": None,
            "published_by": None, "published_at": None, "is_baseline": False,
            "archived_at": None, "archived_by": None, "notes": None,
            "uploaded_at": None,
        }
        return PeriodResolution("new", None, identity)

    # Re-loading a period un-archives it. Both branches below reuse `match.id`,
    # so without clearing the stamp an archived period would reload into a
    # draft that is still archived -- invisible in every picker, with no
    # obvious way for the operator to work out why. `notes` is deliberately
    # left alone: operator commentary survives a reload.
    identity = match.model_dump()
    identity.update(archived_at=None, archived_by=None)
    if match.state == "draft":
        identity["label"] = label or identity["label"]
        return PeriodResolution("draft_exists", match, identity)

    identity.update(revision=match.revision + 1, state="draft",
                    superseded_by=None, label=label or identity["label"])
    return PeriodResolution("revision", match, identity)


def years_from_metrics(rows: Iterable[dict]) -> set[int]:
    """Distinct years present in narrow monthly facts + planned end dates."""
    found: set[int] = set()
    for r in rows:
        if r.get("planned_end_year"):
            found.add(int(r["planned_end_year"]))
        for m in r.get("metrics") or []:
            pm = m.get("period_month")
            if isinstance(pm, str):
                pm = date.fromisoformat(pm[:10])
            if pm:
                found.add(pm.year)
    return found
