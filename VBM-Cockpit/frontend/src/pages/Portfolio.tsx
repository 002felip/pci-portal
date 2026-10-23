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
import type { ColumnDef } from "@tanstack/react-table";

import {
  fmt, useCompleteness, useInitiatives, useMeta, useMonthly, useQuarters,
  useStageMatrix, useTree, type Initiative, type Registry,
} from "../api";
import { PageHead } from "../App";
import {
  AttainmentLine, Bars, CumulativeLines, DecompositionTree, Donut, FunnelBars,
  DEFAULT_ORDER, StatusTreemap, chartColour, type Stage,
} from "../charts";
import { useFunnelConfig } from "../funnelConfig";
import {
  DataTable, Empty, Kpi, Loading, Panel, PrintSection, Select, WhenReady,
  display, usePeriod,
} from "../ui";

const TOTAL = "__total__";        // sentinel series when nothing is stacked
/** Data key holding the realized value that pairs with target series `k`. */
const realizedKey = (k: string) => `__realized\u0000${k}`;

/** Current-year realized value, in $M -- the same unit as the target measure. */
const realizedOf = (r: Initiative) => Number(r.value_realized_cy ?? 0) / 1e6;
const SEP = " \u25B8 ";           // "▸" joins composite x-axis labels

export default function PortfolioPage() {
  return <WhenReady><Body /></WhenReady>;
}

