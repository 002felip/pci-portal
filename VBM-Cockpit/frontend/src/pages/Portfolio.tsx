/**
 * Portfolio — the headline view for the selected snapshot and year.
 *
 * Every visual here is a Recharts component fed by an existing analytics
 * endpoint. The page went from ~806 lines to this because axes, scales,
 * tooltips, legends, responsive sizing and the squarified treemap layout are no
 * longer ours to maintain.
 *
 * Page structure mirrors the cockpit: each block is a `Section` — a collapsible
 * card carrying a title, a sub-headline explaining how to read it, optional
 * toolbar actions, and a `Stats` strip of aggregates sitting directly above the
 * visual. Related small charts share one backing panel rather than floating as
 * separate cards.
 *
 * The dimension pickers (`stack by`, `split by`, `drill path`) are populated
 * from the registry's `groupable` list. Multi-level pickers keep an ordered
 * array of dimensions: every entry but the last forms the composite x-axis
 * group, and the last one becomes the stacked series.
 */

import { Fragment, useMemo, useState, type ReactNode } from "react";

import {
  fmt, useCompleteness, useInitiatives, useMeta, useMonthly, useQuarters,
  useStageMatrix, useTree, type Initiative, type MonthlySeries, type Registry,
  type StageMatrixOut,
} from "../api";
import { PageHead } from "../App";
import {
  AttainmentLine, Bars, CumulativeLines, Donut, FunnelBars,
  DEFAULT_ORDER, StatusTreemap, chartColour, type Stage, type TreemapMeasure,
} from "../charts";
import { useFunnelConfig } from "../funnelConfig";
import {
  ACTUALS_LABEL, Empty, FilterBar, Kpi, Loading, Panel, PrintSection, Section, Select,
  WhenReady, actualField, actualKey, display, useFilters, usePeriod, type ActualsBasis,
} from "../ui";

const TOTAL = "__total__";        // sentinel series when nothing is stacked

/** Treemap measure toggle: label, and the blurb that explains the encoding. */
const TM_MEASURES: [TreemapMeasure, string, string][] = [
  ["count", "Initiatives", "Tile size = number of initiatives; colour and inner bar = share on track."],
  ["target", "Target $", "Tile size = current-year value target; colour and inner bar = actuals as a share of that target."],
  ["actual", "Actuals $", "Tile size = current-year actuals (YTD, or with forecast per the Actuals toggle); colour and inner bar = actuals as a share of target."],
];
/** Data key holding the actuals that pair with target series `k`. */
const companionKey = (k: string) => `__actual\u0000${k}`;

/** Current-year actuals on the selected basis, in $M -- the target's unit. */
const actualOf = (basis: ActualsBasis) => (r: Initiative) =>
  Number(r[actualField(basis)] ?? 0) / 1e6;
const SEP = " \u25B8 ";           // "▸" joins composite x-axis labels

type PhasingMode = "financial" | "kpi" | "milestones";
/** Section note + how-it's-calculated blurb for each monthly phasing measure. */
const PHASING_TEXT: Record<PhasingMode, { note: string; blurb: string }> = {
  financial: {
    note: "cumulative target vs realized",
    blurb: "Cumulative year-to-date value across the filtered initiatives. Target sums each initiative's monthly value target; Realized sums its monthly actuals. Past the snapshot's period end the line turns dashed (forecast). \u201C% of full-year target\u201D = realized to date \u00F7 full-year target.",
  },
  kpi: {
    note: "KPI attainment",
    blurb: "Share of initiatives meeting their KPI target each month. An initiative counts in a month only when it has both a KPI target and an actual. It meets target when actual \u2265 target— or actual \u2264 target for cost and working-capital levers, where lower is better (0.1% tolerance). Attainment = initiatives meeting target \u00F7 initiatives with readings (the Sample). The dashed line marks 80%.",
  },
  milestones: {
    note: "cumulative planned vs completed",
    blurb: "Cumulative count of actions/milestones across the filtered initiatives. Planned sums each initiative's monthly milestone targets; Completed sums its actuals, which become forecast past the period end. \u201COn plan\u201D = completed \u00F7 planned to date.",
  },
};

export default function PortfolioPage() {
  return <WhenReady><Body /></WhenReady>;
}

