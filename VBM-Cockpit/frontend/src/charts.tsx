/**
 * Charts. Thin wrappers over Recharts.
 *
 * WHAT THIS REPLACES
 * ------------------
 *   components/charts/primitives.tsx        643 lines   bars, lines, donuts, axes
 *   components/charts/Treemap.tsx           210 lines   squarified layout by hand
 *   components/charts/StageMatrix.tsx       265 lines   SVG grid + funnel
 *   hooks/useMeasuredWidth.ts                30 lines   ResizeObserver
 *   ------------------------------------------------------------------------
 *                                         ~1,150 lines  ->  this file
 *
 * WHY RECHARTS AND NOT SOMETHING ELSE
 *   Recharts   SVG, declarative, React-native, ResponsiveContainer replaces the
 *              measuring hook, <Tooltip/> replaces the portal. Crucially it
 *              renders SVG, which the PDF rasterizer already handles -- the one
 *              real argument the previous build made for going custom.
 *   ECharts    canvas-first. Faster on 50k points, which this app does not have,
 *              and it would put a canvas back in the PDF path. Heavier too.
 *   Nivo       also SVG and prettier out of the box, but a larger surface and a
 *              stronger opinion about theming than a CSS-driven app wants.
 *   visx       low-level primitives. We would be writing scales and axes again,
 *              which is the problem we are removing.
 *
 * WHAT STAYED HAND-ROLLED, DELIBERATELY
 *   The BU x lever x stage matrix. It is a table with a colour scale, not a
 *   chart; rendering it as an HTML table with TanStack Table is both less code
 *   than the old SVG and more accessible than any chart library's heatmap.
 *
 *   The decomposition tree. This was a react-d3-tree node-link diagram, which
 *   consumed /api/analytics/tree's shape as-is but could only display it: the
 *   drill path was chosen elsewhere, clicking a node just collapsed a branch,
 *   and per-node figures were squeezed into label text. It is now a grid of
 *   HTML buttons -- one column per dimension -- where clicking a node filters
 *   everything to its right and each node carries its own count, on-track bar
 *   and actuals-vs-target value bar. No tree-layout algorithm is involved, so no library helps; the
 *   hover detail comes from ChartTooltip.tsx, since Recharts' <Tooltip/> only
 *   works inside a Recharts container.
 *
 *   The stage-gate funnel. Recharts' <Funnel> takes a single series and gives
 *   no control over the taper or paired count/value labels, so the trapezoids
 *   are drawn directly. It is the one chart here with its own ResizeObserver,
 *   since there is no Recharts container to inherit.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart,
  Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip,
  XAxis, YAxis,
} from "recharts";
import {
  fmt, type Registry, type TopItem, type TopMovement, type TreeNode,
} from "./api";
import { TooltipRow, useChartTooltip } from "./ChartTooltip";
import { ACTUALS_LABEL, actualKey, display, type ActualsBasis } from "./ui";

export const PALETTE = ["#2C6E9B", "#3E9E74", "#C77D28", "#7E5AA6", "#C0574E",
  "#6B7785", "#2C7FB8", "#1FA971", "#E8A93C", "#E03E2D", "#8A94A2", "#4B6A88"];

const AXIS = { stroke: "#8A94A2", fontSize: 11 };
const GRID = { stroke: "#E4E8EE", strokeDasharray: "3 3" };
const TIP = {
  contentStyle: {
    background: "#fff", border: "1px solid #D8DEE6", borderRadius: 6,
    fontSize: 12, boxShadow: "0 4px 16px rgba(20,30,45,.12)",
  },
} as const;

/** Ink colours shared by the hand-rolled SVG below, so it tracks the Recharts theme. */
const INK = { strong: "#1B2733", muted: "#8A94A2", inverse: "#fff" } as const;

export function chartColour(registry: Registry | undefined, column: string,
  code: string, index: number): string {
  const spec = registry?.fields.find((f) => f.column === column);
  if (spec?.vocab) {
    const term = registry?.vocab[spec.vocab]?.terms.find((t) => t.code === code);
    if (term?.color_hex) return term.color_hex;
  }
  return PALETTE[index % PALETTE.length];
}

/* ================================================================== bars = */
/**
 * Tooltip for a chart with a companion measure: one line per split level,
 * each showing companion vs main and the attainment between them, plus the
 * group total. Recharts' default tooltip would instead list every bar twice
 * with no pairing, which is unreadable once a stack is involved.
 */
function PairedTooltip({ payload, label, series, companion, colour, format, focus }: {
  payload?: any[];
  label?: string;
  series: { key: string; label?: string }[];
  companion: { label: string; mainLabel: string; keyFor: (key: string) => string };
  colour: (key: string, i: number) => string;
  format?: (v: number) => string;
  focus?: string | null;
}) {
  const row = payload?.[0]?.payload as Record<string, any> | undefined;
  if (!row) return null;

  const fmtv = (v: number) => (format ? format(v) : String(v));
  const pct = (a: number, b: number) => (b ? `${Math.round(100 * a / b)}%` : "—");

  const lines = series
    .map((s, i) => ({
      key: s.key,
      label: s.label ?? s.key,
      colour: colour(s.key, i),
      main: Number(row[s.key] ?? 0),
      comp: Number(row[companion.keyFor(s.key)] ?? 0),
    }))
    .filter((l) => l.main || l.comp);

  const main = lines.reduce((a, l) => a + l.main, 0);
  const comp = lines.reduce((a, l) => a + l.comp, 0);
  const split = series.length > 1;

  return (
    <div className="chart-tooltip chart-tooltip--static">
      <div className="tt-head"><span className="tt-title">{label}</span></div>
      <div className="tt-rows">
        {split
          ? lines.map((l) => (
            <TooltipRow key={l.label} color={l.colour} label={l.label}
              value={`${fmtv(l.comp)} / ${fmtv(l.main)} · ${pct(l.comp, l.main)}`}
              /* Mirrors the bar's own hover-focus dimming, so the row that's
                 highlighted in the chart is the one that reads as active
                 here too -- otherwise the whole group lights up while the
                 chart dims everything but one segment. */
              muted={Boolean(focus) && focus !== l.key} />
          ))
          : <>
            <TooltipRow label={companion.label} value={fmtv(comp)} />
            <TooltipRow label={companion.mainLabel} value={fmtv(main)} muted />
          </>}
      </div>
      <div className="tt-foot">
        {split && `${companion.label} / ${companion.mainLabel} — `}
        {`${fmtv(comp)} of ${fmtv(main)} · ${pct(comp, main)}`}
      </div>
    </div>
  );
}

type CompanionSpec = {
  label: string;
  mainLabel: string;
  keyFor: (key: string) => string;
};

const INSET = 1.5;
const MIN_STROKE_W = 5;     // below this a stroke leaves no room for fill
const MIN_SEG_W = 3;
const NEUTRAL_FILL = "#C9D1DA";
const NEUTRAL_STROKE = "#D8DEE6";

/**
 * Bullet-style shape for a target/realized pair: the envelope (drawn full
 * length) is the target, the inset fill anchored to the segment's own
 * leading edge is realized. Colours are hard-coded rather than CSS custom
 * properties because html2canvas serializes inline SVG for the PDF export
 * and drops stylesheet rules.
 */
