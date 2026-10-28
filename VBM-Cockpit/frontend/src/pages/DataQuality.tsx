/**
 * Data quality — the gaps view, split out of the former merged Data.tsx.
 *
 * The field list here is the registry's, scored server-side. A newly
 * required field shows up here the moment it is added to registry.py.
 * Which fields count as "required" is set per stage behind the gear (⚙):
 * an Evaluating initiative is not expected to carry financials yet.
 *
 * The page reads top to bottom as headline -> where -> what -> who: the BU
 * matrix, the field ranking and the distribution all narrow the initiative
 * table at the bottom, so every summary ends in a list of names to chase.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";

import {
  type CompletenessOut, type CompletenessRules, type Registry, type Scope,
  fmt, useCompleteness, useCompletenessRules, useMeta,
} from "../api";
import { type RequiredByStage, useRequiredFieldsConfig } from "../completenessConfig";
import { PageHead } from "../App";
import { gapHeat } from "../charts";
import {
  DataTable, Empty, Kpi, Loading, PrintSection, Problem, Section, Select,
  WhenReady, display, usePeriod,
} from "../ui";

type FieldScope = "required" | "all";
type Tone = "good" | "warn" | "bad";

/** The one threshold scale on this page -- KPI, matrix, meters and table. */
const toneOf = (pct: number): Tone => (pct >= 90 ? "good" : pct >= 75 ? "warn" : "bad");

/* Completeness bands as the server buckets them (analytics.build_completeness),
   lowest first. An array, not an object: "100" is an integer-like key, which
   JS always enumerates first, so neither the server's distribution object nor
   a lookup object can be trusted for order.
   Only a fully complete initiative reads as good; 60-<100 is "nearly there". */
const BANDS: { band: string; lo: number; hi: number; tone: Tone }[] = [
  { band: "0–20", lo: 0, hi: 20, tone: "bad" },
  { band: "20–40", lo: 20, hi: 40, tone: "bad" },
  { band: "40–60", lo: 40, hi: 60, tone: "bad" },
  { band: "60–80", lo: 60, hi: 80, tone: "warn" },
  { band: "80–<100", lo: 80, hi: 100, tone: "warn" },
  { band: "100", lo: 100, hi: Infinity, tone: "good" },
];

/** What the summary visuals have narrowed the initiative table to. */
type Focus = { bu?: string; field?: string; band?: string };

export default function DataQualityPage() {
  return <WhenReady><Body /></WhenReady>;
}

