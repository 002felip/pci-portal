"""
Endpoint smoke test  —  DEV UTILITY.

Runs the whole API in-process against the JSON backend and asserts the things
that actually broke in v1 or that the rebuild changed:

  * every endpoint answers 200,
  * periods are DISCOVERED (not configured) and ordered correctly,
  * an unknown snapshot is a 400, never a silent substitution,
  * the full CRUD round-trip works, including registry coercion,
  * creating an initiative under a NEW snapshot code brings that period into
    existence and makes it comparable  -- the new-quarter path end to end,
  * a registry addition propagates to the DB column, the UI contract, the
    Pydantic models and completeness scoring.

    python backend/smoke_test.py
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("DATA_BACKEND", "json")

DATA = ROOT / "backend" / "data"
SANDBOX = ROOT / "backend" / "_smoke_data"

ok = 0
fail = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global ok, fail
    if condition:
        ok += 1
        print(f"  PASS  {label}{('  ' + detail) if detail else ''}")
    else:
        fail += 1
        print(f"  FAIL  {label}{('  ' + detail) if detail else ''}")


def main() -> int:
    if not (DATA / "initiatives.json").exists():
        print("No seed found. Run `python backend/seed_demo.py` first "
              "(or `make demo-seed`).")
        return 2

    # Work on a copy: the CRUD tests write, and the seed should survive.
    if SANDBOX.exists():
        shutil.rmtree(SANDBOX)
    shutil.copytree(DATA, SANDBOX)
    os.environ["SEED_DIR"] = str(SANDBOX)

    from fastapi.testclient import TestClient

    from backend.app.main import app

    c = TestClient(app)

    print("\n1. Every endpoint answers")
    for url in ["/api/health", "/api/meta", "/api/meta/periods", "/api/meta/fields",
                "/api/initiatives?limit=5", "/api/analytics/compare",
                "/api/analytics/top?limit=10", "/api/analytics/monthly",
                "/api/analytics/quarters?stack_by=stage_code",
                "/api/analytics/stage-matrix",
                "/api/analytics/tree?levels=bu_code&levels=lever_code",
                "/api/analytics/completeness"]:
        r = c.get(url)
        check(url, r.status_code == 200, f"-> {r.status_code}")

    print("\n2. Periods are discovered, not configured")
    p = c.get("/api/meta/periods").json()
    codes = [s["id"] for s in p["snapshots"]]
    check("snapshots found", len(codes) >= 1, str(codes))
    check("years found", len(p["years"]) >= 1, str(p["years"]))
    check("default is latest vs previous",
          p["default_snapshot"] == codes[-1],
          f'{p["default_baseline"]} -> {p["default_snapshot"]}')
    check("ordering is chronological, not lexical",
          codes == sorted(codes, key=lambda x: p and
                          [s["sort_key"] for s in p["snapshots"] if s["id"] == x][0]),
          str(codes))

    print("\n3. An unknown period is rejected, never substituted")
    check("unknown snapshot -> 400",
          c.get("/api/analytics/compare?snapshot=Q99").status_code == 400)

    print("\n4. Monthly window follows the snapshot (year + cutoff)")
    for s in p["snapshots"]:
        r = c.get(f"/api/analytics/monthly?snapshot={s['id']}")
        j = r.json() if r.status_code == 200 else {}
        end = {"M": s["period_ordinal"], "Q": 3 * (s["period_ordinal"] or 0),
               "H": 6 * (s["period_ordinal"] or 0), "FY": 12}[s["period_type"]]
        tgt = j.get("financial_target_cum_musd", [])
        check(f"monthly {s['period_key']}",
              r.status_code == 200 and j["year"] == s["fiscal_year"]
              and j["cutoff_index"] == end - 1
              and all(a <= b + 1e-6 for a, b in zip(tgt, tgt[1:])))

    print("\n5. CRUD round-trip with registry coercion")
    snap = p["default_snapshot"]
    payload = {
        "snapshot_id": snap, "name": "Smoke-test kiln retrofit", "bu_code": "SSG",
        "source_initiative_id": "SMOKE-001", "site": "Plant 2",
        "stage_code": "IMPLEMENTING", "track_code": "ON", "aligned_lobp": True,
        "lobp_lever": "Cost", "lever_code": "COST", "opex_capex_code": "OPEX",
        "owner": "A. Souza", "sponsor": "B. Lima", "kpi_name": "Unit cost",
        "kpi_uom": "USD/t", "kpi_baseline": 100, "kpi_target_cy": 90,
        "actions_total": 10, "actions_done": 3, "value_target_cy": 4_200_000,
        "value_realized_cy": 0, "confidence_code": "HIGH",
        "planned_end": "2026-11-30",
    }
    r = c.post("/api/initiatives", json=payload)
    check("create -> 201", r.status_code == 201, str(r.status_code))
    row = r.json()
    check("planned_end derived to year/quarter",
          row.get("planned_end_year") == 2026 and row.get("planned_end_quarter") == 4,
          f'{row.get("planned_end_year")} Q{row.get("planned_end_quarter")}')

    iid = row["id"]
    r = c.patch(f"/api/initiatives/{iid}",
                json={"value_target_cy": 5_500_000, "track_code": "at risk"})
    check("patch -> 200", r.status_code == 200)
    check("vocab coerced ('at risk' -> AT_RISK)",
          r.json().get("track_code") == "AT_RISK", str(r.json().get("track_code")))
    check("edited_fields recorded (survives next Excel load)",
          bool(r.json().get("edited_fields", {}).get("value_target_cy")))

    found = c.get(f"/api/initiatives?snapshot={snap}&search=Smoke-test").json()
    check("appears in filtered list", found["total"] == 1, f'total={found["total"]}')

    check("delete -> 200", c.delete(f"/api/initiatives/{iid}").status_code == 200)

    print("\n6. A brand-new quarter comes into existence from data alone")
    new_id = "snp_smoke_q9"
    r = c.post("/api/initiatives", json={**payload, "snapshot_id": new_id,
                                        "source_initiative_id": "SMOKE-NEW"})
    check(f"create under {new_id} -> 201", r.status_code == 201, str(r.status_code))
    p2 = c.get("/api/meta/periods").json()
    check(f"{new_id} now in the picker",
          new_id in [s["id"] for s in p2["snapshots"]],
          str([s["id"] for s in p2["snapshots"]]))
    check("becomes comparable with no config change",
          c.get(f"/api/analytics/compare?snapshot={new_id}&baseline={snap}"
                ).status_code == 200)
    c.delete(f"/api/initiatives/{r.json()['id']}")

    print("\n7. A snapshot can be withdrawn and brought back")
    all_snaps = c.get("/api/snapshots").json()
    check("GET /snapshots lists every snapshot",
          len(all_snaps) >= len(p["snapshots"]),
          f'{len(all_snaps)} total / {len(p["snapshots"])} picker-visible')

    # The plan baseline is the one thing archiving refuses to touch: the
    # "plan" comparison mode would silently lose its anchor.
    c.post(f"/api/snapshots/{snap}/plan-baseline")
    r = c.post(f"/api/snapshots/{snap}/archive")
    check("archiving the plan baseline -> 409", r.status_code == 409, str(r.status_code))
    c.delete(f"/api/snapshots/{snap}/plan-baseline")

    r = c.post(f"/api/snapshots/{snap}/archive")
    check("archive -> 200", r.status_code == 200, str(r.status_code))
    check("archived_at stamped", bool(r.json().get("archived_at")))
    check("re-archiving -> 409",
          c.post(f"/api/snapshots/{snap}/archive").status_code == 409)

    p3 = c.get("/api/meta/periods").json()
    check("archived snapshot leaves every picker",
          snap not in [s["id"] for s in p3["snapshots"]])
    check("archived snapshot stays in the administrative list",
          snap in [s["id"] for s in c.get("/api/snapshots").json()])
    # Archived follows locked semantics: hidden from pickers, still resolvable
    # by id, so an existing deep link keeps working.
    check("archived snapshot is still addressable by id",
          c.get(f"/api/analytics/compare?snapshot={snap}").status_code == 200)
    check("editing an archived snapshot -> 409",
          c.patch(f"/api/snapshots/{snap}", json={"label": "nope"}).status_code == 409)

    r = c.delete(f"/api/snapshots/{snap}/archive")
    check("restore -> 200", r.status_code == 200, str(r.status_code))
    check("archived_at cleared", r.json().get("archived_at") is None)
    check("restored snapshot is back in the picker",
          snap in [s["id"] for s in c.get("/api/meta/periods").json()["snapshots"]])
    check("restoring a live snapshot -> 409",
          c.delete(f"/api/snapshots/{snap}/archive").status_code == 409)

    print("\n8. Snapshot metadata is editable, identity is not")
    before = next(s for s in c.get("/api/snapshots").json() if s["id"] == snap)
    r = c.patch(f"/api/snapshots/{snap}",
                json={"label": "Smoke label", "notes": "Loaded from the smoke test."})
    check("patch label + notes -> 200", r.status_code == 200, str(r.status_code))
    check("label round-trips", r.json()["label"] == "Smoke label", r.json()["label"])
    check("notes round-trips", r.json()["notes"] == "Loaded from the smoke test.")
    check("identity untouched by a metadata edit",
          r.json()["period_key"] == before["period_key"]
          and r.json()["sort_key"] == before["sort_key"]
          and r.json()["revision"] == before["revision"])
    check("a blank label -> 400",
          c.patch(f"/api/snapshots/{snap}", json={"label": "   "}).status_code == 400)
    # An unknown key is dropped by the whitelist rather than written through.
    c.patch(f"/api/snapshots/{snap}", json={"sort_key": 1, "state": "locked"})
    check("derived fields are not patchable",
          c.get("/api/snapshots").json()
          and next(s for s in c.get("/api/snapshots").json()
                   if s["id"] == snap)["sort_key"] == before["sort_key"])

    c.post(f"/api/snapshots/{snap}/plan-baseline")
    check("unpinning the plan baseline -> 409",
          c.patch(f"/api/snapshots/{snap}", json={"pinned": False}).status_code == 409)
    c.delete(f"/api/snapshots/{snap}/plan-baseline")
    c.patch(f"/api/snapshots/{snap}",
            json={"label": before["label"], "notes": None,
                  "pinned": before["pinned"]})

    # The end-to-end upload stamp has no automated cover -- there is no
    # fixture workbook in the repo -- so assert the plumbing either side of it:
    # the field is served, defaults to null, and survives a write/read cycle.
    every = c.get("/api/snapshots").json()
    check("uploaded_at is exposed on every snapshot",
          all("uploaded_at" in s_ for s_ in every))
    from backend.app.repositories import get_repository
    for _repo in get_repository():
        _snap = next(s_ for s_ in _repo.list_snapshots() if s_.id == snap)
        _repo.upsert_snapshot({**_snap.model_dump(),
                               "uploaded_at": "2026-05-04T10:00:00+00:00"})
        break
    check("uploaded_at round-trips through the store",
          next(s_ for s_ in c.get("/api/snapshots").json()
               if s_["id"] == snap)["uploaded_at"] == "2026-05-04T10:00:00+00:00")
    # And that the upload path actually assembles it, without a workbook.
    from backend.app.periods import resolve_period
    _new = resolve_period([], 2030, "Q", 1).identity
    check("a freshly resolved period carries the key",
          "uploaded_at" in _new and _new["uploaded_at"] is None)

    print("\n9. The registry is the single source of truth")
    from backend.app.models import Initiative
    from backend.app.registry import INITIATIVE_FIELDS
    from backend.app.schemas import InitiativePatch

    cols = {col.name for col in Initiative.__table__.columns}
    reg_cols = {f.column for f in INITIATIVE_FIELDS}
    check("every registry field is a DB column", reg_cols <= cols,
          f"{len(reg_cols)} fields / {len(cols)} columns")
    check("every editable field is patchable",
          {f.column for f in INITIATIVE_FIELDS if f.editable}
          <= set(InitiativePatch.model_fields))
    fields = c.get("/api/meta/fields").json()
    check("UI contract matches the registry",
          {f["column"] for f in fields["fields"]} == reg_cols)
    comp = c.get("/api/analytics/completeness").json()
    check("completeness scores registry fields",
          comp["fields_scored"] == len([f for f in INITIATIVE_FIELDS if f.required]) + 2,
          f'scored={comp["fields_scored"]}')

    shutil.rmtree(SANDBOX, ignore_errors=True)

    print(f"\n{'=' * 52}\n  {ok} passed, {fail} failed\n{'=' * 52}")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
