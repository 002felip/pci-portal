"""
Synthetic seed generator  —  DEV UTILITY, not part of the application.

WHY THIS EXISTS
---------------
Your real seed (`backend/data/initiatives.json`, rebuilt from the register) is
not in this package: it is your data, and it was lost when the sandbox that
produced the rebuild was reset. Rather than ship an app that cannot start, this
generates a structurally identical synthetic register so you can:

  * run `make dev-api && make dev-web` immediately,
  * see every chart populated,
  * exercise the period picker across THREE snapshots and TWO years, which is
    the point of change #2 and cannot be demonstrated with one quarter.

Replace it the moment you have the real thing:

    make load EXCEL=./resources/VBM_BU_Register_Master.xlsm SNAPSHOT=Q2

The shape it writes is exactly what `etl.records_to_json` produces, which is
exactly what `JsonRepository` reads — so nothing here is a special case.
"""

from __future__ import annotations

import json
import random
from datetime import date
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.app.periods import build_period_key, compute_sort_key  # noqa: E402
from backend.app.registry import VOCAB                    # noqa: E402

random.seed(20260911)          # deterministic: same seed, same numbers

OUT = Path(__file__).resolve().parent / "data"
SNAPSHOTS = ["Q1", "Q2", "Q3"]
YEARS = [2026, 2027]
FISCAL_YEAR = 2026

# Deterministic ids (not minted per-run) so the synthetic seed is reproducible.
SNAPSHOT_IDS = {"Q1": "snp_demo_q1", "Q2": "snp_demo_q2", "Q3": "snp_demo_q3"}
SNAPSHOT_ORDINALS = {"Q1": 1, "Q2": 2, "Q3": 3}


def demo_snapshot(code: str) -> dict:
    ordinal = SNAPSHOT_ORDINALS[code]
    return {
        "id": SNAPSHOT_IDS[code],
        "period_key": build_period_key(FISCAL_YEAR, "Q", ordinal),
        "label": f"{code} {FISCAL_YEAR}",
        "as_of_date": None,
        "fiscal_year": FISCAL_YEAR,
        "period_type": "Q",
        "period_ordinal": ordinal,
        "sort_key": compute_sort_key(FISCAL_YEAR, "Q", ordinal),
        "state": "published",
        "revision": 1,
        "superseded_by": None,
        "pinned": code == "Q1",
        "needs_review": False,
        "stored_filename": None,
        "original_filename": None,
        "reason": None,
        "created_by": None,
        "published_by": None,
        "published_at": None,
        "is_baseline": code == "Q1",
    }

BUS = [c for c, _l, _o, _c in VOCAB["bu"].terms]
STAGES = [c for c, _l, _o, _c in VOCAB["stage"].terms if c not in {"CANCELLED"}]
TRACKS = ["ON", "ON", "ON", "AT_RISK", "OFF", "UNKNOWN"]
LEVERS = [c for c, _l, _o, _c in VOCAB["lever"].terms]
CONF = ["HIGH", "HIGH", "MEDIUM", "LOW", "NOT_SET"]
OPEX = ["OPEX", "CAPEX", "MIXED"]

THEMES = [
    "Contracted Cost Reduction", "Mill Throughput Uplift", "Reagent Optimisation",
    "Concentrate Moisture Control", "Maintenance Strategy Redesign",
    "Energy Intensity Reduction", "Tailings Rehandling", "Fleet Utilisation",
    "Crusher Availability", "Working Capital Release", "Spares Rationalisation",
    "Recovery Improvement", "Blasting Fragmentation", "Contractor Productivity",
    "Logistics Debottlenecking", "Water Recirculation", "Furnace Uptime",
    "Grade Control Accuracy", "Shutdown Duration Reduction", "Digital Twin Rollout",
]
SITES = ["Plant 1", "Plant 2", "Mine North", "Mine South", "Port", "Concentrator"]
PROGRAMS = ["Operational Excellence", "Asset Reliability", "Cost Transformation",
            "Sustainability", None]
OWNERS = ["A. Souza", "B. Lima", "C. Ferreira", "D. Okafor", "E. Tremblay",
          "F. Nakamura", "G. Silva", "H. Mensah"]
KPIS = [("Unit cost", "USD/t"), ("Throughput", "t/h"), ("Recovery", "%"),
        ("Availability", "%"), ("Energy intensity", "kWh/t"), ("Inventory", "USD")]


def monthly_points(annual: float, year: int, kpi_target: float,
                   kpi_baseline: float, cutoff_month: int) -> list[dict]:
    """
    Narrow monthly facts. Financial values are year-to-date; target is phased with a back-loaded curve
    (value lands late, as it does in reality); actuals stop at `cutoff_month`,
    which is what drives the dashed forecast tail on the Portfolio chart.
    """
    points: list[dict] = []
    weights = [0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.11, 0.12, 0.12, 0.13]
    total_w = sum(weights)

    cum_target = cum_actual = 0.0
    for m in range(1, 13):
        period = date(year, m, 1).isoformat()
        target = annual * weights[m - 1] / total_w
        cum_target += target
        points.append({"metric_code": "FINANCIAL_VALUE", "scenario_code": "TARGET",
                       "period_month": period, "value": round(cum_target, 2)})
        if m <= cutoff_month:
            cum_actual += target * random.uniform(0.80, 1.20)
            points.append({"metric_code": "FINANCIAL_VALUE", "scenario_code": "ACTUAL",
                           "period_month": period, "value": round(cum_actual, 2)})

        # KPI ramps linearly from baseline to target across the year.
        kpi_t = kpi_baseline + (kpi_target - kpi_baseline) * (m / 12)
        points.append({"metric_code": "KPI", "scenario_code": "TARGET",
                       "period_month": period, "value": round(kpi_t, 3)})
        if m <= cutoff_month:
            points.append({"metric_code": "KPI", "scenario_code": "ACTUAL",
                           "period_month": period,
                           "value": round(kpi_t * random.uniform(0.92, 1.08), 3)})
    return points