function Body() {
  const { snapshot } = usePeriod();
  const { data: meta } = useMeta();
  const registry = meta?.registry;

  const [stackBy, setStackBy] = useState("stage_code");
  const [drill, setDrill] = useState<string[]>(["bu_code", "stage_code"]);
  const [tmMeasure, setTmMeasure] = useState<TreemapMeasure>("count");
  const [vmxMeasure, setVmxMeasure] = useState<VmxMeasure>("count");
  const [mode, setMode] = useState<PhasingMode>("financial");

  /* The filter bar is shared with the Comparison tab, Actuals toggle included. */
  const { filters, search, scope, actuals, reset: resetFilters } = useFilters();
  const actualsLabel = ACTUALS_LABEL[actuals];

  const initiatives = useInitiatives({ snapshot, limit: 5000 });
  const monthly = useMonthly(snapshot, scope);
  const quarters = useQuarters(snapshot, stackBy, scope);
  const pipeline = useStageMatrix(snapshot, scope);
  const matrix = useStageMatrix(snapshot);       // BU × lever ignores the filters
  const tree = useTree(snapshot, drill, scope);
  const gaps = useCompleteness(snapshot, "required", scope);

  const funnelStages: Stage[] = useMemo(() => pipeline.data
    ? Object.entries(pipeline.data.funnel)
      .map(([code, v]) => ({
        code, count: v.count, value_musd: v.value_musd, actual_musd: v[actualKey(actuals)],
      }))
    : [], [pipeline.data, actuals]);
  const funnel = useFunnelConfig(funnelStages);

  const allRows = initiatives.data?.items ?? [];

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r: Initiative) => {
      for (const [column, wanted] of Object.entries(filters)) {
        if (wanted && String(r[column] ?? "") !== wanted) return false;
      }
      if (q) {
        const hay = ["source_initiative_id", "name", "owner", "kpi_name", "site"]
          .map((k) => String(r[k] ?? "")).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, filters, search]);

  /** The filter bar excludes everything: each visual says so instead of
   *  rendering empty axes. */
  const noMatch = rows.length === 0 && allRows.length > 0;
  const none = (what: string) => <NoMatch what={what} onReset={resetFilters} />;

  const dimOptions = (registry?.groupable ?? []).map((c) => ({
    value: c,
    label: registry?.fields.find((f) => f.column === c)?.label ?? c,
  }));

  const labelOf = (c: string) =>
    dimOptions.find((o) => o.value === c)?.label ?? c;

  /* ------------------------------------------------- headline aggregates */
  const kpis = useMemo(() => {
    const inExec = new Set(registry?.stage_semantics.in_execution ?? []);
    const realized = new Set(registry?.stage_semantics.realized ?? []);
    const onTrack = registry?.stage_semantics.on_track ?? "ON";
    const musd = (r: Initiative) => Number(r.value_target_cy ?? 0) / 1e6;
    const sum = (f: (r: Initiative) => number) => rows.reduce((s, r) => s + f(r), 0);
    return {
      count: rows.length,
      value: sum(musd),
      actualYtd: sum(actualOf("ytd")),
      actualFy: sum(actualOf("fy")),
      inExecution: rows.filter((r) => inExec.has(String(r.stage_code))).length,
      realized: rows.filter((r) => realized.has(String(r.stage_code)))
        .reduce((s, r) => s + musd(r), 0),
      onTrack: rows.filter((r) => r.track_code === onTrack).length,
      prioritized: rows.filter((r) => r.aligned_lobp && r.bottleneck_uplift).length,
    };
  }, [rows, registry]);

  /* ------------------------------------------------------ donut datasets */
  const donut = (column: string) => {
    const counts = new Map<string, number>();
    rows.forEach((r) => {
      const k = String(r[column] ?? "\u2014");
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, value], i) => ({
        name: display(registry, column, code),
        value,
        fill: chartColour(registry, column, code, i),
      }));
  };

  /* ------------------------------------- value by N editable split levels */
  const [splits, setSplits] = useState<string[]>(["bu_code", "stage_code"]);
  const split = useSplitAggregate(rows, registry, splits, actualOf(actuals), actuals);

  /* --------------------------------------------- per-section aggregates */
  const mixStats = useMemo(() => {
    const dominant = (column: string) => {
      const d = donut(column)[0];
      return d ? `${d.name} · ${fmt.pct(100 * d.value / Math.max(rows.length, 1), 0)}` : "\u2014";
    };
    return { dominant };
  }, [rows, registry]);

  if (initiatives.isLoading && !initiatives.data) return <Loading what="the register" />;

  return (
    <>
      <PageHead title="Portfolio"
        blurb="Headline position for the selected snapshot. Monthly phasing follows the snapshot's fiscal year and stops at its period end." />

      <FilterBar count={<><b>{rows.length}</b> of {allRows.length} shown</>} />

      <PrintSection id="kpis" label="Headline KPIs" className="panel">
        <div className="kpirow tight">
          <Kpi label="Initiatives" value={fmt.int(kpis.count)}
            sub={`${kpis.inExecution} in execution`} />
          <Kpi label="Current-year value target" value={fmt.musd(kpis.value)}
            sub={`${fmt.musd(kpis.realized)} at cash-flowing or locked-in`} />
          <Kpi label={ACTUALS_LABEL.ytd} value={fmt.musd(kpis.actualYtd)}
            tone={kpis.value && kpis.actualFy / kpis.value >= 0.9 ? "good" : "warn"}
            sub={`${fmt.musd(kpis.actualFy)} with forecast · `
              + `${fmt.pct(kpis.value ? 100 * kpis.actualFy / kpis.value : 0, 0)} of CY target`} />
          <Kpi label="On track" value={fmt.int(kpis.onTrack)}
            tone={kpis.onTrack / Math.max(kpis.count, 1) > 0.7 ? "good" : "warn"}
            sub={fmt.pct(100 * kpis.onTrack / Math.max(kpis.count, 1), 0)} />
          <Kpi label="Prioritized" value={fmt.int(kpis.prioritized)}
            sub="LoBP-aligned and bottleneck-relieving" />
          <Kpi label="Register completeness"
            value={fmt.pct(gaps.data?.pct)}
            tone={(gaps.data?.pct ?? 0) > 90 ? "good" : (gaps.data?.pct ?? 0) > 75 ? "warn" : "bad"}
            sub={`${gaps.data?.fully_complete ?? 0} fully complete`} />
        </div>
      </PrintSection>

      <Section id="pipeline" title="Stage-gate pipeline"
        note={`count · current-year value target per stage · hover for ${actualsLabel.toLowerCase()}`}
        blurb="Live view of where initiatives sit in the maturity funnel. Value is incremental FCF impact, not gross revenue.">
        {noMatch ? none("in the funnel") : pipeline.data ? (
          funnelStages.some((st) => st.count) ? (
            <>
              <Stats items={funnelStats(pipeline.data, registry, actuals)} />
              <FunnelBars registry={registry} stages={funnelStages} actualsLabel={actualsLabel}
                config={funnel.config} saving={funnel.saving}
                onSave={funnel.save} onReset={funnel.reset} />
            </>
          ) : <Empty>None of the {rows.length} matching initiatives has a stage.</Empty>
        ) : <Loading what="the funnel" />}
      </Section>

      <Section id="mix" title="Portfolio mix"
        blurb="Distribution of the filtered portfolio across delivery track, business unit and value-realization confidence. Each ring counts initiatives, not value.">
        {noMatch ? none("in the portfolio mix") : (
          <>
            <Stats items={[
              { label: "Initiatives", value: fmt.int(rows.length) },
              { label: "Leading track", value: mixStats.dominant("track_code"), tone: "good" },
              { label: "Leading BU", value: mixStats.dominant("bu_code") },
              { label: "Leading confidence", value: mixStats.dominant("confidence_code") },
            ]} />
            <div className="grid3">
              <Panel title="By track" flush><Donut data={donut("track_code")} /></Panel>
              <Panel title="By business unit" flush><Donut data={donut("bu_code")} /></Panel>
              <Panel title="By confidence" flush><Donut data={donut("confidence_code")} /></Panel>
            </div>
          </>
        )}
      </Section>

      <Section id="bu-stage" title={`Value by ${splits.map(labelOf).join(" \u203A ")}`}
        note={`current-year value target vs ${actualsLabel.toLowerCase()}`}
        blurb="Split the bars by any dimension — or stack several splits (e.g. BU > Stage) to nest the breakdown. Everything but the last split forms the x-axis grouping; the last becomes the stacked series."
        actions={<SplitPicker value={splits} onChange={setSplits}
          options={dimOptions} min={1} max={3} />}>
        {noMatch ? none("in the value split") : split.data.length ? (
          <>
            <Stats items={[
              { label: actualsLabel, value: fmt.musd(split.actual), tone: "good" },
              { label: "Target", value: fmt.musd(split.target) },
              {
                label: "% of target",
                value: fmt.pct(split.target ? 100 * split.actual / split.target : 0, 0),
                tone: split.target && split.actual / split.target > 0.5 ? "good" : "warn",
              },
              { label: "Combinations", value: fmt.int(split.data.length) },
            ]} />
            <Bars data={split.data} xKey="group" stacked={split.stacked} horizontal
              height={Math.max(280, split.data.length * 26)}
              valueFormat={(v) => `$${v.toFixed(0)}M`}
              series={split.series.map((s) => ({ key: s.key, label: s.label }))}
              colourOf={(k, i) => split.colourOf(k, i)}
              companion={{
                label: actualsLabel, mainLabel: "Target", keyFor: companionKey,
              }} />
            <p className="muted sm">
              {split.stacked
                ? `Bars grouped by ${split.groupKeys.map(labelOf).join(SEP)}, `
                  + `split by ${labelOf(split.stackKey!)}.`
                : "One bar pair per group."}{" "}
              Each bar's outline is its current-year value target; the solid
              fill is {actualsLabel.toLowerCase()}, split the same way. Hover for the
              target-vs-actuals comparison at every level.
              {split.untargeted > 0 && ` ${split.untargeted} segment${split.untargeted === 1 ? "" : "s"} `
                + "with actuals but no target are omitted from the bars."}
            </p>
          </>
        ) : <Empty>No initiative carries the selected dimensions.</Empty>}
      </Section>

      <Section id="monthly" title={`Monthly phasing · ${monthly.data?.year ?? ""}`}
        note={PHASING_TEXT[mode].note}
        blurb={PHASING_TEXT[mode].blurb}
        actions={
          <Select label="Measure" value={mode}
            onChange={(v) => setMode(v as PhasingMode)}
            options={[{ value: "financial", label: "Financial ($M)" },
              { value: "kpi", label: "KPI attainment (%)" },
              { value: "milestones", label: "Milestones (# actions)" }]} />
        }>
        {noMatch ? none("in the monthly phasing") : !monthly.data ? <Loading what="phasing" />
          : !hasPhasing(monthly.data, mode) ? (
            <Empty>
              None of the {rows.length} matching initiatives carries
              {{ financial: " monthly financial phasing", kpi: " KPI readings",
                milestones: " monthly milestone phasing" }[mode]} for {monthly.data.year}.
            </Empty>
          ) : (
          <>
            <Stats items={monthlyStats(monthly.data, mode)} />
            {mode === "financial"
              ? <CumulativeLines months={monthly.data.months}
                target={monthly.data.financial_target_cum_musd}
                actual={monthly.data.financial_actual_cum_musd}
                cutoffIndex={monthly.data.cutoff_index} />
              : mode === "milestones"
              ? <CumulativeLines months={monthly.data.months}
                target={monthly.data.milestones_target_cum}
                actual={monthly.data.milestones_actual_cum}
                cutoffIndex={monthly.data.cutoff_index} unit="actions"
                labels={{ target: "Planned", actual: "Completed" }} />
              : <AttainmentLine months={monthly.data.months}
                pct={monthly.data.kpi_attainment_pct}
                sample={monthly.data.kpi_sample} />}
          </>
        )}
      </Section>

      <Section id="quarters" title="Initiatives by landing quarter"
        blurb="Each initiative sits in the quarter its value is planned to land. Initiatives with no planned end date are grouped as unscheduled."
        actions={<Select label="Stack by" value={stackBy} onChange={setStackBy}
          options={dimOptions} />}>
        {noMatch ? none("by landing quarter") : quarters.data ? (
          <>
            <Stats items={[
              { label: "Scheduled", value: fmt.int(quarters.data.scheduled), tone: "good" },
              {
                label: "Unscheduled", value: fmt.int(quarters.data.unscheduled),
                tone: quarters.data.unscheduled ? "warn" : undefined,
              },
              { label: "Peak quarter", value: `${quarters.data.peak_key} · ${quarters.data.peak_count}` },
            ]} />
            <Bars data={quarters.data.buckets.map((b) => ({ key: b.key, ...b.counts }))}
              xKey="key" stacked
              series={quarters.data.series.map((s) => ({
                key: s, label: display(registry, stackBy, s),
              }))}
              colourOf={(k, i) => chartColour(registry, stackBy, k, i)} />
          </>
        ) : <Loading what="quarters" />}
      </Section>

      <Section id="treemap" title="Portfolio status treemap"
        note={tmMeasure === "count" ? "on-track by hierarchy" : "value attainment by hierarchy"}
        blurb={`${TM_MEASURES.find(([m]) => m === tmMeasure)![2]} Add, remove or reorder levels to re-cut the hierarchy.`}
        actions={<TreemapControls measure={tmMeasure} onMeasure={setTmMeasure}
          levels={drill} onLevels={setDrill} options={dimOptions} />}>
        {noMatch ? none("in the treemap") : tree.data ? (
          <>
            <Stats items={tmMeasure === "count" ? [
              { label: "Initiatives", value: fmt.int(tree.data.nodes.reduce((a, n) => a + n.count, 0)) },
              { label: "On track", value: fmt.int(tree.data.nodes.reduce((a, n) => a + n.on_track, 0)) },
              { label: "Drill path", value: drill.map(labelOf).join(SEP) },
            ] : [
              { label: "CY target", value: fmt.musd(tree.data.value_musd) },
              { label: ACTUALS_LABEL.ytd, value: fmt.musd(tree.data.actual_ytd_musd),
                tone: actuals === "ytd" ? "good" : undefined },
              { label: ACTUALS_LABEL.fy, value: fmt.musd(tree.data.actual_fy_musd),
                tone: actuals === "fy" ? "good" : undefined },
              (() => {
                const att = tree.data.value_musd
                  ? tree.data[actualKey(actuals)] / tree.data.value_musd : null;
                return {
                  label: "% of target",
                  value: att == null ? "—" : fmt.pct(100 * att, 0),
                  tone: att != null && att > 0.5 ? "good" : "warn",
                } as Stat;
              })(),
              { label: "Drill path", value: drill.map(labelOf).join(SEP) },
            ]} />
            <StatusTreemap nodes={tree.data.nodes} registry={registry} measure={tmMeasure}
              actuals={actuals} />
          </>
        ) : <Loading what="the treemap" />}
      </Section>

      <Section id="matrix" title="BU × value lever"
        note={`${VMX_NOTES[vmxMeasure]} per stage, by BU and lever`}
        blurb="Always the whole snapshot— the filters above do not apply here, though the Actuals toggle does. Only initiatives carrying BU, lever and stage together appear— the footnote reports the mapped share. Switch the measure to read each stage chip as its current-year actuals against its value target."
        actions={<div className="tm-controls">
          <MeasureToggle measure={vmxMeasure} onMeasure={setVmxMeasure} options={VMX_MEASURES}
            label="Matrix measure" />
        </div>}>
        {matrix.data ? <Matrix data={matrix.data} registry={registry} measure={vmxMeasure}
          actuals={actuals} />
          : <Loading what="the matrix" />}
      </Section>
    </>
  );
}

