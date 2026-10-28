/**
 * UI kit: period selection, layout atoms, the generic data grid, and the
 * print/PDF section registry.
 *
 * THE PERIOD CONTEXT IS THE POINT OF THIS FILE.
 *
 * The old build treated "Q1 vs Q2" as a fact about the world: a tab label, a
 * default env var, and three route defaults. Here, the selected window lives in
 * exactly one place -- `PeriodProvider` -- and is:
 *
 *   discovered  from /api/meta/periods (what data actually exists),
 *   overridable by the user through <PeriodBar/>,
 *   shareable   because it round-trips through the URL query string,
 *   sticky      because the last choice is remembered per browser.
 *
 * Every page reads `usePeriod()`. No page may name a quarter.
 *
 * The filter bar is the second shared context (`FilterProvider`): Portfolio
 * and Comparison read one selection, so it survives switching tabs. It also
 * carries the Actuals toggle -- YTD, or YTD plus the forecast months.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "react-router-dom";
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel,
  getSortedRowModel, useReactTable,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";

import {
  useMeta, usePeriods, type PeriodOptions, type Registry, type Scope,
} from "./api";

/* ======================================================== period context = */
export type CompareMode = "sequential" | "yoy" | "plan" | "custom";
const MODES: CompareMode[] = ["sequential", "yoy", "plan", "custom"];

interface PeriodState {
  snapshot?: string;          // the "current" side, B
  baseline?: string;          // the comparison side, A -- computed from mode
                               // for every mode except "custom"
  mode: CompareMode;
  setMode: (m: CompareMode) => void;
  options?: PeriodOptions;
  ready: boolean;
  set: (next: Partial<Pick<PeriodState, "snapshot" | "baseline">>) => void;
  label: (code?: string) => string;
}

const Ctx = createContext<PeriodState | null>(null);
const STORAGE = "cockpit.period";

/**
 * Resolves the comparison baseline for a mode -- never a stored literal
 * pair. `sequential` walks back to the previous snapshot of the same
 * period_type by sort_key; `yoy` matches the same period_type + ordinal one
 * fiscal year back; `plan` is the pinned + is_baseline snapshot for the
 * fiscal year; `custom` is whatever the user picked manually.
 */
function resolveBaseline(mode: CompareMode, snapshotId: string | undefined,
                         options: PeriodOptions | undefined,
                         manualBaseline: string | undefined): string | undefined {
  if (mode === "custom") return manualBaseline;
  if (!snapshotId || !options) return undefined;
  const target = options.snapshots.find((s) => s.id === snapshotId);
  if (!target) return undefined;

  if (mode === "sequential") {
    const earlier = options.snapshots
      .filter((s) => s.period_type === target.period_type && s.sort_key < target.sort_key);
    return earlier.length ? earlier[earlier.length - 1].id : undefined;
  }
  if (mode === "yoy") {
    return options.snapshots.find((s) =>
      s.fiscal_year === target.fiscal_year - 1 && s.period_type === target.period_type
      && s.period_ordinal === target.period_ordinal)?.id;
  }
  // plan
  return options.pinned.find((s) =>
    s.is_baseline && s.fiscal_year === target.fiscal_year)?.id;
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const { data: options } = usePeriods();
  const [params, setParams] = useSearchParams();
  const [touched, setTouched] = useState(false);

  const remembered = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE) ?? "{}"); }
    catch { return {}; }
  }, []);

  // Precedence: URL  >  last used  >  what the server says is current.
  // A code that no longer exists in the data is dropped rather than trusted --
  // otherwise a stale bookmark silently reports an empty quarter.
  const valid = (c?: string | null) =>
    c && options?.snapshots.some((s) => s.id === c) ? c : undefined;

  const snapshot = valid(params.get("snapshot")) ?? valid(remembered.snapshot)
    ?? options?.default_snapshot ?? undefined;

  const snapshotInfo = options?.snapshots.find((s) => s.id === snapshot);
  const modeRaw = (params.get("mode") ?? remembered.mode) as CompareMode | undefined;
  const mode: CompareMode = modeRaw && MODES.includes(modeRaw) ? modeRaw
    : snapshotInfo?.period_type === "FY" ? "yoy" : "sequential";

  const manualBaselineRaw = valid(params.get("baseline")) ?? valid(remembered.baseline)
    ?? options?.default_baseline ?? undefined;
  const manualBaseline = manualBaselineRaw === snapshot
    ? options?.default_baseline ?? undefined : manualBaselineRaw;

  const baseline = resolveBaseline(mode, snapshot, options, manualBaseline);

  const set = useCallback<PeriodState["set"]>((next) => {
    setTouched(true);
    const merged = { snapshot, baseline: manualBaseline, mode, ...next };
    const p = new URLSearchParams(params);
    Object.entries(merged).forEach(([k, v]) =>
      v == null ? p.delete(k) : p.set(k, String(v)));
    setParams(p, { replace: true });
    localStorage.setItem(STORAGE, JSON.stringify(merged));
  }, [snapshot, manualBaseline, mode, params, setParams]);

  const setMode = useCallback((m: CompareMode) => {
    setTouched(true);
    // Switching to "custom" seeds the manual baseline with whatever the
    // previous mode had already resolved, so the picker starts somewhere
    // sane instead of blank.
    const merged = m === "custom"
      ? { snapshot, baseline: baseline ?? manualBaseline, mode: m }
      : { snapshot, baseline: manualBaseline, mode: m };
    const p = new URLSearchParams(params);
    Object.entries(merged).forEach(([k, v]) =>
      v == null ? p.delete(k) : p.set(k, String(v)));
    setParams(p, { replace: true });
    localStorage.setItem(STORAGE, JSON.stringify(merged));
  }, [snapshot, baseline, manualBaseline, params, setParams]);

  const label = useCallback((code?: string) => {
    if (!code) return "—";
    return options?.snapshots.find((s) => s.id === code)?.label ?? code;
  }, [options]);

  const value: PeriodState = {
    snapshot, baseline, mode, setMode, options, set, label,
    ready: Boolean(options && snapshot),
  };
  useEffect(() => { if (!touched && options) { /* first paint uses defaults */ } },
    [touched, options]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePeriod(): PeriodState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePeriod outside PeriodProvider");
  return ctx;
}