function Body() {
  const { snapshot, options } = usePeriod();
  const registry = useMeta().data?.registry;
  const customised = useCompletenessRules().data?.customised;

  const [fieldScope, setFieldScope] = useState<FieldScope>("required");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  // Same filter bar as Portfolio, sent to the server so every number on the
  // page is scored over the filtered set. Search is debounced likewise.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);
  const scope: Scope = useMemo(() => ({
    filters: Object.fromEntries(Object.entries(filters).map(([c, v]) => [c, [v]])),
    search: debounced || undefined,
  }), [filters, debounced]);

  const { data, isLoading, error } = useCompleteness(snapshot, fieldScope, scope);
  const inSnapshot = options?.snapshots.find((s) => s.id === snapshot)?.initiative_count;

  return (
    <>
      <PageHead title="Data quality"
        blurb="How complete the register is, scored against the server's field registry. Click a business unit, field or band to list the initiatives behind it.">
        <div className="field">
          <span className="sm muted">Scope</span>
          <div className="seg" role="group" aria-label="Scope">
            {([["required", "Required fields"], ["all", "All fields"]] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={fieldScope === v}
                className={fieldScope === v ? "on" : undefined}
                onClick={() => setFieldScope(v)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => setSettingsOpen(true)}
          title="Choose which fields each stage is expected to carry">
          ⚙ Required fields
          {customised && <i className="pill warn" title="Differs from the registry defaults">customised</i>}
        </button>
      </PageHead>

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
        {data && (
          <p className="muted sm filter-count">
            <b>{fmt.int(data.initiatives)}</b>
            {inSnapshot != null && <> of {fmt.int(inSnapshot)}</>} initiatives scored
          </p>
        )}
      </div>

      {error ? <Problem error={error} />
        : isLoading && !data ? <Loading what="completeness" />
        : data ? <Gaps data={data} scope={fieldScope} registry={registry} />
        : null}
      {settingsOpen && <RequiredFieldsSettings onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

/* ============================================================= settings = */
const sameSet = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && a.every((k) => b.includes(k));

function RequiredFieldsSettings({ onClose }: { onClose: () => void }) {
  const { rules, saving, error, save, reset } = useRequiredFieldsConfig();
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal xwide" onClick={(e) => e.stopPropagation()}>
        <h3>Required fields per stage</h3>
        <p className="muted sm">
          Ticked fields count towards "Required fields" completeness for
          initiatives in that stage; unticked ones are not expected yet and are
          never reported missing. "All fields" is unaffected. Shared for
          everyone: there is one saved set of rules.
        </p>
        <p className="muted sm">
          Use the blue <b>All fields</b> row to tick or untick a whole stage
          column, and the blue <b>All stages</b> column to tick or untick a whole
          row (a field, or a section's fields) across every stage.
        </p>
        {rules.error ? <Problem error={rules.error} />
          : !rules.data ? <Loading what="rules" />
          : <RulesEditor data={rules.data} saving={saving} error={error}
              onCancel={onClose}
              onSave={(r) => save(r).then(onClose, () => {})}
              onReset={() => reset().then(onClose, () => {})} />}
      </div>
    </div>
  );
}

function RulesEditor({ data, saving, error, onCancel, onSave, onReset }: {
  data: CompletenessRules; saving: boolean; error: unknown;
  onCancel: () => void; onSave: (r: RequiredByStage) => void; onReset: () => void;
}) {
  // Every edit pushes a snapshot, so a misclick (even a whole-column one)
  // can be undone; editing after an undo drops the redo branch.
  const [history, setHistory] = useState({ stack: [data.rules], at: 0 });
  const draft = history.stack[history.at];
  const setDraft = (edit: (d: RequiredByStage) => RequiredByStage) =>
    setHistory(({ stack, at }) =>
      ({ stack: [...stack.slice(0, at + 1), edit(stack[at])], at: at + 1 }));
  const canUndo = history.at > 0;
  const canRedo = history.at < history.stack.length - 1;
  const undo = () => setHistory((h) => ({ ...h, at: Math.max(0, h.at - 1) }));
  const redo = () => setHistory((h) => ({ ...h, at: Math.min(h.stack.length - 1, h.at + 1) }));
  const { stages, defaults } = data;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const bySection = useMemo(() => {
    const out = new Map<string, CompletenessRules["fields"]>();
    for (const f of data.fields) out.set(f.section, [...(out.get(f.section) ?? []), f]);
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data.fields]);

  const has = (stage: string, key: string) => (draft[stage] ?? []).includes(key);
  // Keep keys in registry order so a saved list reads like the field list.
  const set = (stageCodes: string[], keys: string[], on: boolean) => setDraft((d) => {
    const out = { ...d };
    for (const stage of stageCodes) {
      const next = new Set(d[stage] ?? []);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      out[stage] = data.fields.map((f) => f.key).filter((k) => next.has(k));
    }
    return out;
  });
  const codes = stages.map((s) => s.code);
  const allKeys = data.fields.map((f) => f.key);
  // How many of the (stage, key) cells are ticked, for a tri-state box.
  const count = (stageCodes: string[], keys: string[]) =>
    stageCodes.reduce((n, s) => n + keys.filter((k) => has(s, k)).length, 0);

  const dirty = stages.some((s) => !sameSet(draft[s.code], data.rules[s.code]));
  const atDefaults = stages.every((s) => sameSet(draft[s.code], defaults[s.code]));

  return (
    <>
      <p className="legend sm dq-legend">
        <span><i className="dq-sw-changed" />Differs from the registry default</span>
      </p>
      <div className="reqmatrix-wrap">
        <table className="grid dense reqmatrix">
          <thead>
            <tr>
              <th>Field</th>
              <th className="all">All stages<div className="muted sm">whole row →</div></th>
              {stages.map((s) => (
                <th key={s.code}>
                  {s.label}
                  <div><i className="pill">{(draft[s.code] ?? []).length} req.</i></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="all">
              <th>All fields <span className="muted sm">↓ whole column</span></th>
              <td className="all">
                <TriBox n={count(codes, allKeys)} of={codes.length * allKeys.length}
                  label="All fields required for all stages"
                  onChange={(on) => set(codes, allKeys, on)} />
              </td>
              {stages.map((s) => (
                <td key={s.code}>
                  <TriBox n={count([s.code], allKeys)} of={allKeys.length}
                    label={`All fields required for ${s.label}`}
                    onChange={(on) => set([s.code], allKeys, on)} />
                </td>
              ))}
            </tr>
            {bySection.map(([section, fields]) => {
              const keys = fields.map((f) => f.key);
              return (
                <Fragment key={section}>
                  <tr className="section">
                    <th>{section}</th>
                    <td className="all">
                      <TriBox n={count(codes, keys)} of={codes.length * keys.length}
                        label={`${section} required for all stages`}
                        onChange={(on) => set(codes, keys, on)} />
                    </td>
                    {stages.map((s) => (
                      <td key={s.code}>
                        <TriBox n={count([s.code], keys)} of={keys.length}
                          label={`${section} required for ${s.label}`}
                          onChange={(on) => set([s.code], keys, on)} />
                      </td>
                    ))}
                  </tr>
                  {fields.map((f) => (
                    <tr key={f.key}>
                      <th>{f.label}</th>
                      <td className="all">
                        <TriBox n={count(codes, [f.key])} of={codes.length}
                          label={`${f.label} required for all stages`}
                          onChange={(on) => set(codes, [f.key], on)} />
                      </td>
                      {stages.map((s) => {
                        const on = has(s.code, f.key);
                        const changed = on !== (defaults[s.code] ?? []).includes(f.key);
                        return (
                          <td key={s.code} className={changed ? "changed" : undefined}
                            title={changed ? "Differs from the default" : undefined}>
                            <input type="checkbox" checked={on}
                              aria-label={`${f.label} required for ${s.label}`}
                              onChange={(e) => set([s.code], [f.key], e.target.checked)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {error ? <p className="bad sm">{error instanceof Error ? error.message : String(error)}</p> : null}
      <div className="modal-actions">
        <button type="button" onClick={undo} disabled={saving || !canUndo}
          title="Undo the last change (Ctrl+Z)">
          ↶ Undo
        </button>
        <button type="button" onClick={redo} disabled={saving || !canRedo}
          title="Redo the change you undid (Ctrl+Y or Ctrl+Shift+Z)">
          ↷ Redo
        </button>
        <button type="button" onClick={onReset}
          disabled={saving || (!data.customised && atDefaults)}
          style={{ marginRight: "auto" }}>
          Reset to defaults
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="primary" onClick={() => onSave(draft)}
          disabled={saving || !dirty}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </>
  );
}

/** A select/deselect-all box: ticked when all `of` cells are, dashed when some. */
function TriBox({ n, of, label, onChange }: {
  n: number; of: number; label: string; onChange: (on: boolean) => void;
}) {
  return (
    <input type="checkbox" checked={of > 0 && n === of}
      ref={(el) => { if (el) el.indeterminate = n > 0 && n < of; }}
      aria-label={label} title={n === of ? `Deselect: ${label}` : `Select: ${label}`}
      onChange={(e) => onChange(e.target.checked)} />
  );
}

/* ================================================================ atoms = */
/** Toned percentage with a bar behind it. */
function Meter({ pct }: { pct: number }) {
  const tone = toneOf(pct);
  return (
    <span className="dq-meter">
      <span className={`prog ${tone}`}><i style={{ width: `${Math.min(pct, 100)}%` }} /></span>
      <b className={tone}>{fmt.pct(pct, 0)}</b>
    </span>
  );
}

/* ================================================================== gaps = */
const FIELDS_SHOWN = 10;

function Gaps({ data, scope, registry }: {
  data: CompletenessOut; scope: FieldScope; registry?: Registry;
}) {
  const { search: query } = useLocation();
  const [focus, setFocus] = useState<Focus>({});
  const [tableSearch, setTableSearch] = useState("");
  const [allFields, setAllFields] = useState(false);

  // Clicking the active item again clears it, like a toggle chip.
  const toggle = (k: keyof Focus, v: string) =>
    setFocus((f) => ({ ...f, [k]: f[k] === v ? undefined : v }));
  const focused = Boolean(focus.bu || focus.field || focus.band);

  const rows = useMemo(() => data.initiatives_detail.filter((r) => {
    if (focus.bu && r.bu_code !== focus.bu) return false;
    if (focus.field && !(r.missing_fields as string[]).includes(focus.field)) return false;
    if (focus.band) {
      const b = BANDS.find((x) => x.band === focus.band)!;
      const p = r.completeness_pct as number;
      if (p < b.lo || p >= b.hi) return false;
    }
    return true;
  }), [data.initiatives_detail, focus]);

  const detailColumns = useMemo<ColumnDef<any, any>[]>(() => [
    {
      id: "id", accessorKey: "id", header: "ID", size: 110,
      cell: (c: any) => <span className="idlink">{c.getValue()}</span>,
    },
    {
      id: "name", accessorKey: "name", header: "Initiative", size: 280,
      cell: (c: any) => <span className="namecell"><b>{c.getValue()}</b></span>,
    },
    { id: "bu", accessorKey: "bu_code", header: "BU", size: 70 },
    {
      id: "stage", accessorKey: "stage_code", header: "Stage", size: 120,
      cell: (c: any) => c.getValue()
        ? <span className={`st s-${c.getValue()}`}>{display(registry, "stage_code", c.getValue())}</span>
        : <span className="muted">—</span>,
    },
    {
      id: "pct", accessorKey: "completeness_pct", header: "Complete", size: 140,
      cell: (c: any) => <Meter pct={c.getValue()} />,
    },
    { id: "missing", accessorKey: "missing_count", header: "Gaps", size: 70 },
    {
      id: "fields", accessorKey: "missing_fields", header: "Missing fields",
      enableSorting: false,
      cell: (c: any) => {
        const all = c.getValue() as string[];
        if (!all.length) return <span className="good sm">Complete</span>;
        const rest = all.slice(4);
        return (
          <div className="chips">
            {all.slice(0, 4).map((f) => <span key={f} className="chip warn sm">{f}</span>)}
            {rest.length > 0 &&
              <span className="chip more sm" title={rest.join("\n")}>+{rest.length}</span>}
          </div>
        );
      },
    },
  ], [registry]);

  const sections = data.sections.filter((s) =>
    data.by_bu.some((b) => b.sections[s] !== undefined));
  const worst = data.field_gaps[0];
  const withGaps = data.initiatives - data.fully_complete;
  const fields = allFields ? data.field_gaps : data.field_gaps.slice(0, FIELDS_SHOWN);
  const bandMax = Math.max(1, ...Object.values(data.distribution));
  const buLabel = data.by_bu.find((b) => b.bu_code === focus.bu)?.bu_label ?? focus.bu;

  return (
    <>
      <PrintSection id="gap-kpis" label="Completeness KPIs" className="panel">
        <div className="kpirow tight">
          <Kpi label="Overall completeness" value={fmt.pct(data.pct)} tone={toneOf(data.pct)}
            sub={`${fmt.int(data.filled)} of ${fmt.int(data.total)} cells · ${fmt.int(data.fields_scored)} ${scope === "required" ? "required fields" : "fields"}`} />
          <Kpi label="Initiatives with gaps" value={fmt.int(withGaps)}
            tone={withGaps === 0 ? "good" : undefined}
            sub={`of ${fmt.int(data.initiatives)} · ${fmt.int(data.fully_complete)} fully complete`} />
          <Kpi label="Missing cells" value={fmt.int(data.total - data.filled)}
            sub="blank answers still to fill" />
          <Kpi label="Most-missing field"
            value={worst ? fmt.pct(worst.pct, 0) : "—"}
            tone={worst ? "bad" : "good"}
            sub={worst
              ? <span className="dq-kpi-field" title={worst.label}>{worst.label} · {fmt.int(worst.missing)} initiatives</span>
              : "nothing missing"} />
        </div>
      </PrintSection>

      <Section id="gap-where" title="Where are the gaps" note="business unit × template section"
        blurb="Each cell is the share of scored answers filled in. Complete cells stay plain; the redder the cell, the bigger the gap. Click a row to list that BU's initiatives below.">
        <div className="tablewrap">
          <table className="grid heat dq-matrix">
            <thead>
              <tr>
                <th className="left">Business unit</th>
                <th>Initiatives</th>
                <th>Fully complete</th>
                <th>Overall</th>
                {/* "4 · KPI & Value Quantification" -> number on top, name wrapping below. */}
                {sections.map((s) => {
                  const [no, name] = s.includes(" · ") ? s.split(" · ", 2) : ["", s];
                  return (
                    <th key={s} className="sec" title={s}>
                      {no ? <span className="dq-secno">{no}</span> : null}{name}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.by_bu.map((b) => (
                <tr key={b.bu_code} tabIndex={0}
                  className={`clickable${focus.bu === b.bu_code ? " on" : ""}`}
                  title={focus.bu === b.bu_code ? "Show every BU again" : "List this BU's initiatives below"}
                  onClick={() => toggle("bu", b.bu_code)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle("bu", b.bu_code); } }}>
                  <th className="left">{b.bu_label}</th>
                  <td>{fmt.int(b.initiatives)}</td>
                  <td>{fmt.int(b.fully_complete)}</td>
                  <td><Meter pct={b.pct} /></td>
                  {sections.map((s) => (
                    <td key={s} style={gapHeat(b.sections[s])}>
                      {b.sections[s] === undefined ? "—" : fmt.pct(b.sections[s], 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="left">Portfolio</th>
                <td>{fmt.int(data.initiatives)}</td>
                <td>{fmt.int(data.fully_complete)}</td>
                <td><Meter pct={data.pct} /></td>
                {sections.map((s) => (
                  <td key={s} style={gapHeat(data.section_pct?.[s])}>
                    {data.section_pct?.[s] === undefined ? "—" : fmt.pct(data.section_pct[s], 0)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="legend sm dq-legend">
          <span><i style={{ background: gapHeat(95).background }} />≥ 90% complete</span>
          <span><i style={{ background: gapHeat(80).background }} />75–90%</span>
          <span><i style={{ background: gapHeat(50).background }} />below 75%</span>
          <span><i style={{ background: gapHeat(0).background }} />mostly empty</span>
        </p>
      </Section>

      <div className="grid2">
        <Section id="gap-fields" title="What's missing" note="most-missing fields"
          blurb="Share of the initiatives expected to carry each field that leave it blank. Click a field to list them.">
          {fields.length === 0 ? <Empty>Every scored field is filled in.</Empty> : (
            <>
              <ol className="dq-fields">
                {fields.map((g, i) => (
                  <li key={g.field}>
                    <button type="button" aria-pressed={focus.field === g.label}
                      className={focus.field === g.label ? "on" : undefined}
                      onClick={() => toggle("field", g.label)}>
                      <span className="dq-rank">{i + 1}</span>
                      <span className="dq-flabel">{g.label}</span>
                      <span className="dq-fbar"><i style={{ width: `${Math.min(g.pct, 100)}%` }} /></span>
                      <span className="dq-fval">
                        <b>{fmt.pct(g.pct, 0)}</b>
                        <span className="muted sm">{fmt.int(g.missing)} missing</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {data.field_gaps.length > FIELDS_SHOWN && (
                <button type="button" className="linkbtn" onClick={() => setAllFields((a) => !a)}>
                  {allFields ? `Show top ${FIELDS_SHOWN}` : `Show all ${data.field_gaps.length} fields`}
                </button>
              )}
            </>
          )}
        </Section>

        <Section id="gap-dist" title="Completeness distribution" note="initiatives per band"
          blurb="How many initiatives fall in each completeness band. Click a band to list them.">
          <div className="dq-bands">
            {BANDS.map(({ band, tone }) => {
              const n = data.distribution[band] ?? 0;
              return (
              <button key={band} type="button" disabled={!n && focus.band !== band}
                aria-pressed={focus.band === band}
                className={`dq-band ${tone}${focus.band === band ? " on" : ""}`}
                onClick={() => toggle("band", band)}>
                <span className="dq-bcount">{fmt.int(n)}</span>
                <span className="dq-bcol"><i style={{ height: `${(n / bandMax) * 100}%` }} /></span>
                <span className="dq-blabel">{band}%</span>
              </button>
              );
            })}
          </div>
        </Section>
      </div>

      <Section id="gap-detail" title="Who to chase" note="initiative-level gaps"
        blurb={<>Initiatives with the most gaps first. Fix them on the{" "}
          <Link to={{ pathname: "/initiatives", search: query }}>Initiatives tab</Link>.</>}
        actions={
          <label className="field">
            <span className="sm muted">Find in table</span>
            <input type="search" value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)} placeholder="ID, name, field…" />
          </label>
        }>
        {focused && (
          <div className="dq-activefilters sm">
            <span className="muted">Showing {fmt.int(rows.length)} of {fmt.int(data.initiatives)} ·</span>
            {focus.bu && <FocusChip label={`BU: ${buLabel}`} onClear={() => toggle("bu", focus.bu!)} />}
            {focus.field && <FocusChip label={`Missing: ${focus.field}`} onClear={() => toggle("field", focus.field!)} />}
            {focus.band && <FocusChip label={`Band: ${focus.band}%`} onClear={() => toggle("band", focus.band!)} />}
            <button type="button" className="linkbtn" onClick={() => setFocus({})}>Clear all</button>
          </div>
        )}
        {focused && rows.length === 0 ? (
          <Empty>
            No initiatives match this combination.{" "}
            <button type="button" className="linkbtn" onClick={() => setFocus({})}>Clear</button>
          </Empty>
        ) : (
          <DataTable data={rows} columns={detailColumns} globalFilter={tableSearch}
            initialSort={[{ id: "missing", desc: true }]} dense pageSize={15} />
        )}
      </Section>
    </>
  );
}

function FocusChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="chip on">
      {label}
      <button type="button" className="dq-chipx" aria-label={`Remove ${label}`}
        onClick={onClear}>×</button>
    </span>
  );
}
