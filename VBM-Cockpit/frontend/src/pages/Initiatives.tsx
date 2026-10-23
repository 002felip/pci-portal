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

import { useMemo, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import {
  useCreateInitiative, useDeleteInitiative, useInitiatives, useMeta,
  usePatchInitiative, type FieldSpec, type Initiative, type Registry,
} from "../api";
import { PageHead } from "../App";
import {
  DataTable, Loading, Panel, Problem, Select, WhenReady, display, usePeriod,
} from "../ui";

export default function InitiativesPage() {
  return <WhenReady><Body /></WhenReady>;
}

function Body() {
  const { snapshot } = usePeriod();
  const { data: meta } = useMeta();
  const registry = meta?.registry;

  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Initiative | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading, error } = useInitiatives({
    snapshot, filters, search: search || undefined, limit: 5000,
  });

  const columns = useMemo<ColumnDef<Initiative, any>[]>(() => {
    if (!registry) return [];
    const specs = registry.fields.filter((f) => f.grid);
    return [
      ...specs.map((f) => ({
        id: f.column,
        accessorFn: (row: Initiative) => row[f.column],
        header: f.label,
        size: f.kind === "longtext" ? 280 : undefined,
        sortingFn: numericKinds.has(f.kind) ? "basic" as const : "alphanumeric" as const,
        cell: (ctx: any) => {
          const isEdited = edited(ctx.row.original, f.column);
          const isStale = needsReview(ctx.row.original, f.column);
          const className = !isEdited ? "cell" : isStale ? "cell edited stale" : "cell edited";
          const title = isStale
            ? `Carried from a prior period; the source workbook has since changed.`
            : isEdited
              ? "Hand-edited — the next Excel load will not overwrite this."
              : undefined;
          return (
            <span className={className} title={title}>
              {display(registry, f.column, ctx.getValue())}
            </span>
          );
        },
      })),
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
  }, [registry]);

  if (error) return <Problem error={error} />;

  return (
    <>
      <PageHead title="Initiatives"
        blurb="Every column, filter and form field on this page is generated from the server's field registry.">
        <button className="primary" onClick={() => setCreating(true)}>+ New</button>
      </PageHead>

      <Panel
        title={`Register · ${data?.total ?? 0} initiatives`}
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
        {isLoading && !data ? <Loading what="initiatives" />
          : <DataTable data={data?.items ?? []} columns={columns} dense
            pageSize={25} onRowClick={setEditing}
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

const numericKinds = new Set(["int", "number", "money"]);

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