/* ======================================================== filter context = */
/** Which actuals figure the visuals read: to the period end, or through
 *  December (the months past the period end are the BU's forecast). */
export type ActualsBasis = "ytd" | "fy";
export const ACTUALS_LABEL: Record<ActualsBasis, string> = {
  ytd: "Actuals YTD", fy: "Actuals + forecast",
};
/** The analytics field holding the chosen actuals figure, in $M. */
export const actualKey = (b: ActualsBasis) =>
  b === "fy" ? "actual_fy_musd" as const : "actual_ytd_musd" as const;
/** The initiative field holding the chosen actuals figure, in USD. */
export const actualField = (b: ActualsBasis) =>
  b === "fy" ? "value_actual_fy" : "value_actual_ytd";

interface FilterState {
  filters: Record<string, string>;
  setFilter: (column: string, value: string) => void;
  search: string;
  setSearch: (s: string) => void;
  /** The bar as sent to the server-side analytics; search is debounced. */
  scope: Scope;
  actuals: ActualsBasis;
  setActuals: (b: ActualsBasis) => void;
  reset: () => void;
}

const FilterCtx = createContext<FilterState | null>(null);
const ACTUALS_STORAGE = "cockpit.actuals";

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [actuals, setActualsState] = useState<ActualsBasis>(() =>
    localStorage.getItem(ACTUALS_STORAGE) === "fy" ? "fy" : "ytd");

  /* Debounced so typing doesn't refetch every analytic per keystroke. */
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);
  const scope: Scope = useMemo(() => ({
    filters: Object.fromEntries(Object.entries(filters).map(([c, v]) => [c, [v]])),
    search: debounced || undefined,
  }), [filters, debounced]);

  const setFilter = useCallback((column: string, value: string) =>
    setFilters((prev) => {
      const next = { ...prev };
      if (value) next[column] = value; else delete next[column];
      return next;
    }), []);
  const setActuals = useCallback((b: ActualsBasis) => {
    setActualsState(b);
    localStorage.setItem(ACTUALS_STORAGE, b);
  }, []);
  const reset = useCallback(() => { setFilters({}); setSearch(""); }, []);

  const value: FilterState = {
    filters, setFilter, search, setSearch, scope, actuals, setActuals, reset,
  };
  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}

export function useFilters(): FilterState {
  const ctx = useContext(FilterCtx);
  if (!ctx) throw new Error("useFilters outside FilterProvider");
  return ctx;
}