/* ============================================================ no match = */
/** Shown in place of a visual when the filter bar leaves nothing to plot. */
function NoMatch({ what, onReset }: { what: string; onReset: () => void }) {
  return (
    <Empty>
      No initiatives match the current filters, so there is nothing to
      show {what}.{" "}
      <button type="button" className="linkbtn" onClick={onReset}>Reset filters</button>
    </Empty>
  );
}

/** Whether a monthly series has anything to draw for the chosen measure. */
function hasPhasing(data: MonthlySeries, mode: PhasingMode) {
  if (mode === "kpi") return data.kpi_sample.some((n) => n > 0);
  return (mode === "milestones"
    ? [...data.milestones_target_cum, ...data.milestones_actual_cum]
    : [...data.financial_target_cum_musd, ...data.financial_actual_cum_musd])
    .some((v) => v);
}

/* ================================================================ stats = */
type Stat = { label: string; value: ReactNode; tone?: "good" | "warn" | "bad" };

/** Aggregate readout strip that sits directly above a chart. */
function Stats({ items }: { items: Stat[] }) {
  if (!items.length) return null;
  return (
    <div className="statrow">
      {items.map((s) => (
        <div key={s.label} className="stat">
          <span className="stat-l">{s.label}</span>
          <b className={`stat-v${s.tone ? ` tone-${s.tone}` : ""}`}>{s.value}</b>
        </div>
      ))}
    </div>
  );
}