def build() -> dict:
    initiatives: list[dict] = []

    # Each snapshot carries a few more initiatives than the last, and values
    # drift, so the comparison and Top-N movement pages have something to show.
    counts = {"Q1": 45, "Q2": 111, "Q3": 118}
    cutoff = {"Q1": 3, "Q2": 6, "Q3": 9, "Q4": 12}

    for snap in SNAPSHOTS:
        for i in range(counts[snap]):
            bu = BUS[i % len(BUS)]
            theme = THEMES[i % len(THEMES)]
            suffix = f" — {SITES[i % len(SITES)]}" if i >= len(THEMES) else ""
            lever = random.choice(LEVERS)
            stage = random.choice(STAGES)
            kpi_name, kpi_uom = KPIS[i % len(KPIS)]

            annual = round(random.uniform(0.2, 12.0) * 1_000_000, 2)
            baseline = round(random.uniform(50, 500), 2)
            # Cost / working-capital levers improve DOWNWARD -- this is what the
            # direction-aware attainment logic in analytics.py is testing.
            target = (baseline * random.uniform(0.80, 0.95)
                      if lever in {"COST", "WORKING_CAPITAL"}
                      else baseline * random.uniform(1.05, 1.25))

            end_year = random.choice(YEARS)
            end_q = random.randint(1, 4)
            end = date(end_year, end_q * 3, 28)

            # A deliberate slice of missing data so the Data-quality page is not
            # uniformly green. Real registers are never complete.
            gap = random.random()
            total_actions = random.randint(4, 20)

            snapshot_id = SNAPSHOT_IDS[snap]
            row = {
                "id": f"{snapshot_id}:{bu}:{bu}-{snap}-{i:03d}",
                "snapshot_id": snapshot_id,
                "source_initiative_id": f"{bu}-{snap}-{i:03d}",
                "name": f"{theme}{suffix}",
                "bu_code": bu,
                "site": SITES[i % len(SITES)] if gap > 0.12 else None,
                "program": PROGRAMS[i % len(PROGRAMS)],
                "stage_code": stage,
                "track_code": random.choice(TRACKS),
                "aligned_lobp": random.random() > 0.25,
                "lobp_lever": random.choice(
                    ["Cost", "Volume", "Capital", "Sustainability"]) if gap > 0.10 else None,
                "lever_code": lever,
                "opex_capex_code": random.choice(OPEX) if gap > 0.15 else None,
                "bottleneck_uplift": random.random() > 0.55,
                "owner": random.choice(OWNERS) if gap > 0.08 else None,
                "sponsor": random.choice(OWNERS) if gap > 0.20 else None,
                "kpi_name": kpi_name,
                "kpi_uom": kpi_uom,
                # Left sparse on purpose: mirrors the v1 known limitation where
                # the dashboard extract carried no KPI baseline.
                "kpi_baseline": baseline if gap > 0.35 else None,
                "kpi_target_cy": round(target, 2),
                "actions_total": total_actions,
                "actions_done": random.randint(0, total_actions),
                "value_target_cy": annual,
                "value_realized_cy": round(annual * random.uniform(0, 0.9), 2),
                "value_target_ny": round(annual * random.uniform(0.5, 1.6), 2)
                if random.random() > 0.4 else None,
                "investment_cy": round(annual * random.uniform(0.05, 0.4), 2)
                if random.random() > 0.5 else None,
                "confidence_code": random.choice(CONF),
                "planned_start": date(2026, random.randint(1, 6), 1).isoformat(),
                "planned_end": end.isoformat(),
                "planned_end_year": end_year,
                "planned_end_quarter": end_q,
                "notes": None,
                "extra": {"source": "synthetic_demo_seed"},
                "load_batch_id": f"demo-{snap}",
                "metrics": monthly_points(annual, 2026, target, baseline, cutoff[snap]),
            }
            initiatives.append(row)

    return {
        "generated_at": date.today().isoformat(),
        "source_file": "synthetic (backend/seed_demo.py)",
        "source_sha256": "n/a",
        "snapshots": [demo_snapshot(c) for c in SNAPSHOTS],
        "initiatives": initiatives,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    data = build()
    (OUT / "initiatives.json").write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8")

    # No overrides are seeded: the Compare table is computed from the rows.
    overrides: dict = {}
    (OUT / "overrides.json").write_text(
        json.dumps(overrides, indent=2, ensure_ascii=False), encoding="utf-8")

    by_snap: dict[str, int] = {}
    for r in data["initiatives"]:
        by_snap[r["snapshot_id"]] = by_snap.get(r["snapshot_id"], 0) + 1
    total = sum(r["value_target_cy"] for r in data["initiatives"]
                if r["snapshot_id"] == SNAPSHOT_IDS["Q2"]) / 1e6

    print(f"Wrote {OUT/'initiatives.json'}")
    print(f"  snapshots      : {by_snap}")
    print(f"  Q2 value target: ${total:,.1f}M")
    print(f"  metric points  : {sum(len(r['metrics']) for r in data['initiatives']):,}")
    print("\nThis is SYNTHETIC data. Replace it with:")
    print('  make load EXCEL="./resources/VBM_BU_Register_Master.xlsm" SNAPSHOT=Q2')


if __name__ == "__main__":
    main()