/**
 * The picker. Renders whatever periods exist -- two, or twelve.
 * `compare` shows the baseline selector; single-period pages hide it.
 *
 * Snapshots are grouped by fiscal year (spec step 8): only the current year
 * and the pinned tier show by default, so the visible list grows by roughly
 * one row per year rather than one per upload; "Show all years" reveals the
 * rest. Whatever is currently selected stays visible regardless -- picking a
 * value and having it vanish from the control would be worse than the list
 * being long.
 */
export function PeriodBar({ compare = false }: { compare?: boolean }) {
  const { snapshot, baseline, mode, options, set, setMode, label } = usePeriod();
  const [showAllYears, setShowAllYears] = useState(false);
  if (!options) return <div className="periodbar muted sm">Loading periods…</div>;

  const snaps = options.snapshots;
  const single = snaps.length < 2;
  const baselineLocked = mode !== "custom";
  // A draft is only visible to the user who loaded it, so flag it wherever it
  // is driving the page -- the Snapshots page only helps once you go looking.
  const currentIsDraft = snaps.some((s) => s.id === snapshot && s.state === "draft");

  return (
    <div className="periodbar">
      {compare && !single && (
        <>
          <GroupedSnapshotSelect label="Baseline" value={baseline ?? ""} exclude={snapshot}
            onChange={(v) => set({ baseline: v })}
            options={options} showAllYears={showAllYears}
            disabled={baselineLocked}
            title={baselineLocked
              ? `Computed automatically in ${mode} mode — switch Mode to Custom to pick one manually.`
              : undefined} />
          {baselineLocked && (
            <i className="pill sm" title="Switch Mode to Custom to edit the baseline">auto</i>
          )}
          <span className="vs">vs</span>
        </>
      )}
      <GroupedSnapshotSelect label={compare ? "Current" : "Snapshot"} value={snapshot ?? ""}
        onChange={(v) => set({ snapshot: v, baseline: v === baseline ? undefined : baseline })}
        options={options} showAllYears={showAllYears} />
      {currentIsDraft && (
        <i className="pill sm warn"
          title="Unpublished draft — only you can see this snapshot. Publish it from the Snapshots page.">
          draft
        </i>
      )}
      {options.by_year.length > 1 && (
        <label className="check sm">
          <input type="checkbox" checked={showAllYears}
            onChange={(e) => setShowAllYears(e.target.checked)} />
          Show all years
        </label>
      )}
      {compare && !single && options.comparable_pairs.length > 1 && (
        <div className="quickpairs sm">
          {options.comparable_pairs.slice(0, 4).map(([a, b]) => (
            <button key={`${a}${b}`} type="button"
              className={a === baseline && b === snapshot ? "chip on" : "chip"}
              onClick={() => { setMode("custom"); set({ baseline: a, snapshot: b }); }}>
              {label(a)}→{label(b)}
            </button>
          ))}
        </div>
      )}
      {single && <span className="muted sm">Only one snapshot loaded.</span>}
    </div>
  );
}

/** Native `<select>` grouped into `<optgroup>`s by fiscal year, plus a
 * "Pinned" group for anything pinned outside the visible years. */
