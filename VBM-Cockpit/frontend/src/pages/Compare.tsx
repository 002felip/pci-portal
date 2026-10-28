/**
 * Snapshot comparison + Top-N movement.
 *
 * Two pages merged, because they answer one question — what moved between two
 * periods — and they were both driven by the same pair of snapshot codes.
 *
 * NOTHING NAMES A QUARTER. The table headers, the chart series names and the
 * page title all come from the resolved period. Load a
 * Q3 register and this page compares Q2 with Q3 the moment the picker changes.
 *
 * The filter bar -- and its Actuals toggle -- is the one Portfolio uses, so a
 * selection made there carries over and narrows both sides here alike.
 */

import { Fragment, useMemo, useState } from "react";

import {
  fmt, useCompare, useTop,
  type CompareMetrics, type CompareRow, type TopBasis, type TopBU,
} from "../api";
import { PageHead } from "../App";
import { Bars, SlopeChart, StatusLegend } from "../charts";
import {
  ACTUALS_LABEL, Empty, FilterBar, Kpi, Loading, Panel, PrintSection, Problem, Select,
  WhenReady, actualKey, useFilters, usePeriod, type ActualsBasis, type CompareMode,
} from "../ui";

export default function ComparePage() {
  return <WhenReady><Body /></WhenReady>;
}

type Metric = { key: keyof CompareMetrics; label: string; money?: boolean };

/** The compared measures. The actuals column follows the Actuals toggle. */
const metricsFor = (actuals: ActualsBasis): Metric[] => [
  { key: "total", label: "Initiatives" },
  { key: "in_execution", label: "In execution" },
  { key: "value_musd", label: "CY target ($M)", money: true },
  { key: actualKey(actuals), label: `${ACTUALS_LABEL[actuals]} ($M)`, money: true },
];

/* Top-N ranks by target or by actuals; "actuals" reads the toggle. */
type TopChoice = "target" | "actual";
const TOP_CHOICES = [{ value: "target", label: "Target" }, { value: "actual", label: "Actuals" }];
const topBasis = (c: TopChoice, actuals: ActualsBasis): TopBasis =>
  c === "target" ? "target" : actuals === "fy" ? "actual_fy" : "actual_ytd";

const signedInt = (v: number) => `${v > 0 ? "+" : ""}${fmt.int(v)}`;
const signedMusd = (v: number) => fmt.delta(v, "M");

const MODE_LABEL: Record<CompareMode, string> = {
  sequential: "Sequential", yoy: "Year-over-year", plan: "Vs. plan", custom: "Custom",
};
const MODE_OPTIONS = (Object.keys(MODE_LABEL) as CompareMode[])
  .map((value) => ({ value, label: MODE_LABEL[value] }));

function periodKeyOf(fy: number, pt: string, ord: number | null): string {
  if (pt === "FY") return `${fy}-FY`;
  if (pt === "M") return `${fy}-M${String(ord ?? 0).padStart(2, "0")}`;
  return `${fy}-${pt}${ord ?? ""}`;
}

/** Names the period a resolved-but-empty baseline would have needed, per mode. */
function missingBaselineHint(mode: CompareMode, snapshotId: string | undefined,
                             options: ReturnType<typeof usePeriod>["options"]): string {
  const target = options?.snapshots.find((s) => s.id === snapshotId);
  if (!target) return "Pick a baseline to compare against.";
  if (mode === "yoy") {
    const key = periodKeyOf(target.fiscal_year - 1, target.period_type, target.period_ordinal);
    return `No ${key} snapshot to compare against.`;
  }
  if (mode === "sequential") {
    return `No earlier ${target.period_type} snapshot to compare against.`;
  }
  if (mode === "plan") {
    return `No plan baseline pinned for fiscal year ${target.fiscal_year}.`;
  }
  return "Pick a baseline to compare against.";
}