function funnelStats(data: StageMatrixOut, registry: Registry | undefined,
  actuals: ActualsBasis): Stat[] {
  const entries = Object.entries(data.funnel);
  if (!entries.length) return [];
  const total = entries.reduce((a, [, v]) => a + v.count, 0);
  const value = entries.reduce((a, [, v]) => a + v.value_musd, 0);
  const actual = entries.reduce((a, [, v]) => a + v[actualKey(actuals)], 0);
  const peak = [...entries].sort((a, b) => b[1].count - a[1].count)[0];
  return [
    { label: "In funnel", value: fmt.int(total) },
    { label: "Value", value: fmt.musd(value) },
    { label: ACTUALS_LABEL[actuals], value: fmt.musd(actual), tone: "good" },
    { label: "Largest stage", value: `${display(registry, "stage_code", peak[0])} · ${peak[1].count}` },
  ];
}

function monthlyStats(data: any, mode: PhasingMode): Stat[] {
  const i = data.cutoff_index ?? data.months.length - 1;
  const last = (arr: number[]) => arr?.[arr.length - 1] ?? 0;
  if (mode === "kpi") {
    return [
      { label: `Attainment at ${data.months[i]}`, value: fmt.pct(data.kpi_attainment_pct?.[i], 0), tone: "good" },
      { label: "Sample", value: fmt.int(data.kpi_sample?.[i] ?? 0) },
    ];
  }
  if (mode === "milestones") {
    const done = data.milestones_actual_cum?.[i] ?? 0;
    const planned = data.milestones_target_cum?.[i] ?? 0;
    const ratio = planned ? done / planned : 0;
    return [
      { label: `Completed to ${data.months[i]}`, value: fmt.int(done), tone: "good" },
      { label: `Planned to ${data.months[i]}`, value: fmt.int(planned) },
      { label: "Full-year plan", value: fmt.int(last(data.milestones_target_cum)) },
      { label: "On plan", value: fmt.pct(100 * ratio, 0), tone: ratio >= 0.9 ? "good" : "warn" },
    ];
  }
  const realized = data.financial_actual_cum_musd?.[i] ?? 0;
  const target = last(data.financial_target_cum_musd);
  return [
    { label: `Realized to ${data.months[i]}`, value: fmt.musd(realized), tone: "good" },
    { label: "Full-year target", value: fmt.musd(target) },
    {
      label: "% of full-year target",
      value: fmt.pct(target ? 100 * realized / target : 0, 0),
      tone: target && realized / target > 0.7 ? "good" : "warn",
    },
  ];
}