function companionShape(
  seriesKey: string,
  companion: CompanionSpec,
  horizontal: boolean,
  allowOverflow: boolean,
  dimmed: boolean,
) {
  return function CompanionBar(props: any) {
    const { x, y, width, height, fill, payload } = props;
    if (width <= 0 || height <= 0) return <g />;

    const target = Number(payload?.[seriesKey] ?? 0);
    const realized = Number(payload?.[companion.keyFor(seriesKey)] ?? 0);

    // `along` is the axis the measure runs along; `thick` is the other one.
    const along = horizontal ? width : height;
    const hue = dimmed ? NEUTRAL_FILL : fill;
    const stroke = dimmed ? NEUTRAL_STROKE : fill;
    const thin = along < MIN_STROKE_W;

    const ratio = target > 0 ? realized / target : 0;
    const clamped = Math.min(ratio, 1);
    const over = ratio > 1;

    // --- envelope -------------------------------------------------------
    const envelope = thin
      ? <rect x={x} y={y} width={Math.max(width, horizontal ? MIN_SEG_W : width)}
        height={height} fill={hue} rx={1} />
      : <rect x={x} y={y} width={width} height={height} rx={3}
        fill="#fff" stroke={stroke} strokeWidth={INSET} />;

    // --- realized fill, anchored to this segment's own baseline ----------
    const len = Math.max(0, clamped * along - (thin ? 0 : INSET));
    const inner = horizontal
      ? { x: x + INSET / 2, y: y + INSET / 2, width: len, height: height - INSET }
      : {
        x: x + INSET / 2, y: y + height - INSET / 2 - len,
        width: width - INSET, height: len,
      };

    // --- over-target ------------------------------------------------------
    const overflowLen = over && allowOverflow
      ? Math.min((ratio - 1) * along, along)   // cap runaway ratios
      : 0;
    const overflow = overflowLen > 0.5
      ? (horizontal
        ? <rect x={x + width} y={y + 3} width={overflowLen} height={height - 6}
          fill={hue} rx={2} />
        : <rect x={x + 3} y={y - overflowLen} width={width - 6} height={overflowLen}
          fill={hue} rx={2} />)
      : null;
    const tick = over
      ? (horizontal
        ? <line x1={x + width} y1={y - 3} x2={x + width} y2={y + height + 3}
          stroke="#1B2733" strokeWidth={2} />
        : <line x1={x - 3} y1={y} x2={x + width + 3} y2={y}
          stroke="#1B2733" strokeWidth={2} />)
      : null;

    return (
      <g>
        {envelope}
        {!thin && len > 0.5 && <rect {...inner} fill={hue} rx={2} />}
        {overflow}
        {tick}
      </g>
    );
  };
}

/**
 * `companion` mirrors every main series with a second measure (e.g. realized).
 * Rather than a second bar, it renders as a bullet: the main series' bar
 * becomes an outlined envelope at the target length, with the companion value
 * filled inside from the segment's own leading edge -- so the shortfall is the
 * literal white space, not something the viewer subtracts. `keyFor` maps a
 * main series key to the data key holding its companion value.
 *
 * `signed` is for deltas: the value axis spans zero in both directions (the
 * default floors it at 0, which would hide every decline) with a zero line.
 */