function Body() {
  const { snapshot, baseline, label, mode, setMode, options } = usePeriod();
  const { scope, actuals } = useFilters();
  const [limit, setLimit] = useState(10);
  const [topChoice, setTopChoice] = useState<TopChoice>("target");
  const metrics = useMemo(() => metricsFor(actuals), [actuals]);
  /* Counts and $M can't share an axis -- the movement chart splits them. */
  const countSeries = metrics.filter((m) => !m.money).map((m) => ({ key: m.label }));
  const valueSeries = metrics.filter((m) => m.money).map((m) => ({ key: m.label }));

  const compare = useCompare(baseline, snapshot, scope);
  const top = useTop(baseline, snapshot, limit, topBasis(topChoice, actuals), scope);
  const topWord = topChoice === "target" ? "target" : ACTUALS_LABEL[actuals].toLowerCase();

  // Computed before any early return: hooks may not be conditional.
  const movementData = useMemo(() =>
    (compare.data?.rows ?? []).map((r) => ({
      bu: r.bu_label,
      ...Object.fromEntries(metrics.map((m) => [m.label, r.delta[m.key]])),
    })), [compare.data, metrics]);

  const modePicker = (
    <Select label="Mode" value={mode} onChange={(v) => setMode(v as CompareMode)}
      options={MODE_OPTIONS} />
  );

  if (!baseline) {
    return (
      <>
        <PageHead title="Comparison" compare>{modePicker}</PageHead>
        <FilterBar />
        <Empty>{missingBaselineHint(mode, snapshot, options)}</Empty>
      </>
    );
  }
  if (compare.error) return <Problem error={compare.error} />;

  const a = baseline;
  const b = snapshot!;
  const t = compare.data?.totals;

  return (
    <>
      <PageHead title={`${label(a)} vs ${label(b)} · ${MODE_LABEL[mode]}`} compare
        blurb={`${label(a)} compared with ${label(b)}.`}>
        {modePicker}
      </PageHead>

      <FilterBar count={t && <>
        <b>{fmt.int(t.b.total)}</b> initiatives in {label(b)} · <b>{fmt.int(t.a.total)}</b> in {label(a)}
      </>} />

      <PrintSection id="cmp-kpis" label="Headline deltas">
        <div className="kpirow">
          {metrics.map((m) => {
            const av = t ? t.a[m.key] : null;
            const bv = t ? t.b[m.key] : null;
            const dv = t ? t.delta[m.key] : null;
            const show = (v: number | null) => (m.money ? fmt.musd(v) : fmt.int(v));
            return (
              <Kpi key={m.key} label={m.label}
                value={show(bv)}
                tone={dv == null ? undefined : dv > 0 ? "good" : dv < 0 ? "bad" : undefined}
                sub={`${label(a)}: ${show(av)} · Δ ${fmt.delta(dv)}`} />
            );
          })}
        </div>
      </PrintSection>

      <PrintSection id="cmp-table" label={`${label(a)} vs ${label(b)} by BU`}>
        <Panel title="By business unit">
          {!compare.data ? <Loading what="the comparison" /> : (
            <div className="tablewrap">
              <table className="grid compare">
                <thead>
                  <tr>
                    <th rowSpan={2}>Business unit</th>
                    {metrics.map((m) => <th key={m.key} colSpan={3}>{m.label}</th>)}
                  </tr>
                  <tr>
                    {metrics.map((m) => (
                      <Fragment key={m.key}>
                        <th className="sub">{label(a)}</th>
                        <th className="sub">{label(b)}</th>
                        <th className="sub">Δ</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {compare.data.rows.map((r) => (
                    <Row key={r.bu_code} row={r} metrics={metrics} />
                  ))}
                </tbody>
                <tfoot>
                  <Row row={compare.data.totals} metrics={metrics} />
                </tfoot>
              </table>
              {compare.data.unmatched_count > 0 && (
                <p className="muted sm">
                  {compare.data.unmatched_count} business unit(s) unmatched across
                  periods and excluded from the delta.
                </p>
              )}
            </div>
          )}
        </Panel>
      </PrintSection>

      <div className="grid2">
        <PrintSection id="cmp-bars-count" label="Count movement by BU">
          <Panel title={`Initiative count change, ${label(a)} → ${label(b)}`}>
            <Bars data={movementData} xKey="bu" series={countSeries}
              valueFormat={signedInt} signed />
          </Panel>
        </PrintSection>
        <PrintSection id="cmp-bars-value" label="Value movement by BU">
          <Panel title={`Value change ($M), ${label(a)} → ${label(b)}`}>
            <Bars data={movementData} xKey="bu" series={valueSeries}
              valueFormat={signedMusd} signed />
          </Panel>
        </PrintSection>
      </div>

      <PrintSection id="cmp-top" label={`Top-${limit} movement`}>
        <Panel title={`Top-${limit} movement by BU · ranked by ${topWord}`}
          actions={
            <>
              <Select label="Rank by" value={topChoice}
                onChange={(v) => setTopChoice(v as TopChoice)} options={TOP_CHOICES} />
              <Select label="Top N" value={String(limit)}
                onChange={(v) => setLimit(Number(v))}
                options={[5, 10, 15, 20].map((n) => ({ value: String(n), label: `Top ${n}` }))} />
            </>
          }>
          {!top.data ? <Loading what="movement" /> : (
            <>
              <div className="kpirow tight">
                <Kpi label={`${label(a)} top-${limit} ${topWord}`} value={fmt.musd(top.data.totals.a_total_musd)} />
                <Kpi label={`${label(b)} top-${limit} ${topWord}`} value={fmt.musd(top.data.totals.b_total_musd)}
                  tone={top.data.totals.delta_musd >= 0 ? "good" : "bad"}
                  sub={`Δ ${fmt.delta(top.data.totals.delta_musd, "M")}`} />
                <Kpi label="Carried" value={fmt.int(top.data.totals.carried)} />
                <Kpi label="New" value={fmt.int(top.data.totals.new)} tone="good" />
                <Kpi label="Fell out" value={fmt.int(top.data.totals.fell_out)} tone="warn" />
                <Kpi label="Discontinued" value={fmt.int(top.data.totals.discontinued)} tone="bad" />
              </div>
              <StatusLegend />
              {/* One slope panel per row: endpoint labels need the full width. */}
              <div className="slope-rows">
                {top.data.business_units.map((bu) => (
                  <BuSlope key={bu.bu_code} bu={bu} a={label(a)} b={label(b)} />
                ))}
              </div>
            </>
          )}
        </Panel>
      </PrintSection>
    </>
  );
}

function Row({ row, metrics }: { row: CompareRow; metrics: Metric[] }) {
  const cell = (v: number, m: Metric) => (m.money ? fmt.musd(v) : fmt.int(v));
  const unmatched = !(row.a_present && row.b_present);
  const status = unmatched ? (row.a_present ? "fell_out" : "new") : null;

  return (
    <tr className={row.bu_code === "TOTAL" ? "total" : undefined}>
      <th>
        {row.bu_label}
        {status && (
          <i className={`pill sm ${status === "new" ? "good" : "warn"}`}
            title="Not present on both sides">
            {status === "new" ? "new" : "unmatched"}
          </i>
        )}
      </th>
      {metrics.map((m) => (
        <Fragment key={m.key}>
          <td>{row.a_present ? cell(row.a[m.key], m) : "—"}</td>
          <td>{row.b_present ? cell(row.b[m.key], m) : "—"}</td>
          {unmatched ? <td className="muted">—</td> : (
            <td className={row.delta[m.key] > 0 ? "good"
              : row.delta[m.key] < 0 ? "bad" : "muted"}>
              {fmt.delta(row.delta[m.key])}
            </td>
          )}
        </Fragment>
      ))}
    </tr>
  );
}

function BuSlope({ bu, a, b }: { bu: TopBU; a: string; b: string }) {
  const counts: { key: string; label: string; tone: string }[] = [
    { key: "carried", label: "carried", tone: "accent" },
    { key: "new", label: "new", tone: "good" },
    { key: "fell_out", label: "fell out", tone: "warn" },
    { key: "discontinued", label: "discontinued", tone: "bad" },
  ];
  return (
    <Panel className="slope wide"
      title={<>{bu.bu_label}{" "}
        <span className="muted sm">
          {fmt.musd(bu.a_total_musd)} → {fmt.musd(bu.b_total_musd)}{" "}
          ({fmt.delta(bu.delta_musd, "M")})
        </span></>}>
      <p className="muted sm">
        {counts.filter((c) => bu.counts[c.key]).map((c, i) => (
          <Fragment key={c.key}>
            {i > 0 && " · "}
            <b className={c.tone}>{fmt.int(bu.counts[c.key])} {c.label}</b>
          </Fragment>
        ))}
      </p>
      {bu.a_items.length || bu.b_items.length
        ? (
          <div className="slopewrap">
            <SlopeChart aItems={bu.a_items} bItems={bu.b_items}
              movements={bu.movements} labelA={a} labelB={b} />
          </div>
        )
        : <Empty>No ranked initiatives.</Empty>}
      {bu.note && <p className="muted sm">{bu.note}</p>}
    </Panel>
  );
}