function GroupedSnapshotSelect({ label, value, onChange, options, showAllYears, exclude,
  disabled, title }: {
  label: string; value: string; onChange: (v: string) => void;
  options: PeriodOptions; showAllYears: boolean; exclude?: string;
  disabled?: boolean; title?: string;
}) {
  const currentYear = options.by_year[0]?.year;
  const visible = showAllYears ? options.by_year
    : options.by_year.filter((g) => g.year === currentYear);
  const shown = new Set(visible.flatMap((g) => g.snapshots.map((s) => s.id)));

  // Whatever is currently selected, or pinned, stays visible even when its
  // year is collapsed -- pinning is what keeps YoY anchors reachable without
  // keeping every year reachable.
  const extra = options.snapshots.filter((s) =>
    !shown.has(s.id) && (s.id === value || options.pinned.some((p) => p.id === s.id)));

  const groups = [...visible.map((g) => ({ year: g.year, snapshots: g.snapshots })),
    ...(extra.length ? [{ year: null, snapshots: extra }] : [])];

  return (
    <label className={`field${disabled ? " locked" : ""}`} title={title}>
      <span className="sm muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        disabled={disabled}>
        {groups.map((g) => (
          <optgroup key={g.year ?? "pinned"} label={g.year ? String(g.year) : "Pinned"}>
            {g.snapshots.filter((s) => s.id !== exclude).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.initiative_count}{s.state === "draft" ? " · draft" : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/* ============================================================== atoms ==== */
export function Select({ label, value, onChange, options, width }: {
  label?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; width?: number;
}) {
  return (
    <label className="field">
      {label && <span className="sm muted">{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        style={width ? { width } : undefined}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Kpi({ label, value, sub, tone }: {
  label: string; value: ReactNode; sub?: ReactNode;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className={`kpi${tone ? ` ${tone}` : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-foot">{sub}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, flush }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`panel${flush ? " flush" : ""}${className ? ` ${className}` : ""}`}>
      {(title || actions) && (
        <header className="panel-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Loading({ what = "data" }: { what?: string }) {
  return <div className="state muted">Loading {what}…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state muted">{children}</div>;
}

/** `prefix` exists because the same component reports both failed reads and
 *  failed writes, and "Could not load" reads wrong for a rejected save. */
export function Problem({ error, prefix = "Could not load" }: { error: unknown; prefix?: string }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="state bad">{prefix}: {msg}</div>;
}

/** Renders children only when the period context has resolved a window. */
export function WhenReady({ children }: { children: ReactNode }) {
  const { ready, options } = usePeriod();
  if (options && options.snapshots.length === 0) {
    return <Empty>No snapshots loaded yet. Upload a register on the
      <b> Snapshots</b> tab to get started.</Empty>;
  }
  return ready ? <>{children}</> : <Loading what="periods" />;
}

/**
 * The shared filter bar: every registry `filterable` field, search, reset and
 * the Actuals toggle. `count` is the page's own "n of m shown" line.
 */
export function FilterBar({ count }: { count?: ReactNode }) {
  const { data: meta } = useMeta();
  const registry = meta?.registry;
  const { filters, setFilter, search, setSearch, actuals, setActuals, reset } = useFilters();
  return (
    <div className="panel filterbar-panel">
      <div className="filterbar">
        {registry?.fields.filter((f) => f.filterable).map((f) => (
          <Select key={f.column} label={f.label}
            value={filters[f.column] ?? ""}
            onChange={(v) => setFilter(f.column, v)}
            options={[{ value: "", label: "All" },
              ...(f.vocab ? registry.vocab[f.vocab].terms.map((t) => ({
                value: t.code, label: t.label })) : [])]} />
        ))}
        <label className="field grow">
          <span className="sm muted">Search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="ID, name, owner, KPI…" />
        </label>
        <div className="field">
          <span className="sm muted">Actuals</span>
          <div className="seg" role="group" aria-label="Actuals basis">
            {(["ytd", "fy"] as const).map((b) => (
              <button key={b} type="button" aria-pressed={actuals === b}
                className={actuals === b ? "on" : undefined}
                title={b === "ytd" ? "Monthly financial actuals to the snapshot's period end"
                  : "Actuals to the period end plus the forecast months through December"}
                onClick={() => setActuals(b)}>
                {b === "ytd" ? "YTD" : "+ Forecast"}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="ghost" onClick={reset}>
          Reset
        </button>
      </div>
      {count && <p className="muted sm filter-count">{count}</p>}
    </div>
  );
}

/* ================================================== print/PDF registry === */
interface PrintCtx {
  register: (id: string, label: string) => void;
  unregister: (id: string) => void;
  sections: { id: string; label: string; included: boolean }[];
  setIncluded: (id: string, included: boolean) => void;
}
const Print = createContext<PrintCtx | null>(null);
const INCLUDED_STORAGE = "cockpit.pdf-bundle-included";

export function PrintProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<{ id: string; label: string }[]>([]);
  const [included, setIncludedMap] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(INCLUDED_STORAGE) ?? "{}"); }
    catch { return {}; }
  });

  const setIncluded = useCallback((id: string, value: boolean) => {
    setIncludedMap((m) => {
      const next = { ...m, [id]: value };
      localStorage.setItem(INCLUDED_STORAGE, JSON.stringify(next));
      return next;
    });
  }, []);

  const register = useCallback((id: string, label: string) =>
    setSections((s) => (s.some((x) => x.id === id) ? s : [...s, { id, label }])), []);
  const unregister = useCallback((id: string) =>
    setSections((s) => s.filter((x) => x.id !== id)), []);

  const withIncluded = useMemo(
    () => sections.map((s) => ({ ...s, included: included[s.id] ?? true })),
    [sections, included],
  );

  return (
    <Print.Provider value={{ register, unregister, sections: withIncluded, setIncluded }}>
      {children}
    </Print.Provider>
  );
}

export function usePrintSections() {
  return useContext(Print)?.sections ?? [];
}

export function usePrintSetIncluded() {
  const ctx = useContext(Print);
  return useCallback((id: string, included: boolean) => ctx?.setIncluded(id, included),
    [ctx]);
}

/**
 * Anything wrapped here self-registers with the PDF dialog. Kept hand-rolled:
 * it is 20 lines, it has no library equivalent that is not a whole print
 * framework, and it is the seam the exporter walks.
 *
 * Each section carries its own "Include in PDF bundle" checkbox so a user can
 * mark it up while browsing; the choice is remembered per browser (localStorage)
 * and is what the print dialog pre-ticks -- it just gives a last chance to edit.
 */
export function PrintSection({ id, label, children, className }: {
  id: string; label: string; children: ReactNode; className?: string;
}) {
  const ctx = useContext(Print);
  useEffect(() => {
    ctx?.register(id, label);
    return () => ctx?.unregister(id);
  }, [id, label]);          // eslint-disable-line react-hooks/exhaustive-deps
  const included = ctx?.sections.find((s) => s.id === id)?.included ?? true;
  return (
    <div id={id} data-print-section={id} data-print-label={label}
      className={className}>
      <label className="print-include" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={included}
          onChange={(e) => ctx?.setIncluded(id, e.target.checked)} />
        <span className="print-icon">🖨</span>
      </label>
      {children}
    </div>
  );
}

/* ============================================================== section = */
/**
 * Collapsible card: chevron heading, optional note, sub-headline blurb and a
 * right-aligned actions slot. Wraps PrintSection so print pagination still
 * treats the whole block as one unit.
 */
export function Section({
  id, title, note, blurb, actions, children, defaultOpen = true,
}: {
  id: string;
  title: string;
  note?: string;
  blurb?: ReactNode;
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

/* ================================================== generic data grid ==== */
/**
 * ONE table component for the whole app, backed by TanStack Table.
 *
 * Replaces four separate hand-written <table> blocks that each reimplemented
 * sorting, and the register table that reimplemented pagination on top. Column
 * definitions are passed in -- and on the Initiatives tab they are *generated
 * from the server's field registry*, which is what keeps a new backend column
 * from needing a frontend change.
 */
export function DataTable<T>({ data, columns, initialSort, pageSize = 25,
  globalFilter, onRowClick, rowClassName, dense }: {
  data: T[];
  columns: ColumnDef<T, any>[];
  initialSort?: SortingState;
  pageSize?: number;
  globalFilter?: string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  dense?: boolean;
}) {
  const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
  const table = useReactTable({
    data, columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    globalFilterFn: "includesString",
  });

  const page = table.getState().pagination.pageIndex;
  const pages = table.getPageCount();

  return (
    <div className="tablewrap">
      <table className={dense ? "grid dense" : "grid"}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} onClick={h.column.getToggleSortingHandler()}
                  className={h.column.getCanSort() ? "sortable" : undefined}
                  style={{ width: h.getSize() === 150 ? undefined : h.getSize() }}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id} onClick={onRowClick ? () => onRowClick(r.original) : undefined}
              className={[onRowClick ? "clickable" : "", rowClassName?.(r.original) ?? ""].join(" ").trim() || undefined}>
              {r.getVisibleCells().map((c) => (
                <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
              ))}
            </tr>
          ))}
          {table.getRowModel().rows.length === 0 && (
            <tr><td colSpan={columns.length} className="muted center">No rows.</td></tr>
          )}
        </tbody>
      </table>
      {pages > 1 && (
        <div className="pager sm">
          <button onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}>‹ Prev</button>
          <span className="muted">Page {page + 1} of {pages}
            {" · "}{table.getFilteredRowModel().rows.length} rows</span>
          <button onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}>Next ›</button>
        </div>
      )}
    </div>
  );
}

/* ============================================== registry-driven helpers == */
/** Human label for a raw cell value, given the server's registry. */
export function display(registry: Registry | undefined, column: string,
  value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const spec = registry?.fields.find((f) => f.column === column);
  if (!spec) return String(value);
  switch (spec.kind) {
    case "vocab": {
      const terms = spec.vocab ? registry?.vocab[spec.vocab]?.terms : undefined;
      return terms?.find((t) => t.code === value)?.label ?? String(value);
    }
    case "money":
      return `$${(Number(value) / 1e6).toFixed(2)}M`;
    case "bool":
      return value ? "Yes" : "No";
    case "date":
      return new Date(String(value)).toLocaleDateString("en-CA");
    case "number":
      return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
    case "int":
      return Number(value).toLocaleString("en-US");
    default:
      return String(value);
  }
}