/* ======================================================= split aggregate = */
/**
 * splits[0..n-2] -> composite x-axis group; splits[n-1] -> stacked series.
 * A single split produces one unstacked series, i.e. plain totals per group.
 */
function useSplitAggregate(
  rows: Initiative[],
  registry: Registry | undefined,
  splits: string[],
  actualOf: (r: Initiative) => number,
  /** the actuals basis `actualOf` reads -- the memo's dependency */
  basis: ActualsBasis,
  measure: (r: Initiative) => number = (r) => Number(r.value_target_cy ?? 0) / 1e6,
) {
  return useMemo(() => {
    const dims = splits.length ? splits : ["bu_code"];
    const stacked = dims.length > 1;
    const groupKeys = stacked ? dims.slice(0, -1) : dims;
    const stackKey = stacked ? dims[dims.length - 1] : null;

    const cell = (r: Initiative, k: string) => String(r[k] ?? "\u2014");

    const keys = stackKey
      ? [...new Set(rows.map((r) => cell(r, stackKey)))].sort()
      : [TOTAL];

    const zero = () =>
      Object.fromEntries(keys.map((k) => [k, 0])) as Record<string, number>;

    /* Actuals are accumulated per stack segment, not just per group, so the
       last split applies to both measures and the two bars stay comparable
       level by level. */
    const byGroup = new Map<string, {
      path: string[];
      vals: Record<string, number>;
      reals: Record<string, number>;
    }>();
    rows.forEach((r) => {
      const path = groupKeys.map((k) => cell(r, k));
      const id = path.join("\u0000");
      const slot = byGroup.get(id) ?? { path, vals: zero(), reals: zero() };
      const s = stackKey ? cell(r, stackKey) : TOTAL;
      slot.vals[s] = (slot.vals[s] ?? 0) + measure(r);
      slot.reals[s] = (slot.reals[s] ?? 0) + actualOf(r);
      byGroup.set(id, slot);
    });

    const data = [...byGroup.values()]
      .map(({ path, vals, reals }) => ({
        group: path.map((v, i) => display(registry, groupKeys[i], v)).join(SEP),
        _total: Object.values(vals).reduce((a, b) => a + b, 0),
        ...vals,
        ...Object.fromEntries(Object.entries(reals).map(([k, v]) => [companionKey(k), v])),
      }))
      .sort((a, b) => b._total - a._total);

    const series = keys.map((k, i) => ({
      key: k,
      label: stackKey ? display(registry, stackKey, k) : "Target",
      colour: chartColour(registry, stackKey ?? groupKeys[0], k, i),
    }));

    const target = rows.reduce((a, r) => a + measure(r), 0);
    const actual = rows.reduce((a, r) => a + actualOf(r), 0);

    /* Segments with target === 0 get zero width from the Recharts layout
       engine, so the bullet shape never gets room to draw the actuals.
       Counted here so the caption can flag what's hidden rather than let it
       silently vanish. */
    const untargeted = data.reduce((count, row: Record<string, any>) =>
      count + keys.filter((k) => !row[k] && Number(row[companionKey(k)] ?? 0) > 0).length, 0);

    return {
      data,
      series,
      stacked,
      groupKeys,
      stackKey,
      target,
      actual,
      untargeted,
      colourOf: (k: string, i: number) =>
        series.find((s) => s.key === k)?.colour
        ?? chartColour(registry, stackKey ?? groupKeys[0], k, i),
    };
  }, [rows, registry, splits, basis]);
}