export function Bars({ data, xKey, series, height = 260, stacked, horizontal,
  colourOf, valueFormat, reference, companion, signed }: {
  data: Record<string, any>[];
  xKey: string;
  series: { key: string; label?: string }[];
  height?: number;
  stacked?: boolean;
  horizontal?: boolean;
  colourOf?: (key: string, i: number) => string;
  valueFormat?: (v: number) => string;
  reference?: { value: number; label: string };
  companion?: CompanionSpec;
  signed?: boolean;
}) {
  const valueDomain: [any, any] = signed
    ? [(min: number) => Math.min(0, min * 1.05), (max: number) => Math.max(0, max * 1.05)]
    : [0, (max: number) => max * 1.02];
  const colour = colourOf ?? ((_k: string, i: number) => PALETTE[i % PALETTE.length]);
  const [focus, setFocus] = useState<string | null>(null);
  const focusable = series.length > 1 && Boolean(companion);
  /* Recharts' own tooltip box follows the cursor and, on a dense horizontal
     chart, routinely lands on top of the bar (or the chart below it) it is
     explaining. `useChartTooltip` is the floating tooltip the decomposition
     tree already uses -- it measures its own card and flips/clamps to the
     viewport, so it never covers what it describes. Recharts still owns the
     `cursor` highlight, which is unrelated to where the box renders. */
  const floatTip = useChartTooltip();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 12, bottom: 4, left: horizontal ? 24 : 0 }}>
        <CartesianGrid {...GRID} vertical={Boolean(horizontal)} />
        {horizontal
          ? <><XAxis type="number" {...AXIS} tickFormatter={valueFormat}
            domain={valueDomain} />
            <YAxis type="category" dataKey={xKey} {...AXIS} width={96} interval={0} /></>
          : <><XAxis dataKey={xKey} {...AXIS} interval={0} />
            <YAxis {...AXIS} tickFormatter={valueFormat}
              domain={valueDomain} /></>}
        {signed && (
          <ReferenceLine {...(horizontal ? { x: 0 } : { y: 0 })} stroke="#8A94A2" />
        )}
        {companion
          ? <Tooltip {...TIP} cursor={{ fill: "rgba(20,30,45,.05)" }} content={() => null} />
          : <Tooltip {...TIP} formatter={(v: number, n: string) =>
            [valueFormat ? valueFormat(v) : v, n]} />}
        {(series.length > 1 || companion) && (
          <Legend wrapperStyle={{ fontSize: 11 }}
            payload={[
              ...series.map((s, i) => ({
                value: s.label ?? s.key, type: "square" as const, color: colour(s.key, i),
              })),
              ...(companion ? [
                { value: `${companion.mainLabel} (outline)`, type: "square" as const, color: "#fff" },
                { value: `${companion.label} (fill)`, type: "square" as const, color: "#8A94A2" },
              ] : []),
            ]} />
        )}
        {reference && (
          <ReferenceLine {...(horizontal ? { x: reference.value } : { y: reference.value })}
            stroke="#C0574E" strokeDasharray="4 4"
            label={{ value: reference.label, fontSize: 10, fill: "#C0574E" }} />
        )}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label ?? s.key}
            stackId={stacked ? "a" : undefined}
            fill={colour(s.key, i)}
            maxBarSize={companion ? 26 : 48}
            isAnimationActive={false}
            onMouseEnter={(entry: any, _index: number, e: any) => {
              if (focusable) setFocus(s.key);
              if (companion) {
                const row = entry?.payload;
                floatTip.show(e, (
                  <PairedTooltip payload={row ? [{ payload: row }] : undefined}
                    label={row?.[xKey]} series={series} companion={companion}
                    colour={colour} format={valueFormat} focus={s.key} />
                ));
              }
            }}
            onMouseMove={companion ? (_entry: any, _index: number, e: any) => floatTip.move(e) : undefined}
            onMouseLeave={() => {
              if (focusable) setFocus(null);
              if (companion) floatTip.hide();
            }}
            shape={companion
              ? companionShape(
                s.key, companion, Boolean(horizontal),
                !stacked,
                focus !== null && focus !== s.key,
              )
              : undefined}
            radius={!companion && !stacked && !signed ? [3, 3, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ================================================================= donut = */
export function Donut({ data, height = 220, total, unit = "" }: {
  data: { name: string; value: number; fill: string }[];
  height?: number;
  total?: string;
  unit?: string;
}) {
  return (
    <div className="donutwrap" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%"
            outerRadius="85%" paddingAngle={1} stroke="#fff" strokeWidth={2}>
            {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Pie>
          <Tooltip {...TIP} formatter={(v: number, n: string) => [`${v}${unit}`, n]} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
        </PieChart>
      </ResponsiveContainer>
      {total && <div className="donut-centre">{total}</div>}
    </div>
  );
}

/* ============================================================= line/area = */
/**
 * Cumulative target vs realized, with the actuals truncated at `cutoffIndex`.
 * The forecast tail is a separate dashed series rather than a clipped path --
 * simpler than the old manual path splitting, and the legend explains itself.
 */
export function CumulativeLines({ months, target, actual, cutoffIndex,
  height = 300, unit = "$M", labels }: {
  months: string[];
  target: number[];
  actual: number[];
  cutoffIndex: number | null;
  height?: number;
  /** "$M", "%" or a count noun such as "actions" */
  unit?: string;
  /** legend/tooltip names; defaults to Target / Realized */
  labels?: { target: string; actual: string };
}) {
  const T = labels?.target ?? "Target";
  const A = labels?.actual ?? "Realized";
  const data = useMemo(() => months.map((m, i) => ({
    month: m.slice(5),
    [T]: target[i],
    [A]: cutoffIndex == null || i <= cutoffIndex ? actual[i] : null,
    Forecast: cutoffIndex != null && i >= cutoffIndex ? actual[i] : null,
  })), [months, target, actual, cutoffIndex, T, A]);
  const money = unit === "$M";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis {...AXIS} allowDecimals={money}
          tickFormatter={(v) => `${v}${unit === "%" ? "%" : ""}`} />
        <Tooltip {...TIP} formatter={(v: number) =>
          unit === "%" ? `${v?.toFixed(1)}%`
            : money ? `$${v?.toFixed(1)}M`
            : `${v?.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${unit}`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey={T} stroke="#2C6E9B" strokeWidth={2}
          dot={false} />
        <Line type="monotone" dataKey={A} stroke="#1FA971" strokeWidth={2.5}
          dot={{ r: 2 }} connectNulls={false} />
        <Line type="monotone" dataKey="Forecast" stroke="#1FA971" strokeWidth={1.5}
          strokeDasharray="5 4" dot={false} connectNulls />
        {cutoffIndex != null && (
          <ReferenceLine x={months[cutoffIndex]?.slice(5)} stroke="#8A94A2"
            strokeDasharray="2 3"
            label={{ value: "cutoff", fontSize: 10, fill: "#8A94A2" }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function AttainmentLine({ months, pct, sample, height = 260 }: {
  months: string[]; pct: (number | null)[]; sample: number[]; height?: number;
}) {
  const data = months.map((m, i) => ({ month: m.slice(5), pct: pct[i], n: sample[i] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis {...AXIS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...TIP} formatter={(v: number, _n, p: any) =>
          [`${v?.toFixed(1)}% of ${p.payload.n}`, "Meeting KPI target"]} />
        <ReferenceLine y={80} stroke="#E8A93C" strokeDasharray="4 4"
          label={{ value: "80%", fontSize: 10, fill: "#E8A93C" }} />
        <Line type="monotone" dataKey="pct" stroke="#7E5AA6" strokeWidth={2.5}
          dot={{ r: 2.5 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ============================================================ stage funnel = */
export type Stage = {
  code: string; count: number; value_musd: number;
  /** the selected actuals figure ($M), shown on hover and on off-funnel cards */
  actual_musd?: number;
};
export type StageTrack = "funnel" | "side";

export type FunnelConfig = {
  /** every stage code, in render order (left -> right for the funnel) */
  order: string[];
  /** funnel = sequential gate, side = off-funnel (enterable from anywhere) */
  track: Record<string, StageTrack>;
  /** label overrides; falls back to display(registry, "stage_code", code) */
  labels: Record<string, string>;
};

/** Gates in pipeline order, then the terminal/parked statuses. Matches the
 * `stage` vocab in registry.py -- see VOCAB["stage"]. */
export const DEFAULT_ORDER = [
  "NOT STARTED",
  "EVALUATING",
  "IMPLEMENTING",
  "CASH_FLOWING",
  "LOCKED_IN",
  "ON_HOLD",
  "CLOSED",
  "CANCELLED",
];

/**
 * Terminal or parked states. An initiative can land in any of these from any
 * gate, so they are not points on the sequence and must not be drawn inside
 * the taper -- doing so implies a progression that does not exist and
 * corrupts the stage-to-stage conversion figures.
 */
const OFF_FUNNEL = new Set(["ON_HOLD", "CLOSED", "CANCELLED"]);

/** Case-insensitive membership test against DEFAULT_ORDER / OFF_FUNNEL,
 * since data sources are not guaranteed to match the vocab's casing. */
const upperIndex = (list: string[]) =>
  new Map(list.map((c, i) => [c.toUpperCase(), i]));
const DEFAULT_ORDER_INDEX = upperIndex(DEFAULT_ORDER);
const isOffFunnel = (code: string) => OFF_FUNNEL.has(code.toUpperCase());

export function buildFunnelConfig(stages: Stage[]): FunnelConfig {
  const known = [...stages.map((s) => s.code)]
    .filter((c) => DEFAULT_ORDER_INDEX.has(c.toUpperCase()))
    .sort((a, b) => DEFAULT_ORDER_INDEX.get(a.toUpperCase())! -
      DEFAULT_ORDER_INDEX.get(b.toUpperCase())!);
  const extra = stages.map((s) => s.code).filter((c) => !known.includes(c));
  const order = [...known, ...extra];
  return {
    order,
    track: Object.fromEntries(
      order.map((c) => [c, isOffFunnel(c) ? "side" : "funnel"]),
    ) as Record<string, StageTrack>,
    labels: {},
  };
}

/**
 * Fold a persisted config over the stage codes actually present in the data.
 *
 * Keeps the stored order for codes that still exist, appends any code the
 * data has that the stored config does not (a new vocab term must not
 * silently vanish), and overlays stored track/label choices onto known codes
 * only -- a stale override for a code no longer present is dropped.
 */
export function reconcileFunnelConfig(
  stored: Partial<FunnelConfig> | undefined, stages: Stage[]): FunnelConfig {
  const base = buildFunnelConfig(stages);
  if (!stored?.order?.length) return base;

  const present = new Set(stages.map((s) => s.code));
  const kept = stored.order.filter((c) => present.has(c));
  const missing = base.order.filter((c) => !kept.includes(c));
  const order = [...kept, ...missing];

  const labels: Record<string, string> = {};
  for (const c of order) {
    const label = stored.labels?.[c] ?? base.labels[c];
    if (label !== undefined) labels[c] = label;
  }

  return {
    order,
    track: Object.fromEntries(order.map((c) =>
      [c, stored.track?.[c] ?? base.track[c]])) as Record<string, StageTrack>,
    labels,
  };
}

/**
 * Horizontal stage-gate funnel.
 *
 * Slices run left to right, one per gate, each vertically centred so the
 * silhouette reads as a funnel. Heights are NON-CUMULATIVE: a slice is sized by
 * the initiatives sitting in that stage right now, not by everything that has
 * passed through it. The shape can therefore widen again mid-pipeline, which is
 * the honest picture of a portfolio where work piles up at a gate.
 *
 * Stage set is editable at runtime -- reorder, rename, or move a stage between
 * the funnel and the off-funnel track.
 */
export function FunnelBars({
  stages,
  registry,
  height = 260,
  metric = "count",
  gap = 6,
  minHeightPct = 0.16,
  labelHeight = 34,
  sideWidth = 150,
  editable = true,
  config: configProp,
  onConfigChange,
  onSave,
  onReset,
  saving = false,
  actualsLabel = ACTUALS_LABEL.ytd,
}: {
  stages: Stage[];
  registry?: Registry;
  height?: number;
  /** which magnitude drives the slice height */
  metric?: "count" | "value";
  gap?: number;
  /** floor height of the smallest slice, as a fraction of the plot height */
  minHeightPct?: number;
  /** gutter under the slices for the stage names */
  labelHeight?: number;
  sideWidth?: number;
  editable?: boolean;
  config?: FunnelConfig;
  /** uncontrolled fallback: fires on every edit when there is no onSave */
  onConfigChange?: (c: FunnelConfig) => void;
  /** controlled persistence: draft commits only when this resolves */
  onSave?: (c: FunnelConfig) => void | Promise<void>;
  /** clears the persisted config so the built-in default applies again */
  onReset?: () => void;
  saving?: boolean;
  /** names `actual_musd` in the hover card */
  actualsLabel?: string;
}) {
  const [internal, setInternal] = useState<FunnelConfig>(
    () => configProp ?? buildFunnelConfig(stages));
  const config = configProp ?? internal;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FunnelConfig>(config);
  const [hover, setHover] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);

  // The only measuring hook left in the file: no Recharts container to inherit.
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const byCode = useMemo(
    () => Object.fromEntries(stages.map((s) => [s.code, s])), [stages]);

  // While editing, the panel and the chart both preview the draft; once
  // committed (Save, or every keystroke for the uncontrolled fallback) both
  // read `config`.
  const active = editing ? draft : config;

  const rows = useMemo(() => active.order
    .filter((c) => byCode[c])
    .map((c, i) => ({
      ...byCode[c],
      label: active.labels[c] ?? display(registry, "stage_code", c),
      track: active.track[c] ?? "funnel",
      mag: metric === "value" ? byCode[c].value_musd : byCode[c].count,
      idx: i,
    })), [active, byCode, registry, metric]);

  const funnel = rows.filter((r) => r.track === "funnel");
  const side = rows.filter((r) => r.track === "side");

  /* ------------------------------------------------------------ geometry -- */
  const plotH = Math.max(40, height - labelHeight);
  const cy = plotH / 2;
  const max = Math.max(...funnel.map((d) => d.mag), 1);
  const sliceW = funnel.length
    ? (w - gap * Math.max(funnel.length - 1, 0)) / funnel.length : 0;
  const heightOf = (mag: number) =>
    plotH * (minHeightPct + (1 - minHeightPct) * (mag / max));

  /* ----------------------------------------------------------- mutations -- */
  // No onSave -> uncontrolled, unchanged from before: every edit commits
  // straight to `config`/`onConfigChange`. With onSave, edits only mutate the
  // local draft until Save is pressed.
  const commit = (next: FunnelConfig) => {
    if (onSave) {
      setDraft(next);
    } else {
      if (!configProp) setInternal(next);
      onConfigChange?.(next);
    }
  };
  const move = (code: string, dir: -1 | 1) => {
    const o = [...active.order];
    const i = o.indexOf(code);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    commit({ ...active, order: o });
  };
  const rename = (code: string, label: string) =>
    commit({ ...active, labels: { ...active.labels, [code]: label } });
  const retrack = (code: string, track: StageTrack) =>
    commit({ ...active, track: { ...active.track, [code]: track } });

  const startEditing = () => {
    setDraft(config);
    setEditing(true);
  };
  const cancelEditing = () => setEditing(false);
  const save = () => {
    onSave?.(draft);
    setEditing(false);
  };

  return (
    <div className="funnelwrap" style={{ width: "100%" }}>
      {editable && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          {!editing && (
            <button type="button" onClick={startEditing} style={BTN}>
              Edit stages
            </button>
          )}
          {editing && onSave && (
            <>
              <button type="button" onClick={save} disabled={saving} style={BTN}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={cancelEditing}
                style={{ ...BTN, marginLeft: 6 }}>
                Cancel
              </button>
            </>
          )}
          {editing && !onSave && (
            <button type="button" onClick={cancelEditing} style={BTN}>
              Done
            </button>
          )}
          {editing && (
            <button type="button" onClick={() => {
              if (onReset) onReset();
              setDraft(buildFunnelConfig(stages));
              if (!onSave) commit(buildFunnelConfig(stages));
            }}
              style={{ ...BTN, marginLeft: 6 }}>
              Reset
            </button>
          )}
        </div>
      )}

      {editing && (
        <div style={EDITOR_BOX}>
          {rows.map((r) => (
            <div key={r.code} style={EDITOR_ROW}>
              <button type="button" style={MINI} aria-label={`Move ${r.label} earlier`}
                onClick={() => move(r.code, -1)}>◀</button>
              <button type="button" style={MINI} aria-label={`Move ${r.label} later`}
                onClick={() => move(r.code, 1)}>▶</button>
              <span style={{
                width: 10, height: 10, borderRadius: 2,
                background: chartColour(registry, "stage_code", r.code, r.idx),
              }} />
              <input value={r.label} style={INPUT}
                onChange={(e) => rename(r.code, e.target.value)} />
              <select value={r.track} style={INPUT}
                onChange={(e) => retrack(r.code, e.target.value as StageTrack)}>
                <option value="funnel">In funnel</option>
                <option value="side">Off-funnel</option>
              </select>
              <span style={{ fontSize: 11, color: INK.muted, marginLeft: "auto" }}>
                {r.count} · {fmt.musd(r.value_musd)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div ref={wrapRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <svg width="100%" height={height} role="img"
            aria-label={`Stage-gate funnel, ${funnel.length} gates`}>
            {funnel.map((d, i) => {
              const x = i * (sliceW + gap);
              const hL = heightOf(d.mag);
              // right edge meets the next slice's height -> continuous silhouette
              const hR = i < funnel.length - 1 ? heightOf(funnel[i + 1].mag) : hL * 0.9;
              const pts = [
                [x, cy - hL / 2],
                [x + sliceW, cy - hR / 2],
                [x + sliceW, cy + hR / 2],
                [x, cy + hL / 2],
              ].map((p) => p.join(",")).join(" ");
              const inside = Math.min(hL, hR) > 34 && sliceW > 78;
              return (
                <g key={d.code}
                  onMouseEnter={() => setHover(d.code)}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: "default" }}>
                  <polygon points={pts}
                    fill={chartColour(registry, "stage_code", d.code, d.idx)}
                    fillOpacity={hover === null || hover === d.code ? 1 : 0.45}
                    style={{ transition: "fill-opacity .15s" }} />
                  {inside && (
                    <>
                      <text x={x + sliceW / 2} y={cy - 7} textAnchor="middle"
                        dominantBaseline="central" fontSize={15} fontWeight={700}
                        fill={INK.inverse}>
                        {d.count}
                      </text>
                      <text x={x + sliceW / 2} y={cy + 10} textAnchor="middle"
                        dominantBaseline="central" fontSize={AXIS.fontSize}
                        fill={INK.inverse} opacity={0.9}>
                        {fmt.musd(d.value_musd)}
                      </text>
                    </>
                  )}
                  {!inside && (
                    <text x={x + sliceW / 2} y={cy - Math.max(hL, hR) / 2 - 6}
                      textAnchor="middle" fontSize={AXIS.fontSize} fontWeight={600}
                      fill={INK.strong}>
                      {d.count} · {fmt.musd(d.value_musd)}
                    </text>
                  )}
                  <text x={x + sliceW / 2} y={plotH + labelHeight / 2}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={AXIS.fontSize} fill={INK.strong}>
                    {d.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {hover && funnel.some((f) => f.code === hover) && (() => {
            const i = funnel.findIndex((f) => f.code === hover);
            const d = funnel[i];
            return (
              <div style={{
                ...TIP.contentStyle,
                position: "absolute",
                left: i * (sliceW + gap) + sliceW / 2,
                top: cy + heightOf(d.mag) / 2 + 8,
                transform: "translateX(-50%)",
                padding: "6px 8px",
                pointerEvents: "none",
                whiteSpace: "nowrap",
                zIndex: 2,
              }}>
                <strong>{d.label}</strong>
                <br />
                {d.count} initiatives · {fmt.musd(d.value_musd)} target
                {d.actual_musd != null && (
                  <>
                    <br />
                    {fmt.musd(d.actual_musd)} {actualsLabel.toLowerCase()}
                  </>
                )}
                {i > 0 && (
                  <>
                    <br />
                    <span style={{ color: INK.muted }}>
                      {Math.round((d.mag / funnel[i - 1].mag) * 100)}% of{" "}
                      {funnel[i - 1].label} (stage balance, not flow)
                    </span>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {/* Off-funnel statuses. Reachable from any gate, so they sit outside the
            silhouette rather than at the end of it. */}
        {side.length > 0 && (
          <div style={{ width: sideWidth, flexShrink: 0 }}>
            <div style={SIDE_HEAD}>Off-funnel</div>
            {side.map((d) => (
              <div key={d.code} style={{
                ...SIDE_CARD,
                borderLeft: `3px solid ${chartColour(registry, "stage_code", d.code, d.idx)}`,
              }}>
                <div style={{ fontSize: AXIS.fontSize, color: INK.strong }}>{d.label}</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: INK.strong }}>
                  {d.count}
                </div>
                <div style={{ fontSize: 11, color: INK.muted }}>
                  {fmt.musd(d.value_musd)}
                  {d.actual_musd != null && ` · ${fmt.musd(d.actual_musd)} act.`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const BTN: CSSProperties = {
  fontSize: 12, padding: "3px 10px", border: "1px solid #D8DEE6",
  borderRadius: 4, background: "#fff", cursor: "pointer", color: INK.strong,
};
const MINI: CSSProperties = { ...BTN, padding: "0 5px", lineHeight: "18px", fontSize: 10 };
const INPUT: CSSProperties = {
  fontSize: 12, padding: "2px 6px", border: "1px solid #D8DEE6",
  borderRadius: 4, background: "#fff",
};
const EDITOR_BOX: CSSProperties = {
  border: "1px solid #E4E8EE", borderRadius: 6, padding: 8,
  marginBottom: 10, background: "#FAFBFC",
};
const EDITOR_ROW: CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "3px 0",
};
const SIDE_HEAD: CSSProperties = {
  fontSize: 10, letterSpacing: ".06em", textTransform: "uppercase",
  color: INK.muted, marginBottom: 6,
};
const SIDE_CARD: CSSProperties = {
  padding: "6px 8px", marginBottom: 6, background: "#F4F6F9", borderRadius: 3,
};

/* =============================================================== treemap = */
/** What a tile's area stands for. Colour follows: on-track share for `count`,
 *  value attainment (actuals / CY target) for either financial measure. */
export type TreemapMeasure = "count" | "target" | "actual";

type ValueFigures = Pick<TreeNode, "value_musd" | "actual_ytd_musd" | "actual_fy_musd">;
/** The node's actuals on the selected basis, in $M. */
const actualOf = (n: ValueFigures, basis: ActualsBasis) => n[actualKey(basis)];

const sizeFor = (m: TreemapMeasure, basis: ActualsBasis) => (n: TreeNode): number =>
  m === "count" ? n.count : m === "target" ? n.value_musd : actualOf(n, basis);

/** Actuals / target, or null when there is no target to measure against. */
function attainment(targetMusd: number, actualMusd: number): number | null {
  return targetMusd > 0 ? actualMusd / targetMusd : null;
}

/** Fill for an attainment ratio. Over-delivery saturates at green; a missing
 *  target gets a neutral grey so it never reads as "0% achieved". */
const NO_TARGET = "#C9D0D9";
function attainmentColour(att: number | null): string {
  return att == null ? NO_TARGET : ratioColour(Math.min(Math.max(att, 0), 1));
}

interface TmRect { n: TreeNode; x: number; y: number; w: number; h: number }

/** Squarified layout (Bruls et al.); items are sized by `sizeOf`. */
function squarify(nodes: TreeNode[], x: number, y: number, w: number, h: number,
  sizeOf: (n: TreeNode) => number): TmRect[] {
  const items = nodes.filter((n) => sizeOf(n) > 0);
  const total = items.reduce((a, n) => a + sizeOf(n), 0);
  const out: TmRect[] = [];
  if (total <= 0 || w <= 0 || h <= 0) return out;
  const queue = items.map((n) => ({ n, area: (sizeOf(n) / total) * w * h }));
  let rx = x, ry = y, rw = w, rh = h;
  const worst = (row: typeof queue, len: number) => {
    const s = row.reduce((a, r) => a + r.area, 0);
    const mx = Math.max(...row.map((r) => r.area));
    const mn = Math.min(...row.map((r) => r.area));
    return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn));
  };
  while (queue.length) {
    const len = Math.min(rw, rh);
    const row: typeof queue = [];
    let best = Infinity;
    while (queue.length) {
      const wst = worst(row.concat([queue[0]]), len);
      if (row.length === 0 || wst <= best) { best = wst; row.push(queue.shift()!); }
      else break;
    }
    const rowArea = row.reduce((a, r) => a + r.area, 0);
    if (rw <= rh) {
      const strip = rowArea / rw || 0;
      let cx = rx;
      for (const r of row) { const cw = r.area / (strip || 1); out.push({ n: r.n, x: cx, y: ry, w: cw, h: strip }); cx += cw; }
      ry += strip; rh -= strip;
    } else {
      const strip = rowArea / rh || 0;
      let cy = ry;
      for (const r of row) { const ch = r.area / (strip || 1); out.push({ n: r.n, x: rx, y: cy, w: strip, h: ch }); cy += ch; }
      rx += strip; rw -= strip;
    }
  }
  return out;
}

/** Per-tile figures for the active measure: fill, bar width, caption, stat. */
function tileFigures(n: TreeNode, measure: TreemapMeasure, basis: ActualsBasis) {
  if (measure === "count") {
    const ratio = n.count ? n.on_track / n.count : 0;
    return {
      fill: ratioColour(ratio), bar: ratio,
      caption: `${n.on_track}/${n.count}`,
      stat: `${n.on_track}/${n.count} on track`,
    };
  }
  const actual = actualOf(n, basis);
  const att = attainment(n.value_musd, actual);
  return {
    fill: attainmentColour(att), bar: Math.min(Math.max(att ?? 0, 0), 1),
    caption: `${fmt.musd(actual)} / ${fmt.musd(n.value_musd)}`,
    stat: att == null ? "no target" : `${Math.round(att * 100)}% of target`,
  };
}

/**
 * Hover card shared by treemap tiles and decomposition-tree nodes. Two titled
 * blocks -- Delivery (on track) and Value (actuals vs target). `lead` puts
 * one first; on the treemap that's whatever the toggle shows, so switching it
 * never hides information, only reorders it. The leading figure of each block
 * carries a swatch in the same colour as the bar it explains. Both actuals
 * figures are listed; the one `basis` doesn't select is muted.
 */
function nodeCard(n: Pick<TreeNode, "count" | "on_track"> & ValueFigures,
  label: string, trail: string[], lead: "delivery" | "value", basis: ActualsBasis,
  hint?: string) {
  const ratio = n.count ? n.on_track / n.count : 0;
  const actual = actualOf(n, basis);
  const att = attainment(n.value_musd, actual);
  const gap = actual - n.value_musd;
  const value = (
    <div className="tt-rows" key="value">
      <div className="tt-sec">Value</div>
      <TooltipRow color={attainmentColour(att)} label="% of CY target"
        value={att == null ? "no target" : fmt.pct(100 * att, 0)} />
      <TooltipRow label={ACTUALS_LABEL.ytd} value={fmt.musd(n.actual_ytd_musd)}
        muted={basis !== "ytd"} />
      <TooltipRow label={ACTUALS_LABEL.fy} value={fmt.musd(n.actual_fy_musd)}
        muted={basis !== "fy"} />
      <TooltipRow label="CY target" value={fmt.musd(n.value_musd)} />
      {att != null && (
        <TooltipRow label={gap >= 0 ? "Above target" : "Gap to target"}
          value={fmt.musd(Math.abs(gap))} />
      )}
    </div>
  );
  const delivery = (
    <div className="tt-rows" key="delivery">
      <div className="tt-sec">Delivery</div>
      <TooltipRow color={ratioColour(ratio)} label="On track"
        value={`${n.on_track} of ${n.count} (${Math.round(ratio * 100)}%)`} />
      <TooltipRow label="Initiatives" value={fmt.int(n.count)} />
    </div>
  );
  return (
    <div className="tt-card">
      <div className="tt-head"><span className="tt-title">{label}</span></div>
      {trail.length > 0 && <div className="tt-sub">{trail.join(" \u203A ")}</div>}
      {lead === "delivery" ? [delivery, value] : [value, delivery]}
      {hint && <div className="tt-foot">{hint}</div>}
    </div>
  );
}

type TooltipApi = ReturnType<typeof useChartTooltip>;

function drawTreemap(nodes: TreeNode[], x: number, y: number, w: number, h: number,
  registry: Registry | undefined, measure: TreemapMeasure, basis: ActualsBasis,
  tooltip: TooltipApi, trail: string[] = []): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  for (const c of squarify(nodes, x, y, w, h, sizeFor(measure, basis))) {
    const n = c.n;
    const label = display(registry, n.dimension, n.name);
    const f = tileFigures(n, measure, basis);
    const hover = {
      onMouseEnter: (e: React.MouseEvent) => tooltip.show(e,
        nodeCard(n, label, trail, measure === "count" ? "delivery" : "value", basis)),
      onMouseMove: tooltip.move,
      onMouseLeave: tooltip.hide,
    };
    const key = `${n.dimension}:${n.name}:${Math.round(c.x)}:${Math.round(c.y)}`;
    if (n.children?.length) {
      const cap = Math.min(20, Math.max(0, c.h * 0.42));
      out.push(
        <div key={key} className="tm-node tm-group"
          style={{ left: c.x, top: c.y, width: c.w, height: c.h }}>
          {c.h > 16 && c.w > 26 && (
            <div className="tm-cap" style={{ height: cap }} {...hover}>
              {label} · {f.caption}
            </div>
          )}
        </div>,
      );
      if (c.h > cap + 10 && c.w > 10)
        out.push(...drawTreemap(n.children, c.x + 1, c.y + cap + 1, c.w - 2, c.h - cap - 2,
          registry, measure, basis, tooltip, [...trail, label]));
    } else {
      // A border-box can't shrink below its padding + border (~14px), so a
      // sliver tile would render taller than its slot and spill past the
      // group's edge. Drop the padding (and, below 3px, the border) instead.
      const tiny = c.h < 16 || c.w < 16;
      const sliver = c.h < 3 || c.w < 3;
      out.push(
        <div key={key} className={`tm-node tm-leaf${tiny ? " tm-tiny" : ""}${sliver ? " tm-sliver" : ""}`}
          {...hover}
          style={{ left: c.x, top: c.y, width: c.w, height: c.h, background: f.fill }}>
          {c.h > 30 && c.w > 46 && <div className="lf-name">{label}</div>}
          {c.h > 52 && c.w > 46 && (
            <div>
              <div className="lf-stat">{f.stat}</div>
              <div className="tm-bar"><i style={{ width: `${Math.round(f.bar * 100)}%` }} /></div>
            </div>
          )}
        </div>,
      );
    }
  }
  return out;
}

/** Top-level groups with nothing to draw under `measure` (no target, no
 *  actuals) -- their initiatives are left off the map, so say how many. */
function omittedCount(nodes: TreeNode[], measure: TreemapMeasure, basis: ActualsBasis): number {
  const size = sizeFor(measure, basis);
  return nodes.reduce((a, n) => a + (size(n) > 0
    ? (n.children?.length ? omittedCount(n.children, measure, basis) : 0)
    : n.count), 0);
}

/**
 * Nested status treemap. `count`: size = initiative count, colour = share on
 * track. `target` / `actual`: size = that $ value, colour = actuals (on the
 * `actuals` basis) as a share of CY target (grey where a group has no target).
 */
export function StatusTreemap({ nodes, registry, measure = "count", actuals = "ytd",
  height = 580 }: {
  nodes: TreeNode[]; registry?: Registry; measure?: TreemapMeasure;
  actuals?: ActualsBasis; height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tooltip = useChartTooltip();
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tiles = useMemo(
    () => (width ? drawTreemap(nodes, 0, 0, width, height, registry, measure, actuals,
      tooltip) : []),
    [nodes, registry, width, height, measure, actuals, tooltip]);
  const omitted = useMemo(() => omittedCount(nodes, measure, actuals),
    [nodes, measure, actuals]);
  const money = measure !== "count";
  const what = measure === "target" ? "target" : ACTUALS_LABEL[actuals].toLowerCase();
  return (
    <>
      <div ref={ref} className="treemap" style={{ height }}>
        {tiles.length ? tiles
          : width > 0 && <div style={{ padding: 22, color: INK.muted }}>
            {money ? `No initiatives carry ${what} under the current filters.`
              : "No initiatives match the current filters."}
          </div>}
      </div>
      <div className="tm-legend">
        {money ? (
          <>
            <span>Value attainment ({ACTUALS_LABEL[actuals].toLowerCase()} ÷ CY target)</span>
            <span>0%</span><span className="grad" /><span>≥100%</span>
            <span className="swatch" style={{ background: NO_TARGET }} /><span>no target</span>
            <span style={{ flex: 1 }} />
            <span style={{ marginLeft: 14 }}>Caption shows <b>actuals / target</b> per group</span>
          </>
        ) : (
          <>
            <span>On-track share</span>
            <span>0% (all off-track)</span><span className="grad" /><span>100% (all on-track)</span><span style={{ flex: 1 }} />
            <span style={{ marginLeft: 14 }}>Caption shows <b>on-track / total</b> per group</span>
          </>
        )}
      </div>
      {money && omitted > 0 && (
        <div className="tm-legend">
          {fmt.int(omitted)} initiative{omitted === 1 ? "" : "s"} with no {what}
          {" "}{omitted === 1 ? "is" : "are"} not drawn.
        </div>
      )}
    </>
  );
}

/* ==================================================== decomposition tree = */
/**
 * Click-to-drill along an editable path.
 *
 * Columns are dimensions; nodes are values. Clicking a node filters everything
 * to its right, so you can walk "BU -> Stage -> Lever" and watch the on-track
 * share and value attainment collapse at each step. Both sit on every node
 * rather than behind a toggle: the point is comparing along a path, and a
 * toggle would mean walking it twice. Depth grows by drilling: clicking a node in the
 * deepest column also appends the next unused dimension, so the path extends as
 * far as you keep clicking. Each level's dimension can then be swapped or the
 * level removed from its column header. The parent owns all of that state.
 *
 * Grouping comes from the same /analytics/tree endpoint that feeds the
 * treemap, so the two views can never disagree about a shared path.
 */

/** Same shape the SplitPicker's options take. */
export interface DimOption {
  value: string;
  label: string;
}

/** Red -> amber -> green, matching the --bad / --warn / --good CSS tokens. */
function ratioColour(p: number): string {
  const stops: [number, [number, number, number]][] = [
    [0, [224, 62, 45]],      // --bad  #E03E2D
    [0.5, [232, 169, 60]],   // --warn #E8A93C
    [1, [31, 169, 113]],     // --good #1FA971
  ];
  let a = stops[0];
  let b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (p >= stops[i][0] && p <= stops[i + 1][0]) {
      a = stops[i];
      b = stops[i + 1];
      break;
    }
  }
  const t = (p - a[0]) / (b[0] - a[0] || 1);
  const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * The readout shared by the root and every node, in three tiers:
 *   1. name, with the initiative count as the headline figure under it;
 *   2. a hairline;
 *   3. one metric per measure -- label and figures on one line, a full-width
 *      bar beneath. Bars span the card so every node in a column draws them
 *      at the same length, and the label is what tells the two apart.
 */
function NodeBody({ name, count, onTrack, valueMusd, actualMusd, accent }: {
  name: string; count: number; onTrack: number; valueMusd: number;
  /** actuals YTD; the hover card adds actuals + forecast */
  actualMusd: number; accent?: boolean;
}) {
  const ratio = count ? onTrack / count : 0;
  const att = attainment(valueMusd, actualMusd);
  const width = (v: number) => `${Math.round(Math.min(Math.max(v, 0), 1) * 100)}%`;
  return (
    <>
      <span className={accent ? "dn-name accent" : "dn-name"}>{name}</span>
      <span className="dn-total">
        <span className="dn-count">{fmt.int(count)}</span>
        <span className="dn-unit">initiative{count === 1 ? "" : "s"}</span>
      </span>
      <span className="dn-metrics">
        <span className="dn-metric">
          <span className="dn-mhead">
            <span className="dn-ml">On track</span>
            <span className="dn-fig">{onTrack}/{count}<b>{Math.round(ratio * 100)}%</b></span>
          </span>
          <span className="dn-bar"><i style={{ width: width(ratio), background: ratioColour(ratio) }} /></span>
        </span>
        <span className="dn-metric">
          <span className="dn-mhead">
            <span className="dn-ml" title={`${ACTUALS_LABEL.ytd} / CY target`}>Value</span>
            <span className="dn-fig">
              {att == null
                ? <>{fmt.musd(actualMusd)}<b>no target</b></>
                : <>{fmt.musd(actualMusd)} / {fmt.musd(valueMusd)}<b>{Math.round(att * 100)}%</b></>}
            </span>
          </span>
          <span className="dn-bar"><i style={{ width: width(att ?? 0), background: attainmentColour(att) }} /></span>
        </span>
      </span>
    </>
  );
}

function Node({ node, active, drillLabel, onClick, labelFor, trail }: {
  node: TreeNode;
  active: boolean;
  /** Labels of the selected nodes above this one, for the hover card. */
  trail: string[];
  /** Label of the dimension this node breaks down into; absent = leaf. */
  drillLabel: string | undefined;
  onClick: () => void;
  labelFor: (dim: string, code: string) => string;
}) {
  const tooltip = useChartTooltip();
  const label = labelFor(node.dimension, node.name);
  const hint = !drillLabel ? undefined
    : active ? `Click again to collapse` : `Click to break down by ${drillLabel}`;
  return (
    <button
      type="button"
      className={`dc-node${active ? " active" : ""}${drillLabel ? " drillable" : ""}`}
      aria-expanded={drillLabel ? active : undefined}
      onClick={onClick}
      onMouseEnter={(e) => tooltip.show(e, nodeCard(node, label, trail, "delivery", "ytd", hint))}
      onMouseMove={tooltip.move}
      onMouseLeave={tooltip.hide}
    >
      <NodeBody name={label} count={node.count} onTrack={node.on_track}
        valueMusd={node.value_musd} actualMusd={node.actual_ytd_musd} />
      {drillLabel && (
        <i className="dn-chev" aria-hidden="true">{active ? "‹" : "›"}</i>
      )}
    </button>
  );
}

/** Backend guard: 1 <= len(levels) <= 5. */
const MAX_LEVELS = 5;

export function DecompositionTree({
  levels, path, nodes, total, onTrack, valueMusd, actualYtdMusd, actualFyMusd,
  dimensions, labelFor,
  onLevelChange, onRemoveLevel, onAddLevel, onSelect,
}: {
  levels: string[];
  path: string[];
  nodes: TreeNode[];
  total: number;
  onTrack: number;
  valueMusd: number;
  actualYtdMusd: number;
  actualFyMusd: number;
  dimensions: DimOption[];
  labelFor: (dim: string, code: string) => string;
  onLevelChange: (index: number, dim: string) => void;
  onRemoveLevel: (index: number) => void;
  /** Fired alongside `onSelect` when a click drills past the deepest level. */
  onAddLevel: (dim: string) => void;
  onSelect: (index: number, value: string) => void;
}) {
  const tooltip = useChartTooltip();

  // Walk down the selected path, emitting one column per level. The walk stops
  // early when a level has no selection, so deeper columns simply don't render.
  const columns: { dim: string; nodes: TreeNode[]; active: string | undefined }[] = [];
  let current: TreeNode[] | undefined = nodes;
  for (let i = 0; i < levels.length; i++) {
    if (!current) break;
    columns.push({ dim: levels[i], nodes: current, active: path[i] });
    current = path[i]
      ? current.find((n) => n.name === path[i])?.children ?? undefined
      : undefined;
  }

  /* Levels grow by drilling, not by a separate picker: clicking a node in the
     deepest column appends the first unused dimension and selects the node in
     one go. A trailing "add level" select couldn't work here -- a level with no
     selection above it has nothing to show, so appending one rendered nothing
     until you happened to click the right node anyway. */
  // Column i's nodes sit under the selections in columns 0..i-1.
  const trails = columns.map((_, i) =>
    columns.slice(0, i).map((c, j) => labelFor(levels[j], c.active ?? "")));

  const spawnDim = levels.length < MAX_LEVELS
    ? dimensions.find((d) => !levels.includes(d.value))?.value
    : undefined;
  const labelOfDim = (dim: string | undefined) =>
    dim ? dimensions.find((d) => d.value === dim)?.label ?? dim : undefined;

  return (
    <div className="dctree">
      <div className="dc-col dc-root">
        <div className="dc-colhead">
          <span className="dc-colttl">All initiatives</span>
        </div>
        <div
          className="dc-node active"
          aria-current="true"
          onMouseEnter={(e) => tooltip.show(e, nodeCard(
            { count: total, on_track: onTrack, value_musd: valueMusd,
              actual_ytd_musd: actualYtdMusd, actual_fy_musd: actualFyMusd },
            "All initiatives", [], "delivery", "ytd"))}
          onMouseMove={tooltip.move}
          onMouseLeave={tooltip.hide}
        >
          <NodeBody name="All initiatives" count={total} onTrack={onTrack}
            valueMusd={valueMusd} actualMusd={actualYtdMusd} accent />
        </div>
      </div>

      {columns.map((col, i) => {
        const last = i === levels.length - 1;
        // Deeper levels already exist; the last column drills into a new one.
        const drillDim = last ? spawnDim : levels[i + 1];
        const drillLabel = labelOfDim(drillDim);
        return (
          <div className="dc-col" key={`${col.dim}-${i}`}>
            <div className="dc-colhead">
              <select className="dc-dim" value={col.dim} aria-label={`Level ${i + 1} field`}
                onChange={(e) => onLevelChange(i, e.target.value)}>
                {dimensions.map((d) => (
                  <option key={d.value} value={d.value}
                    disabled={levels.includes(d.value) && d.value !== col.dim}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button type="button" className="dc-x" onClick={() => onRemoveLevel(i)}
                title="Remove this level and everything deeper"
                aria-label="Remove this level"
                disabled={levels.length <= 1}>
                &times;
              </button>
            </div>
            {col.nodes.map((n) => {
              const active = col.active === n.name;
              return (
                <Node key={n.name} node={n} active={active} labelFor={labelFor}
                  drillLabel={drillLabel} trail={trails[i]}
                  onClick={() => {
                    onSelect(i, n.name);
                    if (!active && last && spawnDim) onAddLevel(spawnDim);
                  }} />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================ slope chart = */
/**
 * Rank movement between two snapshots, as two columns of labelled nodes joined
 * where an initiative carried over.
 *
 * Hand-rolled like the funnel, and for the same reason: the layout is
 * positional, not scaled. Rows are rank order and columns are the two
 * snapshots, so there is no axis to compute and nothing for a chart library to
 * do -- while the things that carry the meaning here (a name, a value and a
 * delta inside each box) are exactly what a line chart cannot show without a
 * hover. The earlier Recharts version put every name in a legend gutter.
 *
 * Paint is set through attributes rather than CSS classes so the html2canvas
 * PDF path keeps it: that serializes inline SVG into an image and drops rules
 * from our stylesheets.
 */
const STATUS_COLOUR: Record<string, string> = {
  carried: "#2C6E9B", new: "#1FA971", fell_out: "#E8A93C", discontinued: "#E03E2D",
};

const STATUS_LABEL: Record<string, string> = {
  carried: "● carried over", new: "★ new entrant",
  fell_out: "↓ fell out of top-10", discontinued: "✕ discontinued",
};

const NODE_W = 300;
const NODE_H = 30;
const ROW_H = 40;
const PAD_TOP = 34;
const SVG_W = 960;

/**
 * Where each connector carries its delta label, as bezier parameters.
 *
 * The label is drawn twice, once near the leaving node and once near the
 * receiving one. Hugging the ends is the whole point: there a connector is
 * still close to its own row, so the labels inherit the row pitch and stay
 * apart. A single label at the midpoint is unreadable, because that is exactly
 * where every connector in the BU converges.
 *
 * 0.08 is the tuned compromise at ROW_H 40: far enough along the curve for the
 * pill to clear the node box, early enough that two adjacent rows swinging
 * opposite ways still stay 25px apart -- more than the 18px pill. Pushing it
 * later reintroduces the pile-up (0.12 drops that gap to 8px).
 */
const PILL_T = [0.08, 0.92];

const cubic = (t: number, p0: number, p1: number, p2: number, p3: number) => {
  const u = 1 - t;
  return u ** 3 * p0 + 3 * u ** 2 * t * p1 + 3 * u * t ** 2 * p2 + t ** 3 * p3;
};

/** Names are drawn into a fixed-width box, so the full text lives in a <title>. */
function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function SlopeChart({ aItems, bItems, movements, labelA, labelB }: {
  aItems: TopItem[]; bItems: TopItem[]; movements: TopMovement[];
  labelA: string; labelB: string;
}) {
  const rows = Math.max(aItems.length, bItems.length);
  const height = PAD_TOP + rows * ROW_H + 14;
  const leftX = 6;
  const rightX = SVG_W - 6 - NODE_W;
  const cy = (i: number) => PAD_TOP + i * ROW_H + NODE_H / 2;

  // Keyed on rank: build_top matches by Initiative ID and emits at most one
  // movement per rank on each side.
  const byA = new Map(movements.filter((m) => m.a_rank != null)
    .map((m) => [m.a_rank, m]));
  const byB = new Map(movements.filter((m) => m.b_rank != null)
    .map((m) => [m.b_rank, m]));

  const node = (item: TopItem, x: number, i: number, side: "a" | "b") => {
    const status = side === "a"
      ? byA.get(item.rank)?.status ?? "carried"
      : byB.get(item.rank)?.status === "new" ? "new" : "carried";
    const colour = STATUS_COLOUR[status] ?? INK.muted;
    const mv = side === "a" ? byA.get(item.rank) : byB.get(item.rank);
    const renamed = side === "b" && Boolean(mv?.renamed);
    const sub = [
      item.source_initiative_id,
      status !== "carried" ? STATUS_LABEL[status] : renamed ? "Renamed" : null,
    ].filter(Boolean).join(" · ");
    return (
      <g key={`${side}-${item.rank}`}
        transform={`translate(${x},${PAD_TOP + i * ROW_H})`}>
        <rect width={NODE_W} height={NODE_H} rx={7} fill={INK.inverse}
          stroke={colour} />
        <circle cx={16} cy={NODE_H / 2} r={10.5} fill={colour} />
        <text x={16} y={NODE_H / 2 + 4} textAnchor="middle" fontSize={11}
          fontWeight={700} fill={INK.inverse}>
          {item.rank}
        </text>
        <text x={33} y={NODE_H / 2 - 1} fontSize={11} fill={INK.strong}>
          <title>
            {[item.source_initiative_id, item.name].filter(Boolean).join(" · ")}
            {renamed && mv?.prev_name ? `\nPreviously: ${mv.prev_name}` : ""}
          </title>
          {clip(item.name, 32)}
        </text>
        {sub && (
          <text x={33} y={NODE_H - 5} fontSize={9}
            fill={status !== "carried" ? colour : INK.muted}>
            {sub}
          </text>
        )}
        <text x={NODE_W - 8} y={NODE_H / 2 + 4} textAnchor="end" fontSize={11}
          fontWeight={600} fill={INK.strong}>
          {fmt.musd(item.value_musd)}
        </text>
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${SVG_W} ${height}`} width="100%" height={height}
      role="img" aria-label={`Top-${rows} movement, ${labelA} to ${labelB}`}>
      <text x={leftX + NODE_W / 2} y={18} textAnchor="middle" fontSize={11}
        fontWeight={600} fill={INK.muted}>
        {labelA}
      </text>
      <text x={rightX + NODE_W / 2} y={18} textAnchor="middle" fontSize={11}
        fontWeight={600} fill={INK.muted}>
        {labelB}
      </text>

      {/* Connectors first, so the boxes sit above them. */}
      {aItems.map((item, i) => {
        const mv = byA.get(item.rank);
        if (mv?.status !== "carried" || mv.b_rank == null) {
          return (
            <path key={`c-${i}`} d={`M${leftX + NODE_W} ${cy(i)} l 26 0`}
              fill="none" strokeWidth={2} strokeDasharray="4 3"
              stroke={STATUS_COLOUR[mv?.status ?? ""] ?? INK.muted} />
          );
        }
        const y1 = cy(i);
        const y2 = cy(mv.b_rank - 1);
        const x1 = leftX + NODE_W;
        const mx = (x1 + rightX) / 2;
        const d = mv.delta_musd ?? 0;
        const label = fmt.delta(d, "M");
        const pillW = Math.max(30, label.length * 7 + 8);
        const tone = d > 0 ? STATUS_COLOUR.new : d < 0 ? STATUS_COLOUR.discontinued
          : INK.muted;
        return (
          <g key={`c-${i}`}>
            <path d={`M${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${rightX} ${y2}`}
              fill="none" stroke={STATUS_COLOUR.carried} strokeWidth={2}
              strokeOpacity={0.55} />
            {PILL_T.map((t) => (
              <g key={t}
                transform={`translate(${cubic(t, x1, mx, mx, rightX) - pillW / 2},${
                  cubic(t, y1, y1, y2, y2) - 9})`}>
                <rect width={pillW} height={18} rx={9} fill={INK.inverse}
                  stroke={tone} />
                <text x={pillW / 2} y={13} textAnchor="middle" fontSize={10}
                  fontWeight={600} fill={tone}>
                  {label}
                </text>
              </g>
            ))}
          </g>
        );
      })}

      {aItems.map((item, i) => node(item, leftX, i, "a"))}
      {bItems.map((item, i) => node(item, rightX, i, "b"))}
    </svg>
  );
}

export function StatusLegend() {
  return (
    <div className="legend sm">
      {Object.entries(STATUS_COLOUR).map(([k, c]) => (
        <span key={k}><i style={{ background: c }} />{k.replace("_", " ")}</span>
      ))}
    </div>
  );
}

/* =============================================================== heat cell = */
/**
 * Colour ramp for the BU x lever matrix. Kept as CSS on a real <table> rather
 * than a chart library heatmap: it is fewer lines, it is selectable text, and
 * screen readers can read it.
 */
export function heat(value: number, max: number): { background: string; color: string } {
  if (!max || !value) return { background: "transparent", color: "#8A94A2" };
  const t = Math.min(value / max, 1);
  return {
    background: `rgba(44,110,155,${(0.08 + t * 0.72).toFixed(3)})`,
    color: t > 0.55 ? "#fff" : "#1B2733",
  };
}

/**
 * Colour for a completeness cell, the inverse emphasis of `heat()`: a complete
 * cell stays quiet and a gap gets the colour, so the eye lands on what needs
 * chasing. Bands match `toneOf` on the Data quality page (≥90 / ≥75); below
 * 75 the red deepens as the score falls.
 */
export function gapHeat(pct: number | undefined): { background: string; color: string } {
  if (pct === undefined) return { background: "transparent", color: "#8A94A2" };
  if (pct >= 90) return { background: "transparent", color: "#1B2733" };
  if (pct >= 75) return { background: "rgba(232,169,60,.20)", color: "#8A6410" };
  const t = Math.min((75 - pct) / 75, 1);
  return { background: `rgba(224,62,45,${(0.14 + t * 0.4).toFixed(3)})`, color: "#8E2419" };
}