function Body() {
  const { snapshot } = usePeriod();
  const { data: meta } = useMeta();
  const registry = meta?.registry;

  const [stackBy, setStackBy] = useState("stage_code");
  const [drill, setDrill] = useState<string[]>(["bu_code", "stage_code"]);
  const [mode, setMode] = useState<"financial" | "kpi">("financial");

  /* The decomposition tree edits its own levels from inside the tree, and
     carries a selected path down them, so it keeps its own state and its own
     query rather than sharing the treemap's `drill`. */
  const [dcLevels, setDcLevels] = useState<string[]>(["bu_code", "stage_code"]);
  const [dcPath, setDcPath] = useState<string[]>([]);

  const initiatives = useInitiatives({ snapshot, limit: 5000 });
  const monthly = useMonthly(snapshot);
  const quarters = useQuarters(snapshot, stackBy);
  const matrix = useStageMatrix(snapshot);
  const tree = useTree(snapshot, drill);
  const decomp = useTree(snapshot, dcLevels);
  const gaps = useCompleteness(snapshot);

  const funnelStages: Stage[] = useMemo(() => matrix.data
    ? Object.entries(matrix.data.funnel)
      .map(([code, v]) => ({ code, count: v.count, value_musd: v.value_musd }))
    : [], [matrix.data]);
  const funnel = useFunnelConfig(funnelStages);

  const allRows = initiatives.data?.items ?? [];

  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

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
    return {
      count: rows.length,
      value: rows.reduce((s, r) => s + musd(r), 0),
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
  const split = useSplitAggregate(rows, registry, splits);

  /* --------------------------------------------- per-section aggregates */
  const mixStats = useMemo(() => {
    const dominant = (column: string) => {
      const d = donut(column)[0];
      return d ? `${d.name} · ${fmt.pct(100 * d.value / Math.max(rows.length, 1), 0)}` : "\u2014";
    };
    return { dominant };
  }, [rows, registry]);

  const registerColumns = useMemo<ColumnDef<Initiative, any>[]>(() => {
    const wanted = ["source_initiative_id", "name", "bu_code", "stage_code",
      "track_code", "lever_code", "value_target_cy", "confidence_code"];
    return wanted.map((column) => ({
      id: column,
      accessorFn: (r: Initiative) => r[column],
      header: registry?.fields.find((f) => f.column === column)?.label ?? column,
      cell: (ctx: any) => display(registry, column, ctx.getValue()),
    }));
  }, [registry]);

  if (initiatives.isLoading && !initiatives.data) return <Loading what="the register" />;

  return (
    <>
      <PageHead title="Portfolio"
        blurb="Headline position for the selected snapshot. Monthly phasing follows the snapshot's fiscal year and stops at its period end." />

      <div className="panel filterbar-panel">
        <div className="filterbar">
          {registry?.fields.filter((f) => f.filterable).map((f) => (
            <Select key={f.column} label={f.label}
              value={filters[f.column] ?? ""}
              onChange={(v) => setFilters((prev) => {
                const next = { ...prev };
                if (v) next[f.column] = v; else delete next[f.column];
                return next;
              })}
              options={[{ value: "", label: "All" },
                ...(f.vocab ? registry.vocab[f.vocab].terms.map((t) => ({
                  value: t.code, label: t.label })) : [])]} />
          ))}
          <label className="field grow">
            <span className="sm muted">Search</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="ID, name, owner, KPI…" />
          </label>
          <button type="button" className="ghost"
            onClick={() => { setFilters({}); setSearch(""); }}>
            Reset
          </button>
        </div>
        <p className="muted sm filter-count">
          <b>{rows.length}</b> of {allRows.length} shown
        </p>
      </div>

      <PrintSection id="kpis" label="Headline KPIs" className="panel">
        <div className="kpirow tight">
          <Kpi label="Initiatives" value={fmt.int(kpis.count)}
            sub={`${kpis.inExecution} in execution`} />
          <Kpi label="Current-year value target" value={fmt.musd(kpis.value)}
            sub={`${fmt.musd(kpis.realized)} at cash-flowing or locked-in`} />
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
        note="count · current-year value target per stage"
        blurb="Live view of where initiatives sit in the maturity funnel. Value is incremental FCF impact, not gross revenue.">
        {matrix.data ? (
          <>
            <Stats items={funnelStats(matrix.data, registry)} />
            <FunnelBars registry={registry} stages={funnelStages}
              config={funnel.config} saving={funnel.saving}
              onSave={funnel.save} onReset={funnel.reset} />
          </>
        ) : <Loading what="the funnel" />}
      </Section>

      <Section id="mix" title="Portfolio mix"
        blurb="Distribution of the filtered portfolio across delivery track, business unit and value-realization confidence. Each ring counts initiatives, not value.">
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
      </Section>

      <Section id="bu-stage" title={`Value by ${splits.map(labelOf).join(" \u203A ")}`}
        note="current-year value target vs realized"
        blurb="Split the bars by any dimension — or stack several splits (e.g. BU > Stage) to nest the breakdown. Everything but the last split forms the x-axis grouping; the last becomes the stacked series."
        actions={<SplitPicker value={splits} onChange={setSplits}
          options={dimOptions} min={1} max={3} />}>
        {split.data.length ? (
          <>
            <Stats items={[
              { label: "Realized", value: fmt.musd(split.realized), tone: "good" },
              { label: "Target", value: fmt.musd(split.target) },
              {
                label: "Realization",
                value: fmt.pct(split.target ? 100 * split.realized / split.target : 0, 0),
                tone: split.target && split.realized / split.target > 0.5 ? "good" : "warn",
              },
              { label: "Combinations", value: fmt.int(split.data.length) },
            ]} />
            <Bars data={split.data} xKey="group" stacked={split.stacked} horizontal
              height={Math.max(280, split.data.length * 26)}
              valueFormat={(v) => `$${v.toFixed(0)}M`}
              series={split.series.map((s) => ({ key: s.key, label: s.label }))}
              colourOf={(k, i) => split.colourOf(k, i)}
              companion={{
                label: "Realized", mainLabel: "Target", keyFor: realizedKey,
              }} />
            <p className="muted sm">
              {split.stacked
                ? `Bars grouped by ${split.groupKeys.map(labelOf).join(SEP)}, `
                  + `split by ${labelOf(split.stackKey!)}.`
                : "One bar pair per group."}{" "}
              Each bar's outline is its current-year value target; the solid
              fill is realized value, split the same way. Hover for the
              target-vs-realized comparison at every level.
              {split.untargeted > 0 && ` ${split.untargeted} segment${split.untargeted === 1 ? "" : "s"} `
                + "with realized value but no target are omitted from the bars."}
            </p>
          </>
        ) : <Empty>No initiative carries the selected dimensions.</Empty>}
      </Section>

      <Section id="monthly" title={`Monthly phasing · ${monthly.data?.year ?? ""}`}
        note={mode === "financial" ? "cumulative target vs realized" : "KPI attainment"}
        blurb="KPI attainment is direction-aware: for cost and working-capital levers a lower actual counts as meeting the target."
        actions={
          <Select label="Measure" value={mode}
            onChange={(v) => setMode(v as "financial" | "kpi")}
            options={[{ value: "financial", label: "Financial ($M)" },
              { value: "kpi", label: "KPI attainment (%)" }]} />
        }>
        {!monthly.data ? <Loading what="phasing" /> : (
          <>
            <Stats items={monthlyStats(monthly.data, mode)} />
            {mode === "financial"
              ? <CumulativeLines months={monthly.data.months}
                target={monthly.data.financial_target_cum_musd}
                actual={monthly.data.financial_actual_cum_musd}
                cutoffIndex={monthly.data.cutoff_index} />
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
        {quarters.data ? (
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

      <Section id="treemap" title="Portfolio status treemap \u2014 on-track by hierarchy"
        blurb="Tile size = number of initiatives; colour and inner bar = share on track. Add, remove or reorder levels to re-cut the hierarchy."
        actions={<SplitPicker value={drill} onChange={setDrill}
          options={dimOptions} min={1} max={4} labels={["Level 1", "Level"]} />}>
        {tree.data ? (
          <>
            <Stats items={[
              { label: "Initiatives", value: fmt.int(tree.data.nodes.reduce((a, n) => a + n.count, 0)) },
              { label: "On track", value: fmt.int(tree.data.nodes.reduce((a, n) => a + n.on_track, 0)) },
              { label: "Drill path", value: drill.map(labelOf).join(SEP) },
            ]} />
            <StatusTreemap nodes={tree.data.nodes} registry={registry} />
          </>
        ) : <Loading what="the treemap" />}
      </Section>

      <Section id="matrix" title="BU × value lever"
        note="initiatives per stage, by BU and lever"
        blurb="Only initiatives carrying BU, lever and stage together appear here \u2014 the footnote reports the mapped share.">
        {matrix.data ? <Matrix data={matrix.data} registry={registry} />
          : <Loading what="the matrix" />}
      </Section>

      <Section id="tree" title="Decomposition"
        blurb="Click a node to break it down by the field; keep clicking to go deeper. Swap or drop a level from its column header. Big number = initiatives, bar = share on track.">
        {decomp.data ? (
          <>
            <Stats items={[
              { label: "In scope", value: fmt.int(decomp.data.total) },
              {
                label: "On track",
                value: `${fmt.int(decomp.data.on_track)} · ${fmt.pct(
                  decomp.data.total ? 100 * decomp.data.on_track / decomp.data.total : 0, 0)}`,
              },
              { label: "Value", value: fmt.musd(decomp.data.value_musd) },
              {
                label: "Selection",
                value: dcPath.length
                  ? dcPath.map((v, i) => display(registry, dcLevels[i], v)).join(SEP)
                  : "All initiatives",
              },
            ]} />
            <div className="tablewrap">
              <DecompositionTree
                levels={dcLevels}
                path={dcPath}
                nodes={decomp.data.nodes}
                total={decomp.data.total}
                onTrack={decomp.data.on_track}
                valueMusd={decomp.data.value_musd}
                dimensions={dimOptions}
                labelFor={(dim, code) => display(registry, dim, code)}
                onLevelChange={(i, dim) => {
                  const next = [...dcLevels];
                  next[i] = dim;
                  setDcLevels(next);
                  setDcPath(dcPath.slice(0, i));
                }}
                onRemoveLevel={(i) => {
                  setDcLevels(dcLevels.slice(0, i).concat(dcLevels.slice(i + 1)));
                  setDcPath(dcPath.slice(0, i));
                }}
                onAddLevel={(dim) => setDcLevels([...dcLevels, dim])}
                onSelect={(i, value) => {
                  const next = dcPath.slice(0, i);
                  if (dcPath[i] !== value) next[i] = value;   // same node again = deselect
                  setDcPath(next);
                }}
              />
            </div>
          </>
        ) : <Loading what="the tree" />}
      </Section>

      <Section id="register" title="Initiative register"
        blurb="Everything in the filtered snapshot. Editing lives on the Initiatives tab."
        defaultOpen={false}>
        <DataTable data={rows} columns={registerColumns} dense pageSize={20}
          initialSort={[{ id: "value_target_cy", desc: true }]} />
      </Section>
    </>
  );
}

/* ============================================================== section = */
/**
 * Collapsible card: chevron heading, optional note, sub-headline blurb and a
 * right-aligned actions slot. Wraps PrintSection so print pagination still
 * treats the whole block as one unit.
 */
function Section({
  id, title, note, blurb, actions, children, defaultOpen = true,
}: {
  id: string;
  title: string;
  note?: string;
  blurb?: string;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <PrintSection id={id} label={title}>
      <div className={`card js-collapse${open ? "" : " collapsed"}`}>
        <div className="sec-bar">
          <h3 className="sec-head" onClick={() => setOpen((o) => !o)}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOpen((o) => !o); }}>
            <span className="chev">{"\u25BE"}</span>
            {title}
            {note && <span className="sec-note">{`\u2014 ${note}`}</span>}
          </h3>
          {open && actions && <div className="sec-actions">{actions}</div>}
        </div>
        {blurb && <div className="hint">{blurb}</div>}
        <div className="collapse-body">{children}</div>
      </div>
    </PrintSection>
  );
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

function funnelStats(data: any, registry?: Registry): Stat[] {
  const entries = Object.entries(data.funnel) as [string, any][];
  if (!entries.length) return [];
  const total = entries.reduce((a, [, v]) => a + v.count, 0);
  const value = entries.reduce((a, [, v]) => a + v.value_musd, 0);
  const peak = [...entries].sort((a, b) => b[1].count - a[1].count)[0];
  return [
    { label: "In funnel", value: fmt.int(total) },
    { label: "Value", value: fmt.musd(value) },
    { label: "Largest stage", value: `${display(registry, "stage_code", peak[0])} · ${peak[1].count}` },
  ];
}

function monthlyStats(data: any, mode: "financial" | "kpi"): Stat[] {
  const i = data.cutoff_index ?? data.months.length - 1;
  const last = (arr: number[]) => arr?.[arr.length - 1] ?? 0;
  if (mode === "kpi") {
    return [
      { label: `Attainment at ${data.months[i]}`, value: fmt.pct(data.kpi_attainment_pct?.[i], 0), tone: "good" },
      { label: "Sample", value: fmt.int(data.kpi_sample?.[i] ?? 0) },
    ];
  }
  const realized = data.financial_actual_cum_musd?.[i] ?? 0;
  const target = last(data.financial_target_cum_musd);
  return [
    { label: `Realized to ${data.months[i]}`, value: fmt.musd(realized), tone: "good" },
    { label: "Full-year target", value: fmt.musd(target) },
    {
      label: "Attainment",
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

    /* Realized is accumulated per stack segment, not just per group, so the
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
      slot.reals[s] = (slot.reals[s] ?? 0) + realizedOf(r);
      byGroup.set(id, slot);
    });

    const data = [...byGroup.values()]
      .map(({ path, vals, reals }) => ({
        group: path.map((v, i) => display(registry, groupKeys[i], v)).join(SEP),
        _total: Object.values(vals).reduce((a, b) => a + b, 0),
        ...vals,
        ...Object.fromEntries(Object.entries(reals).map(([k, v]) => [realizedKey(k), v])),
      }))
      .sort((a, b) => b._total - a._total);

    const series = keys.map((k, i) => ({
      key: k,
      label: stackKey ? display(registry, stackKey, k) : "Target",
      colour: chartColour(registry, stackKey ?? groupKeys[0], k, i),
    }));

    const target = rows.reduce((a, r) => a + measure(r), 0);
    const realized = rows.reduce((a, r) => a + realizedOf(r), 0);

    /* Segments with target === 0 get zero width from the Recharts layout
       engine, so the bullet shape never gets room to draw realized value.
       Counted here so the caption can flag what's hidden rather than let it
       silently vanish. */
    const untargeted = data.reduce((count, row: Record<string, any>) =>
      count + keys.filter((k) => !row[k] && Number(row[realizedKey(k)] ?? 0) > 0).length, 0);

    return {
      data,
      series,
      stacked,
      groupKeys,
      stackKey,
      target,
      realized,
      untargeted,
      colourOf: (k: string, i: number) =>
        series.find((s) => s.key === k)?.colour
        ?? chartColour(registry, stackKey ?? groupKeys[0], k, i),
    };
  }, [rows, registry, splits]);
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

function Matrix({ data, registry }: { data: any; registry?: Registry }) {
  const order = (col: string, codes: string[]) => {
    const spec = registry?.fields.find((f) => f.column === col);
    const terms = (spec?.vocab && registry?.vocab[spec.vocab]?.terms.map((t) => t.code)) || [];
    const rank = (c: string) => { const i = terms.indexOf(c); return i < 0 ? 999 : i; };
    return [...codes].sort((x, y) => rank(x) - rank(y));
  };
  const bus = order("bu_code", [...new Set(data.cells.map((c: any) => c.bu_code))] as string[]);
  const levers = order("lever_code", [...new Set(data.cells.map((c: any) => c.lever_code))] as string[]);
  const stageRank = (c: string) => {
    const i = DEFAULT_ORDER.indexOf(c.toUpperCase()); return i < 0 ? 999 : i;
  };
  const lookup = new Map<string, { stage: string; count: number; value: number }[]>();
  data.cells.forEach((c: any) => {
    const k = `${c.bu_code}|${c.lever_code}`;
    lookup.set(k, [...(lookup.get(k) ?? []),
      { stage: c.stage_code, count: c.count, value: c.value_musd }]);
  });

  if (!bus.length) return <Empty>No initiative carries BU, lever and stage together.</Empty>;

  return (
    <div className="tablewrap">
      <div className="vmx">
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
                const n = chips.reduce((a, c) => a + c.count, 0);
                const v = chips.reduce((a, c) => a + c.value, 0);
                return (
                  <div key={bu} className={`vmx-c ${n ? "has" : "empty"}`}
                    title={`${bu} · ${display(registry, "lever_code", l)} — ${n} initiatives · ${fmt.musd(v)}`}>
                    {n ? chips.map((c, i) => {
                      const st = VMX_CHIP[c.stage.toUpperCase()] ?? {
                        bg: chartColour(registry, "stage_code", c.stage, i), fg: "#fff" };
                      const label = display(registry, "stage_code", c.stage);
                      return (
                        <div key={c.stage} className="vmx-chip"
                          style={{ background: st.bg, color: st.fg,
                            border: st.border ? `1.5px solid ${st.border}` : undefined }}
                          title={`${bu} · ${display(registry, "lever_code", l)} · ${label}: ${c.count} initiatives · ${fmt.musd(c.value)}`}>
                          {c.count}
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