/* ===================================================== treemap controls = */
/**
 * The treemap's header: what tiles measure, then the hierarchy they nest by.
 * Two labelled groups on one baseline, the levels drawn as a path
 * (BU › Stage › …) since that is what they are -- order matters, unlike the
 * value chart's splits, so this doesn't reuse SplitPicker.
 */
function TreemapControls({ measure, onMeasure, levels, onLevels, options, max = 4 }: {
  measure: TreemapMeasure;
  onMeasure: (m: TreemapMeasure) => void;
  levels: string[];
  onLevels: (next: string[]) => void;
  options: { value: string; label: string }[];
  max?: number;
}) {
  const free = (self?: string) =>
    options.filter((o) => o.value === self || !levels.includes(o.value));
  const next = free()[0]?.value;
  return (
    <div className="tm-controls">
      <MeasureToggle measure={measure} onMeasure={onMeasure} options={TM_MEASURES}
        label="Treemap measure" />
      <div className="tm-controls-sep" aria-hidden="true" />
      <div className="field">
        <span>Hierarchy</span>
        <div className="tm-path">
          {levels.map((dim, i) => (
            <Fragment key={`${dim}-${i}`}>
              {i > 0 && <span className="tm-path-arrow" aria-hidden="true">{"\u203A"}</span>}
              <span className="tm-level">
                <select value={dim} aria-label={`Level ${i + 1}`}
                  onChange={(e) => onLevels(levels.map((d, j) => (j === i ? e.target.value : d)))}>
                  {free(dim).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {levels.length > 1 && (
                  <button type="button" className="tm-level-x" aria-label={`Remove level ${i + 1}`}
                    title="Remove this level"
                    onClick={() => onLevels(levels.filter((_, j) => j !== i))}>
                    &times;
                  </button>
                )}
              </span>
            </Fragment>
          ))}
          {levels.length < max && next && (
            <button type="button" className="linkbtn tm-path-add"
              onClick={() => onLevels([...levels, next])}>
              + Level
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Measure segmented control, shared by the treemap and the BU × lever matrix. */
function MeasureToggle<M extends string>({ measure, onMeasure, options, label }: {
  measure: M;
  onMeasure: (m: M) => void;
  options: readonly (readonly [M, string, ...unknown[]])[];
  label: string;
}) {
  return (
    <div className="field">
      <span>Measure</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([m, l]) => (
          <button key={m} type="button" aria-pressed={measure === m}
            className={measure === m ? "on" : undefined}
            onClick={() => onMeasure(m)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ========================================================== split picker = */
function SplitPicker({
  value, onChange, options, min = 1, max = 3, labels = ["Group by", "Then by"],
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: { value: string; label: string }[];
  min?: number;
  max?: number;
  labels?: [string, string] | string[];
}) {
  const free = (self?: string) =>
    options.filter((o) => o.value === self || !value.includes(o.value));
  const next = free()[0]?.value;

  return (
    <div className="splitpicker">
      {value.map((dim, i) => (
        <span key={`${dim}-${i}`} className="splitpicker-item">
          <Select
            label={i === 0 ? labels[0] : labels[1]}
            value={dim}
            onChange={(v: string) => onChange(value.map((d, j) => (j === i ? v : d)))}
            options={free(dim)} />
          {value.length > min && (
            <button type="button" className="linkbtn" aria-label="Remove split"
              onClick={() => onChange(value.filter((_, j) => j !== i))}>
              &times;
            </button>
          )}
        </span>
      ))}
      {value.length < max && next && (
        <button type="button" className="linkbtn"
          onClick={() => onChange([...value, next])}>
          + Add split
        </button>
      )}
    </div>
  );
}

/* ============================================================ stage matrix = */
const VMX_CHIP: Record<string, { bg: string; fg: string; border?: string }> = {
  EVALUATING: { bg: "#3CB5E5", fg: "#fff" },
  IMPLEMENTING: { bg: "#fff", fg: "#333", border: "#b9bdc2" },
  CASH_FLOWING: { bg: "#FFF200", fg: "#4a4300" },
  LOCKED_IN: { bg: "#00A651", fg: "#fff" },
};
const STAGE_SHORT: Record<string, string> = { CASH_FLOWING: "Cash" };
/* The matrix has no tile size to drive, so target and actuals share one
 * "Value" view: each chip reads actuals (per the toggle) against its target. */
type VmxMeasure = "count" | "value";
const VMX_MEASURES: [VmxMeasure, string][] = [["count", "Initiatives"], ["value", "Value $"]];
const VMX_NOTES: Record<VmxMeasure, string> = {
  count: "initiatives", value: "current-year actuals vs target",
};
type VmxFigures = { count: number; value: number; actual: number };
const pctOf = (c: VmxFigures) => (c.value ? fmt.pct(100 * c.actual / c.value, 0) : "no target");

function Matrix({ data, registry, measure, actuals }: {
  data: StageMatrixOut; registry?: Registry; measure: VmxMeasure; actuals: ActualsBasis;
}) {
  const actualsLabel = ACTUALS_LABEL[actuals].toLowerCase();
  const order = (col: string, codes: string[]) => {
    const spec = registry?.fields.find((f) => f.column === col);
    const terms = (spec?.vocab && registry?.vocab[spec.vocab]?.terms.map((t) => t.code)) || [];
    const rank = (c: string) => { const i = terms.indexOf(c); return i < 0 ? 999 : i; };
    return [...codes].sort((x, y) => rank(x) - rank(y));
  };
  const bus = order("bu_code", [...new Set(data.cells.map((c) => c.bu_code))]);
  const levers = order("lever_code", [...new Set(data.cells.map((c) => c.lever_code))]);
  const stageRank = (c: string) => {
    const i = DEFAULT_ORDER.indexOf(c.toUpperCase()); return i < 0 ? 999 : i;
  };
  const lookup = new Map<string, { stage: string; count: number; value: number; actual: number }[]>();
  data.cells.forEach((c) => {
    const k = `${c.bu_code}|${c.lever_code}`;
    lookup.set(k, [...(lookup.get(k) ?? []),
      { stage: c.stage_code, count: c.count, value: c.value_musd, actual: c[actualKey(actuals)] ?? 0 }]);
  });
  /* Chip body for the active measure; tooltips always carry every figure. */
  const figures = (c: VmxFigures) => measure === "count" ? c.count : (
    <>
      {fmt.musd(c.actual)}
      <small className="vmx-of">{c.value ? `of ${fmt.musd(c.value)}` : "no target"}</small>
      {c.value > 0 && (
        <span className="vmx-bar">
          <i style={{ width: `${Math.min(Math.max(c.actual / c.value, 0), 1) * 100}%` }} />
        </span>
      )}
    </>
  );
  const detail = (c: VmxFigures) =>
    `${c.count} initiatives · ${fmt.musd(c.actual)} ${actualsLabel} of ${fmt.musd(c.value)} target (${pctOf(c)})`;

  if (!bus.length) return <Empty>No initiative carries BU, lever and stage together.</Empty>;

  return (
    <div className="tablewrap">
      <div className="vmx">
        {measure === "value" && (
          <p className="vmx-key">
            Big figure = CY {actualsLabel} · small = CY target · bar = % of target achieved
          </p>
        )}
        <div className="vmx-grid" style={{ gridTemplateColumns: `200px repeat(${bus.length}, minmax(110px, 1fr))` }}>
          <div />
          {bus.map((bu) => (
            <div key={bu} className="vmx-h" title={display(registry, "bu_code", bu)}>{bu}</div>
          ))}
          {levers.map((l) => (
            <Fragment key={l}>
              <div className="vmx-r">{display(registry, "lever_code", l)}</div>
              {bus.map((bu) => {
                const chips = (lookup.get(`${bu}|${l}`) ?? [])
                  .sort((x, y) => stageRank(x.stage) - stageRank(y.stage));
                const sum = (k: "count" | "value" | "actual") => chips.reduce((a, c) => a + c[k], 0);
                const n = sum("count");
                return (
                  <div key={bu} className={`vmx-c ${n ? "has" : "empty"}`}
                    title={`${bu} · ${display(registry, "lever_code", l)} — ${detail({ count: n, value: sum("value"), actual: sum("actual") })}`}>
                    {n ? chips.map((c, i) => {
                      const st = VMX_CHIP[c.stage.toUpperCase()] ?? {
                        bg: chartColour(registry, "stage_code", c.stage, i), fg: "#fff" };
                      const label = display(registry, "stage_code", c.stage);
                      return (
                        <div key={c.stage} className={`vmx-chip${measure === "count" ? "" : " money"}`}
                          style={{ background: st.bg, color: st.fg,
                            border: st.border ? `1.5px solid ${st.border}` : undefined }}
                          title={`${bu} · ${display(registry, "lever_code", l)} · ${label}: ${detail(c)}`}>
                          {figures(c)}
                          <small>{STAGE_SHORT[c.stage.toUpperCase()] ?? label.split(" ")[0]}</small>
                        </div>
                      );
                    }) : <span className="vmx-zero">{"\u2014"}</span>}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <p className="muted sm">
        {data.mapped} of {data.total} initiatives carry all three dimensions.
      </p>
    </div>
  );
}
