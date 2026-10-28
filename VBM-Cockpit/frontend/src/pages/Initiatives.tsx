/**
 * Initiatives — view and edit, synced with the backend.
 *
 * THE WHOLE PAGE IS GENERATED FROM `/api/meta/fields`.
 *
 * There is not a single column name in this file. Grid columns, the editor
 * form, the filter bar and per-field validation are all built from the field
 * registry the server sends at runtime. Add a FieldSpec in
 * `backend/app/registry.py` and it appears here — typed, labelled, grouped into
 * its section and validated — with no change to this file.
 *
 * SYNC MODEL
 *   read    TanStack Query, cached per (snapshot, filters, search)
 *   write   PATCH with only the changed cells, so two people editing different
 *           columns of the same initiative do not clobber each other
 *   echo    optimistic update, server response replaces the row, a failure
 *           rolls the cache back and shows the API's own message
 *   ripple  a successful write invalidates every query, so the treemap, the
 *           KPIs and the data-gaps page all move with the edit
 *
 * A cell the editor has touched is recorded server-side in `edited_fields` and
 * the next Excel load leaves it alone — curation survives ingestion.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import {
  buildTree, useCreateInitiative, useDeleteInitiative, useInitiatives, useMeta,
  usePatchInitiative, type FieldSpec, type Initiative, type Registry,
} from "../api";
import { PageHead } from "../App";
import { DecompositionTree } from "../charts";
import {
  DataTable, Loading, Panel, Problem, Select, WhenReady, display, usePeriod,
} from "../ui";

export default function InitiativesPage() {
  return <WhenReady><Body /></WhenReady>;
}

function Body() {
  const { snapshot, options } = usePeriod();
  const snapInfo = options?.snapshots.find((x) => x.id === snapshot);
  const cutoff = snapInfo ? periodEndMonth(snapInfo.period_type, snapInfo.period_ordinal) : 12;
  const { data: meta } = useMeta();
  const registry = meta?.registry;

  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Initiative | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useInitiatives({
    snapshot, filters, search: search || undefined, include_metrics: true, limit: 5000,
  });

  /* ---- decomposition tree, built from the page's own filtered rows ---- */
  const [dcLevels, setDcLevels] = useState<string[]>(["bu_code", "stage_code"]);
  const [dcPath, setDcPath] = useState<string[]>([]);
  const [sync, setSync] = useState(true);
  const treeRef = useRef<HTMLDivElement>(null);

  const items = data?.items ?? [];
  const onTrackCode = registry?.stage_semantics.on_track ?? "ON";
  const treeNodes = useMemo(() => buildTree(items, dcLevels, onTrackCode),
    [items, dcLevels, onTrackCode]);
  const treeOnTrack = items.filter((r) => r.track_code === onTrackCode).length;
  const treeValue = items.reduce((s, r) => s + Number(r.value_target_cy ?? 0), 0) / 1e6;
  const treeActualYtd = items.reduce((s, r) => s + Number(r.value_actual_ytd ?? 0), 0) / 1e6;
  const treeActualFy = items.reduce((s, r) => s + Number(r.value_actual_fy ?? 0), 0) / 1e6;

  const dimOptions = (registry?.groupable ?? []).map((c) => ({
    value: c, label: registry?.fields.find((f) => f.column === c)?.label ?? c,
  }));
  const labelOf = (c: string) => dimOptions.find((o) => o.value === c)?.label ?? c;
  const keyOf = (r: Initiative, dim: string) => String(r[dim] ?? "") || "—";

  const selection = dcPath.map((val, i) => ({ dim: dcLevels[i], val }));
  const inBranch = (r: Initiative) => selection.every((s) => keyOf(r, s.dim) === s.val);
  const tableRows = sync && selection.length ? items.filter(inBranch) : items;

  // Filters/search can remove the selected branch: cut the path back to what still exists.
  useEffect(() => {
    if (!dcPath.length) return;
    let pool = items, keep = 0;
    for (let i = 0; i < dcPath.length; i++) {
      pool = pool.filter((r) => keyOf(r, dcLevels[i]) === dcPath[i]);
      if (!pool.length) break;
      keep = i + 1;
    }
    if (keep < dcPath.length) setDcPath(dcPath.slice(0, keep));
  }, [items, dcLevels, dcPath]);

  const drillTo = (row: Initiative) => {
    setDcPath(dcLevels.map((d) => keyOf(row, d)));
    treeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const columns = useMemo<ColumnDef<Initiative, any>[]>(() => {
    if (!registry) return [];
    const lbl = (c: string) => registry.fields.find((f) => f.column === c)?.label ?? c;
    const wrap = (row: Initiative, column: string, node: ReactNode, cls = "") => {
      const isEdited = edited(row, column);
      const isStale = needsReview(row, column);
      const className = `${cls} ${!isEdited ? "cell" : isStale ? "cell edited stale" : "cell edited"}`.trim();
      const title = isStale
        ? "Carried from a prior period; the source workbook has since changed."
        : isEdited ? "Hand-edited — the next Excel load will not overwrite this." : undefined;
      return <span className={className} title={title}>{node}</span>;
    };
    const col = (column: string, render: (row: Initiative, v: any) => ReactNode,
      opts: { header?: string; sort?: "basic" | "alphanumeric"; cls?: string } = {}):
      ColumnDef<Initiative, any> => ({
      id: column,
      accessorFn: (row: Initiative) => row[column],
      header: opts.header ?? lbl(column),
      sortingFn: opts.sort ?? "alphanumeric",
      cell: (ctx: any) => wrap(ctx.row.original, column,
        render(ctx.row.original, ctx.getValue()), opts.cls),
    });
    const text = (column: string, opts: Parameters<typeof col>[2] = {}) =>
      col(column, (_r, v) => display(registry, column, v), opts);
    const musd = (v: unknown) => (Number(v) ? (Number(v) / 1e6).toFixed(1) : "—");
    const compact = (v: unknown) => {
      if (v === null || v === undefined || v === "") return "—";
      const x = Number(v), a = Math.abs(x);
      return a === 0 ? "0" : a < 1 ? String(+x.toFixed(2)) : a < 100 ? String(+x.toFixed(1))
        : Math.round(x).toLocaleString("en-US");
    };
    const clip = (v: unknown, n: number) => {
      const t = String(v ?? ""); return t.length > n ? t.slice(0, n - 2) + "…" : t;
    };
    return [
      col("source_initiative_id", (_r, v) => String(v ?? "—"), { cls: "idlink" }),
      col("name", (r, v) => (
        <span className="namecell"><b>{String(v ?? "—")}</b>
          <span>{[r.site, r.program].filter(Boolean).join(" · ")}</span></span>
      ), { header: "Initiative" }),
      text("bu_code"),
      col("stage_code", (_r, v) => (
        <span className={`st s-${String(v)}`}>{display(registry, "stage_code", v)}</span>
      )),
      col("track_code", (_r, v) => (
        <span className={`tag t-${String(v ?? "UNKNOWN")}`}>{display(registry, "track_code", v)}</span>
      )),
      {
        id: "milestones", header: "Milestones",
        accessorFn: (r: Initiative) => Number(r.actions_total)
          ? Number(r.actions_done ?? 0) / Number(r.actions_total) : -1,
        cell: (ctx: any) => {
          const r = ctx.row.original, tot = Number(r.actions_total);
          if (!tot) return <span className="muted">—</span>;
          const pct = Math.round(100 * Number(r.actions_done ?? 0) / tot);
          return (
            <span><span className="prog"><i style={{ width: `${Math.min(pct, 100)}%` }} /></span>
              {" "}<span className="mono">{pct}%</span></span>
          );
        },
      },
      col("value_target_cy", (_r, v) => <span className="mono">{musd(v)}</span>,
        { header: "CY $M", sort: "basic" }),
      /* Derived from the monthly actuals, so read-only and not registry
         columns: to the period end, and with the forecast months. */
      ...([["value_actual_ytd", "Act. YTD $M", "Actuals YTD: monthly financial actuals to the snapshot's period end"],
        ["value_actual_fy", "A+F $M", "Actuals + forecast: monthly financial actuals through December"]] as const)
        .map(([key, header, title]): ColumnDef<Initiative, any> => ({
          id: key, header: () => <span title={title}>{header}</span>, sortingFn: "basic",
          accessorFn: (r: Initiative) => Number(r[key] ?? 0),
          cell: (ctx: any) => <span className="mono">{musd(ctx.getValue())}</span>,
        })),
      col("value_target_ny", (_r, v) => <span className="mono">{musd(v)}</span>,
        { header: "NY $M", sort: "basic" }),
      text("confidence_code", { header: "Conf." }),
      text("owner", { header: "Owner"}),
      col("kpi_name", (r, v) => v ? (
        <span className="kcell"><b title={String(v)}>{clip(v, 20)}</b>
          {r.kpi_uom ? <span>{String(r.kpi_uom)}</span> : null}</span>
      ) : <span className="muted">—</span>, { header: "KPI" }),
      {
        id: "kpi_target", header: "Target", sortingFn: "basic",
        accessorFn: (r: Initiative) => kpiAt(r, "TARGET", cutoff) ?? num(r.kpi_target_cy) ?? -Infinity,
        cell: (ctx: any) => {
          const r = ctx.row.original;
          const fy = num(r.kpi_target_cy);
          return wrap(r, "kpi_target_cy",
            <span className="mono" title={fy == null ? undefined : `FY target: ${compact(fy)}`}>
              {compact(kpiAt(r, "TARGET", cutoff) ?? fy)}</span>);
        },
      },
      {
        id: "kpi_value", header: "Value", sortingFn: "basic",
        accessorFn: (r: Initiative) => kpiAt(r, "ACTUAL", cutoff) ?? -Infinity,
        cell: (ctx: any) => <span className="mono">{compact(kpiAt(ctx.row.original, "ACTUAL", cutoff))}</span>,
      },
      col("notes", (_r, v) => v
        ? <span className="notecell" title={String(v)}>{String(v)}</span>
        : <span className="muted">—</span>),
      {
        id: "__actions",
        header: "",
        enableSorting: false,
        size: 60,
        cell: (ctx: any) => (
          <button className="link sm" onClick={(e) => {
            e.stopPropagation();
            setEditing(ctx.row.original);
          }}>Edit</button>
        ),
      },
    ];
  }, [registry, cutoff]);

  if (error) return <Problem error={error} />;

  const crumbs = selection.map((s) => `${labelOf(s.dim)}: ${display(registry, s.dim, s.val)}`);

  return (
    <>
      <PageHead title="Initiatives"
        blurb="Every column, filter and form field on this page is generated from the server's field registry.">
        <button className="primary" onClick={() => setCreating(true)}>+ New</button>
      </PageHead>

      <Panel title="Decomposition tree">
        <div className="dc-toolbar">
          <label className="switch">
            <input type="checkbox" checked={sync}
              onChange={(e) => setSync(e.target.checked)} />
            <span className="sl" />
          </label>
          <span>Sync register table to selected branch <b className="on-lbl">{sync ? "On" : "Off"}</b></span>
          <span className="muted sm">
            — when on, clicking a node filters the register below to that path
          </span>
        </div>
        <div ref={treeRef} className="tablewrap">
          {isLoading && !data ? <Loading what="the tree" /> : (
            <DecompositionTree
              levels={dcLevels} path={dcPath} nodes={treeNodes}
              total={items.length} onTrack={treeOnTrack} valueMusd={treeValue}
              actualYtdMusd={treeActualYtd} actualFyMusd={treeActualFy}
              dimensions={dimOptions}
              labelFor={(dim, code) => display(registry, dim, code)}
              onLevelChange={(i, dim) => {
                const next = [...dcLevels]; next[i] = dim;
                setDcLevels(next); setDcPath(dcPath.slice(0, i));
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
          )}
        </div>
      </Panel>

      <Panel
        title={sync && selection.length
          ? `Register · ${tableRows.length} of ${items.length} initiatives`
          : `Register · ${data?.total ?? 0} initiatives`}
        actions={
          <div className="filterbar">
            {registry?.fields.filter((f) => f.filterable).map((f) => (
              <Select key={f.column} label={f.label}
                value={filters[f.column]?.[0] ?? ""}
                onChange={(v) => setFilters((prev) => {
                  const next = { ...prev };
                  if (v) next[f.column] = [v]; else delete next[f.column];
                  return next;
                })}
                options={[{ value: "", label: "All" },
                  ...(f.vocab ? registry.vocab[f.vocab].terms.map((t) => ({
                    value: t.code, label: t.label })) : [])]} />
            ))}
            <label className="field">
              <span className="sm muted">Search</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="name, owner, KPI, ID…" />
            </label>
          </div>
        }>
        {sync && (
          <div className="syncbar">
            <span>🔗 Synced to {crumbs.length ? crumbs.join(" › ")
              : "all initiatives — click a tree node to narrow"}</span>
            <span className="muted">{tableRows.length} of {items.length} shown</span>
            {selection.length > 0 && (
              <button className="sm" onClick={() => setDcPath([])}>Clear branch</button>
            )}
          </div>
        )}
        {isLoading && !data ? <Loading what="initiatives" />
          : <DataTable data={tableRows} columns={columns} dense
            pageSize={25}
            onRowClick={sync ? drillTo : setEditing}
            rowClassName={sync && selection.length
              ? (r) => (inBranch(r) ? "row-branch" : undefined) : undefined}
            initialSort={[{ id: "value_target_cy", desc: true }]} />}
      </Panel>

      {editing && registry && (
        <Editor registry={registry} row={editing} onClose={() => setEditing(null)} />
      )}
      {creating && registry && snapshot && (
        <Creator registry={registry} snapshot={snapshot}
          onClose={() => setCreating(false)} />
      )}
    </>
  );
}

const num = (v: unknown) =>
  v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v);

/** Last calendar month a period covers: M05 -> 5, Q3 -> 9, H1 -> 6, FY -> 12 (mirrors backend). */
function periodEndMonth(type: string, ordinal: number | null): number {
  const n = ordinal ?? 0;
  if (type === "M") return Math.min(Math.max(n, 1), 12);
  if (type === "Q") return Math.min(Math.max(n, 1), 4) * 3;
  if (type === "H") return Math.min(Math.max(n, 1), 2) * 6;
  return 12;
}

/**
 * Monthly KPI figure at the snapshot cutoff -- latest non-null month on or
 * before it, else the latest available. Target and Value are compared
 * month-for-month, so rate and cumulative KPIs read like-for-like.
 */
function kpiAt(row: Initiative, scenario: "TARGET" | "ACTUAL", cutoff: number): number | null {
  const pts = (row.metrics ?? [])
    .filter((m) => m.metric_code === "KPI" && m.scenario_code === scenario && m.value != null)
    .map((m) => ({ month: Number(m.period_month.slice(5, 7)), value: m.value as number }))
    .sort((a, b) => a.month - b.month);
  if (!pts.length) return null;
  const upTo = pts.filter((p) => p.month <= cutoff);
  return (upTo.length ? upTo : pts)[(upTo.length ? upTo : pts).length - 1].value;
}

function edited(row: Initiative, column: string): boolean {
  return Boolean(row.edited_fields?.[column]);
}

/** A carried-forward edit whose source workbook has since diverged. */
function needsReview(row: Initiative, column: string): boolean {
  const entry = row.edited_fields?.[column];
  return typeof entry === "object" && entry !== null && Boolean(entry.needs_review);
}

/* ================================================================ editor = */
function Editor({ registry, row, onClose }:
{ registry: Registry; row: Initiative; onClose: () => void }) {
  const patch = usePatchInitiative();
  const remove = useDeleteInitiative();
  const { label } = usePeriod();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = Object.keys(draft);
  const editable = registry.fields.filter((f) => f.editable);
  const sections = registry.sections.filter((s) =>
    editable.some((f) => f.section === s));

  const save = () => {
    if (!dirty.length) return onClose();
    patch.mutate({ id: row.id, patch: draft }, { onSuccess: onClose });
  };

  return (
    <Drawer title={String(row.name)}
      subtitle={`${row.source_initiative_id} · ${display(registry, "bu_code", row.bu_code)} · ${label(row.snapshot_id)}`}
      onClose={onClose}>
      {sections.map((section) => (
        <fieldset key={section}>
          <legend>{section}</legend>
          {editable.filter((f) => f.section === section).map((f) => (
            <Input key={f.column} spec={f} registry={registry}
              value={f.column in draft ? draft[f.column] : row[f.column]}
              onChange={(v) => setDraft((d) => ({ ...d, [f.column]: v }))}
              wasEdited={edited(row, f.column)} />
          ))}
        </fieldset>
      ))}

      {patch.error && (
        <p className="bad sm">{(patch.error as Error).message}</p>
      )}

      <div className="drawer-actions">
        <button className="danger ghost"
          onClick={() => (confirmDelete
            ? remove.mutate(row.id, { onSuccess: onClose })
            : setConfirmDelete(true))}>
          {confirmDelete ? "Confirm delete" : "Delete"}
        </button>
        <div className="spacer" />
        <span className="muted sm">
          {dirty.length ? `${dirty.length} field(s) changed` : "No changes"}
        </span>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save}
          disabled={patch.isPending || !dirty.length}>
          {patch.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Drawer>
  );
}

/* =============================================================== creator = */
function Creator({ registry, snapshot, onClose }:
{ registry: Registry; snapshot: string; onClose: () => void }) {
  const create = useCreateInitiative();
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  // Required-and-not-yet-answered, computed from the registry rather than a
  // second hand-maintained list. Same rule the data-gaps page scores against.
  const missing = registry.fields.filter(
    (f) => f.required && (draft[f.column] === undefined || draft[f.column] === ""));

  const sections = registry.sections.filter((s) =>
    registry.fields.some((f) => f.section === s));

  return (
    <Drawer title="New initiative" subtitle={`Will be created in ${snapshot}`}
      onClose={onClose}>
      {sections.map((section) => (
        <fieldset key={section}>
          <legend>{section}</legend>
          {registry.fields.filter((f) => f.section === section).map((f) => (
            <Input key={f.column} spec={f} registry={registry}
              value={draft[f.column]}
              onChange={(v) => setDraft((d) => ({ ...d, [f.column]: v }))} />
          ))}
        </fieldset>
      ))}

      {create.error && <p className="bad sm">{(create.error as Error).message}</p>}

      <div className="drawer-actions">
        <span className="muted sm">
          {missing.length
            ? `${missing.length} required field(s) outstanding: ${missing.slice(0, 3)
              .map((f) => f.label).join(", ")}${missing.length > 3 ? "…" : ""}`
            : "All required fields answered"}
        </span>
        <div className="spacer" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={create.isPending || missing.length > 0}
          onClick={() => create.mutate({ ...draft, snapshot_id: snapshot },
            { onSuccess: onClose })}>
          {create.isPending ? "Creating…" : "Create"}
        </button>
      </div>
    </Drawer>
  );
}

/* ============================================== one input per field Kind = */
/**
 * The only place the UI maps a Kind to a control. Adding a Kind to the registry
 * means adding one case here; adding a *field* means nothing at all.
 */
function Input({ spec, registry, value, onChange, wasEdited }: {
  spec: FieldSpec; registry: Registry; value: unknown;
  onChange: (v: unknown) => void; wasEdited?: boolean;
}) {
  const common = {
    id: spec.column,
    "aria-label": spec.label,
  };
  const v = value ?? "";

  const control = (() => {
    switch (spec.kind) {
      case "vocab":
        return (
          <select {...common} value={String(v)}
            onChange={(e) => onChange(e.target.value || null)}>
            <option value="">—</option>
            {spec.vocab && registry.vocab[spec.vocab].terms.map((t) => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </select>
        );
      case "bool":
        return (
          <select {...common} value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}>
            <option value="">—</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );
      case "date":
        return <input {...common} type="date" value={String(v).slice(0, 10)}
          onChange={(e) => onChange(e.target.value || null)} />;
      case "money":
        return (
          <div className="moneyinput">
            <input {...common} type="number" step="0.01"
              value={v === "" ? "" : Number(v) / 1e6}
              onChange={(e) => onChange(e.target.value === "" ? null
                : Number(e.target.value) * 1e6)} />
            <span className="suffix sm muted">$M</span>
          </div>
        );
      case "int":
      case "number":
        return <input {...common} type="number"
          step={spec.kind === "int" ? 1 : "any"} value={String(v)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
      case "longtext":
        return <textarea {...common} rows={2} value={String(v)}
          onChange={(e) => onChange(e.target.value || null)} />;
      default:
        return <input {...common} type="text" value={String(v)}
          onChange={(e) => onChange(e.target.value || null)} />;
    }
  })();

  return (
    <label className={`formrow${wasEdited ? " edited" : ""}`} htmlFor={spec.column}>
      <span className="formlabel sm">
        {spec.label}
        {spec.required && <b className="req" title="Required">*</b>}
        {wasEdited && <i className="pill sm" title="Previously hand-edited">edited</i>}
      </span>
      {control}
      {spec.help && <span className="muted sm hint">{spec.help}</span>}
    </label>
  );
}

/* ================================================================ drawer = */
function Drawer({ title, subtitle, children, onClose }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h3>{title}</h3>
            {subtitle && <p className="muted sm">{subtitle}</p>}
          </div>
          <button className="link" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
