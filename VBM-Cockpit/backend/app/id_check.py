"""
Initiative ID integrity across periods.

`(bu_code, source_initiative_id)` is how every quarter is joined to the next
(Top-N movement, carried hand-edits). The workbook is authored by hand, so an
ID can silently be reused for a different initiative, or an initiative can be
re-coded under a fresh ID. Both break history without any error.

Every upload is checked against the latest earlier occurrence of each ID:

    same      normalised names equal                    -> nothing to say
    renamed   names close, or loosely close with the
              same site/owner/KPI/lever                 -> info
    conflict  anything else                             -> BLOCKING, until the
              uploader confirms it is the same initiative
    recoded   new ID whose exact name already exists in
              the BU under an ID absent from this file  -> warning

Blank IDs are filled in before the check: reuse the earlier ID of the same
name in the BU, otherwise mint `{BU}-{NNN}` above every number ever used.

Computed over plain dictionaries, like analytics.py, so both backends agree.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from typing import Any, Iterable

from .analytics import _norm_name

# Tune on real data. Name score is 0..1; attribute score is the share of
# comparable attributes that agree.
RENAME_NAME_SCORE = 0.6
LOOSE_NAME_SCORE = 0.35
LOOSE_ATTR_SCORE = 0.5
ATTRIBUTES = ("site", "program", "owner", "kpi_name", "lever_code", "lobp_lever")

Key = tuple[str, str]


@dataclass
class IdCheck:
    bu_code: str
    source_initiative_id: str
    row: int | None
    status: str                          # renamed | conflict | recoded | assigned
    name_score: float | None = None
    attr_score: float | None = None
    confirmed: bool = False
    prev_period: str | None = None
    prev_id: str | None = None           # recoded: the ID it used to carry
    prev_name: str | None = None
    prev_site: str | None = None
    prev_owner: str | None = None
    prev_kpi: str | None = None
    prev_value: float | None = None
    new_name: str | None = None
    new_site: str | None = None
    new_owner: str | None = None
    new_kpi: str | None = None
    new_value: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


# ================================================================ history ===
def initiative_history(repo, exclude_snapshot: str | None = None
                       ) -> dict[Key, dict[str, Any]]:
    """
    Latest occurrence of every (BU, ID) across all other non-archived
    snapshots: `{key: {"row": row, "period_key": ...}}`. The snapshot being
    loaded is excluded so correcting a draft never conflicts with itself.
    """
    snaps = sorted((s for s in repo.list_snapshots()
                    if s.id != exclude_snapshot and not s.archived_at),
                   key=lambda s: (s.sort_key, s.revision))
    out: dict[Key, dict[str, Any]] = {}
    for snap in snaps:                   # oldest first; later periods overwrite
        for r in repo.rows(snap.id):
            sid = r.get("source_initiative_id")
            if r.get("bu_code") and sid not in (None, ""):
                out[(r["bu_code"], str(sid))] = {"row": r, "period_key": snap.period_key}
    return out


def _number_of(bu: str, sid: str) -> int | None:
    m = re.match(rf"^{re.escape(bu)}-(\d+)", sid, re.IGNORECASE)
    return int(m.group(1)) if m else None


def next_free_ids(keys: Iterable[Key]) -> dict[str, int]:
    """Per BU, one above the highest `{BU}-NNN` number ever used."""
    top: dict[str, int] = {}
    for bu, sid in keys:
        n = _number_of(bu, sid)
        top[bu] = max(top.get(bu, 0), n or 0)
    return {bu: n + 1 for bu, n in top.items()}


def format_id(bu: str, n: int) -> str:
    return f"{bu}-{n:03d}"


# ============================================================ blank IDs ====
def assign_missing_ids(records: list, history: dict[Key, dict]) -> list[IdCheck]:
    """
    Replace the placeholder ID of every record whose sheet cell was blank.
    Mutates `records` in place; returns one `assigned` check per record.
    """
    used: set[Key] = {(r.get("bu_code"), str(r.get("source_initiative_id")))
                      for r in records if not r.id_was_blank}
    by_name: dict[tuple[str, str], str] = {}
    for (bu, sid), h in history.items():
        by_name.setdefault((bu, _norm_name(h["row"].get("name"))), sid)
    counters = next_free_ids(list(history) + list(used))

    checks: list[IdCheck] = []
    for rec in records:
        if not rec.id_was_blank:
            continue
        bu = rec.get("bu_code")
        sid = by_name.get((bu, _norm_name(rec.get("name"))))
        if sid is None or (bu, sid) in used:
            n = counters.get(bu, 1)
            while (bu, format_id(bu, n)) in used:
                n += 1
            sid, counters[bu] = format_id(bu, n), n + 1
        used.add((bu, sid))
        rec.values["source_initiative_id"] = sid
        checks.append(IdCheck(bu_code=bu, source_initiative_id=sid,
                              row=rec.row_number, status="assigned",
                              new_name=rec.get("name")))
    return checks


# =============================================================== scoring ===
def name_score(a: Any, b: Any) -> float:
    na, nb = _norm_name(a), _norm_name(b)
    if not na or not nb:
        return 0.0
    ratio = SequenceMatcher(None, na, nb).ratio()
    ta, tb = set(na.split()), set(nb.split())
    jaccard = len(ta & tb) / len(ta | tb)
    return round(max(ratio, jaccard), 3)


def attr_score(a: dict, b: dict) -> float | None:
    pairs = [(_norm_name(a.get(f)), _norm_name(b.get(f))) for f in ATTRIBUTES]
    pairs = [(x, y) for x, y in pairs if x and y]
    if not pairs:
        return None
    return round(sum(1 for x, y in pairs if x == y) / len(pairs), 3)


def _sides(prev: dict, rec) -> dict[str, Any]:
    return dict(prev_name=prev.get("name"), prev_site=prev.get("site"),
                prev_owner=prev.get("owner"), prev_kpi=prev.get("kpi_name"),
                prev_value=prev.get("value_target_cy"),
                new_name=rec.get("name"), new_site=rec.get("site"),
                new_owner=rec.get("owner"), new_kpi=rec.get("kpi_name"),
                new_value=rec.get("value_target_cy"))


# ================================================================= check ===
def check_ids(records: list, history: dict[Key, dict],
              confirmed: set[Key]) -> list[IdCheck]:
    in_file: set[Key] = {(r.get("bu_code"), str(r.get("source_initiative_id")))
                         for r in records}
    by_name: dict[tuple[str, str], list[str]] = {}
    for (bu, sid), h in history.items():
        by_name.setdefault((bu, _norm_name(h["row"].get("name"))), []).append(sid)

    checks: list[IdCheck] = []
    for rec in records:
        bu, sid = rec.get("bu_code"), str(rec.get("source_initiative_id"))
        hit = history.get((bu, sid))
        if hit is None:
            if rec.id_was_blank:
                continue
            gone = [old for old in by_name.get((bu, _norm_name(rec.get("name"))), [])
                    if (bu, old) not in in_file]
            if gone:
                prev = history[(bu, gone[0])]
                checks.append(IdCheck(
                    bu_code=bu, source_initiative_id=sid, row=rec.row_number,
                    status="recoded", prev_id=gone[0], prev_period=prev["period_key"],
                    name_score=1.0, **_sides(prev["row"], rec)))
            continue

        prev = hit["row"]
        if _norm_name(prev.get("name")) == _norm_name(rec.get("name")):
            continue
        ns, at = name_score(prev.get("name"), rec.get("name")), attr_score(prev, rec.values)
        renamed = ns >= RENAME_NAME_SCORE or (
            ns >= LOOSE_NAME_SCORE and (at or 0) >= LOOSE_ATTR_SCORE)
        checks.append(IdCheck(
            bu_code=bu, source_initiative_id=sid, row=rec.row_number,
            status="renamed" if renamed else "conflict",
            confirmed=not renamed and (bu, sid) in confirmed,
            name_score=ns, attr_score=at, prev_period=hit["period_key"],
            **_sides(prev, rec)))
    return checks


def issues_for(checks: list[IdCheck], actor: str | None) -> list[tuple[str, int | None, str]]:
    """(severity, row, message) per check that belongs in warnings/errors."""
    out = []
    for c in checks:
        ref = f"{c.bu_code} {c.source_initiative_id}"
        if c.status == "assigned":
            out.append(("warning", c.row,
                        f"Initiative ID was blank; assigned {c.source_initiative_id}. "
                        f"Add it to your workbook so future quarters match."))
        elif c.status == "recoded":
            out.append(("warning", c.row,
                        f"{ref} looks like {c.prev_id} ('{c.prev_name}', {c.prev_period}) "
                        f"under a new ID; keep {c.prev_id} to preserve its history."))
        elif c.status == "renamed":
            continue                     # informational; shown from `id_checks`
        elif c.confirmed:
            out.append(("warning", c.row,
                        f"{ref} confirmed as the same initiative as '{c.prev_name}' "
                        f"({c.prev_period}) by {actor or 'uploader'}."))
        else:
            out.append(("error", c.row,
                        f"{ref} was '{c.prev_name}' in {c.prev_period} but is now "
                        f"'{c.new_name}'. Confirm it is the same initiative, or give "
                        f"this row a new ID."))
    return out
