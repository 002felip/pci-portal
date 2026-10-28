/**
 * Transport + types + TanStack Query hooks, in one module.
 *
 * WHY ONE FILE: client.ts / types.ts / hooks.ts were three files that always
 * changed together. Splitting them bought nothing and cost a jump every time
 * an endpoint moved.
 *
 * WHY THE TYPES ARE THIN: `FieldSpec[]` arrives from `/api/meta/fields` at
 * runtime, so the register grid, the editor form and the filter bar are built
 * from data rather than from a hand-maintained interface. Adding a column to
 * the backend registry adds it to the UI with no TypeScript change. Only the
 * *computed* shapes (compare, tree, completeness) are typed statically, because
 * those are genuinely stable contracts.
 */

import {
  keepPreviousData, useMutation, useQuery, useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

// Prefixo de publicação (vite build --base=/VBM-Cockpit/ dentro do Portal PCI).
// No build padrão BASE_URL é "/", e o resultado continua sendo "/api".
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");
const BASE = import.meta.env.VITE_API_BASE ?? `${BASE_PATH}/api`;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

type Param = string | number | boolean | string[] | undefined | null;

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: unknown;
    let message = `${res.status} ${res.statusText}`;
    try {
      detail = await res.json();
      const d = detail as { detail?: string };
      if (d?.detail) message = d.detail;
    } catch { /* non-JSON body */ }
    throw new ApiError(message, res.status, detail);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

function url(path: string, params?: Record<string, Param>): string {
  const u = new URL(`${BASE}${path}`, window.location.origin);
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
    else u.searchParams.set(k, String(v));
  });
  return u.toString();
}

const json = { "Content-Type": "application/json" };

export const api = {
  get: <T,>(p: string, q?: Record<string, Param>) =>
    fetch(url(p, q), { headers: { Accept: "application/json" } }).then(parse<T>),
  post: <T,>(p: string, body: unknown) =>
    fetch(`${BASE}${p}`, { method: "POST", headers: json, body: JSON.stringify(body) })
      .then(parse<T>),
  patch: <T,>(p: string, body: unknown) =>
    fetch(`${BASE}${p}`, { method: "PATCH", headers: json, body: JSON.stringify(body) })
      .then(parse<T>),
  put: <T,>(p: string, body: unknown) =>
    fetch(`${BASE}${p}`, { method: "PUT", headers: json, body: JSON.stringify(body) })
      .then(parse<T>),
  del: <T,>(p: string) => fetch(`${BASE}${p}`, { method: "DELETE" }).then(parse<T>),
  upload: <T,>(p: string, form: FormData) =>
    fetch(`${BASE}${p}`, { method: "POST", body: form }).then(parse<T>),
};

/* ========================================================= registry types = */
export type FieldKind =
  | "text" | "longtext" | "int" | "number" | "money" | "bool" | "date" | "vocab";

export interface FieldSpec {
  name: string;
  column: string;
  label: string;
  kind: FieldKind;
  section: string;
  required: boolean;
  vocab: string | null;
  editable: boolean;
  filterable: boolean;
  grid: boolean;
  groupable: boolean;
  help: string | null;
}

export interface VocabTerm {
  code: string; label: string; sort_order: number; color_hex: string | null;
}

export interface Registry {
  sections: string[];
  fields: FieldSpec[];
  vocab: Record<string, { label: string; terms: VocabTerm[] }>;
  groupable: string[];
  stage_semantics: { in_execution: string[]; realized: string[]; on_track: string };
}

/* ============================================================= period types */
export interface SnapshotInfo {
  id: string; period_key: string; label: string; as_of_date: string | null;
  fiscal_year: number; period_type: "FY" | "H" | "Q" | "M";
  period_ordinal: number | null;
  sort_key: number; state: "draft" | "published" | "locked"; revision: number;
  superseded_by: string | null; pinned: boolean; needs_review: boolean;
  stored_filename: string | null; original_filename: string | null;
  reason: string | null; created_by: string | null; published_by: string | null;
  published_at: string | null;
  is_baseline: boolean;
  /** Orthogonal to `state`: a draft, published or locked snapshot can each be
   *  archived, and restoring puts back whatever state it held. */
  archived_at: string | null; archived_by: string | null;
  /** Operator commentary, editable. Distinct from `reason`, which is the
   *  immutable justification captured when a revision was uploaded. */
  notes: string | null;
  /** When the workbook currently behind this period was loaded. Re-stamped by
   *  every revision. Null for periods loaded before the column existed. */
  uploaded_at: string | null;
  initiative_count: number;
}

/** The three snapshot fields an operator may edit; everything else is either
 *  derived from the period or owned by a lifecycle transition. */
export interface SnapshotPatch {
  label?: string;
  notes?: string | null;
  pinned?: boolean;
}

export interface PeriodByYear { year: number; snapshots: SnapshotInfo[] }

export interface PeriodOptions {
  snapshots: SnapshotInfo[];
  years: number[];
  default_snapshot: string | null;
  default_baseline: string | null;
  default_year: number | null;
  comparable_pairs: string[][];
  by_year: PeriodByYear[];
  pinned: SnapshotInfo[];
}

export interface MetaOut {
  periods: PeriodOptions;
  vocab: Record<string, VocabTerm[]>;
  registry: Registry;
  data_backend: string;
  app_version: string;
}

/* ========================================================= computed shapes */
export type Initiative = Record<string, unknown> & {
  id: string; snapshot_id: string; name: string; bu_code: string;
  // A plain `true` is a direct hand-edit (Initiatives tab or a brand-new row);
  // `{ source_value, needs_review }` is a curation carried forward from a
  // prior snapshot (spec step 7) -- `needs_review` means the source workbook
  // has since diverged from the value this edit was made against.
  edited_fields?: Record<string, boolean | { source_value: unknown; needs_review: boolean }> | null;
  metrics?: { metric_code: string; scenario_code: string; period_month: string; value: number | null }[];
};

export interface InitiativeList { total: number; items: Initiative[] }

export interface CompareMetrics {
  total: number; in_execution: number; value_musd: number;
  actual_ytd_musd: number; actual_fy_musd: number;
}
export interface CompareRow {
  bu_code: string; bu_label: string;
  a: CompareMetrics; b: CompareMetrics; delta: CompareMetrics;
  a_present: boolean; b_present: boolean;
}
export interface CompareOut {
  snapshot_a: string; snapshot_b: string; rows: CompareRow[]; totals: CompareRow;
  unmatched_count: number;
}

export interface TopItem {
  rank: number; key: string; name: string; value_musd: number;
  source_initiative_id: string | null;
}
export interface TopMovement {
  name: string; status: "carried" | "new" | "fell_out" | "discontinued";
  source_initiative_id: string | null; renamed: boolean; prev_name: string | null;
  a_rank: number | null; b_rank: number | null;
  a_value_musd: number | null; b_value_musd: number | null;
  delta_musd: number | null;
}
export interface TopBU {
  bu_code: string; bu_label: string; a_items: TopItem[]; b_items: TopItem[];
  movements: TopMovement[]; a_total_musd: number; b_total_musd: number;
  delta_musd: number; counts: Record<string, number>;
  is_overridden: boolean; note: string | null;
}
/** What the Top-N ranks and sums: CY target, actuals YTD or actuals + forecast. */
export type TopBasis = "target" | "actual_ytd" | "actual_fy";
export interface TopOut {
  snapshot_a: string; snapshot_b: string; limit: number; basis: TopBasis;
  business_units: TopBU[]; totals: Record<string, number>;
}

export interface MonthlySeries {
  year: number; months: string[];
  financial_target_cum_musd: number[]; financial_actual_cum_musd: number[];
  kpi_attainment_pct: (number | null)[]; kpi_sample: number[];
  milestones_target_cum: number[]; milestones_actual_cum: number[];
  cutoff_index: number | null;
}

export interface QuarterBucket {
  key: string; year: number | null; quarter: number | null;
  counts: Record<string, number>; total: number;
}
export interface QuarterOut {
  stack_by: string; buckets: QuarterBucket[]; series: string[];
  total: number; scheduled: number; unscheduled: number;
  peak_key: string | null; peak_count: number;
}

export interface StageMatrixOut {
  cells: { bu_code: string; lever_code: string; stage_code: string;
    count: number; value_musd: number; actual_ytd_musd: number; actual_fy_musd: number }[];
  funnel: Record<string, {
    count: number; value_musd: number; actual_ytd_musd: number; actual_fy_musd: number;
  }>;
  mapped: number; total: number;
}

export interface TreeNode {
  name: string; dimension: string; count: number; on_track: number;
  value_musd: number; actual_ytd_musd: number; actual_fy_musd: number;
  children?: TreeNode[] | null;
}
/** Client-side twin of backend `build_tree`, so the tree can follow page filters. */
export function buildTree(rows: Initiative[], levels: string[], onTrackCode = "ON"): TreeNode[] {
  const group = (items: Initiative[], depth: number): TreeNode[] => {
    if (depth >= levels.length) return [];
    const dim = levels[depth];
    const buckets = new Map<string, Initiative[]>();
    for (const r of items) {
      const k = String(r[dim] ?? "") || "—";
      const arr = buckets.get(k);
      if (arr) arr.push(r); else buckets.set(k, [r]);
    }
    const nodes: TreeNode[] = [...buckets].map(([name, arr]) => ({
      name, dimension: dim, count: arr.length,
      on_track: arr.filter((x) => x.track_code === onTrackCode).length,
      value_musd: Math.round(arr.reduce((s, x) => s + Number(x.value_target_cy ?? 0), 0) / 1e5) / 10,
      actual_ytd_musd: Math.round(arr.reduce((s, x) => s + Number(x.value_actual_ytd ?? 0), 0) / 1e5) / 10,
      actual_fy_musd: Math.round(arr.reduce((s, x) => s + Number(x.value_actual_fy ?? 0), 0) / 1e5) / 10,
      children: group(arr, depth + 1) || null,
    }));
    nodes.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return nodes;
  };
  return group(rows, 0);
}

export interface TreeOut {
  levels: string[]; total: number; on_track: number; value_musd: number;
  actual_ytd_musd: number; actual_fy_musd: number; nodes: TreeNode[];
}

export interface CompletenessOut {
  scope: string; fields_scored: number; initiatives: number;
  filled: number; total: number; pct: number; fully_complete: number;
  sections: string[];
  /** Portfolio-wide % per section, cell-weighted across BUs. */
  section_pct: Record<string, number>;
  by_bu: {
    bu_code: string; bu_label: string; initiatives: number; filled: number;
    total: number; pct: number; fully_complete: number;
    sections: Record<string, number>;
  }[];
  field_gaps: { field: string; label: string; missing: number; pct: number }[];
  distribution: Record<string, number>;
  initiatives_detail: Record<string, unknown>[];
}

/** Which scored keys `scope=required` expects of each stage. */
export interface CompletenessRules {
  setting_key: string;
  fields: { key: string; label: string; section: string }[];
  stages: { code: string; label: string }[];
  defaults: Record<string, string[]>;
  rules: Record<string, string[]>;
  customised: boolean;
}

export interface SnapshotResolveOut {
  state: "new" | "revision" | "draft_exists";
  existing_snapshot: SnapshotInfo | null;
  next_revision: number;
  stored_filename: string;
  /** Who the platform says is asking; null when no auth is configured. */
  current_actor: string | null;
}

export interface UploadReport {
  batch_id: string; status: string; snapshot_id: string;
  period_key: string | null; revision: number; state: string | null;
  stored_filename: string | null; original_filename: string | null;
  source_name: string;
  content_sha256: string; initiatives_inserted: number; initiatives_updated: number;
  initiatives_deleted: number; metric_rows: number;
  carried_edits: number; carried_edits_flagged: number;
  warnings: Record<string, unknown>[]; errors: Record<string, unknown>[];
  message: string | null;
  id_checks: IdCheck[];
}

/** Cross-period Initiative ID finding (backend id_check.IdCheck). */
export interface IdCheck {
  bu_code: string; source_initiative_id: string; row: number | null;
  status: "renamed" | "conflict" | "recoded" | "assigned";
  name_score: number | null; attr_score: number | null; confirmed: boolean;
  prev_period: string | null; prev_id: string | null;
  prev_name: string | null; prev_site: string | null; prev_owner: string | null;
  prev_kpi: string | null; prev_value: number | null;
  new_name: string | null; new_site: string | null; new_owner: string | null;
  new_kpi: string | null; new_value: number | null;
}

export const idCheckKey = (c: IdCheck) => `${c.bu_code}|${c.source_initiative_id}`;

/** Blank mass-import workbook, served by the API (plain link, no fetch). */
export const TEMPLATE_URL = `${BASE}/uploads/template`;

/* =============================================================== query keys */
export const keys = {
  meta: ["meta"] as const,
  periods: ["periods"] as const,
  snapshots: ["snapshots"] as const,
  initiatives: (p: unknown) => ["initiatives", p] as const,
  compare: (a: string, b: string, f?: Scope) => ["compare", a, b, f ?? {}] as const,
  top: (a: string, b: string, n: number, basis: TopBasis, f?: Scope) =>
    ["top", a, b, n, basis, f ?? {}] as const,
  monthly: (s: string, f?: Scope) => ["monthly", s, f ?? {}] as const,
  quarters: (s: string, by: string, f?: Scope) => ["quarters", s, by, f ?? {}] as const,
  stageMatrix: (s: string, f?: Scope) => ["stage-matrix", s, f ?? {}] as const,
  tree: (s: string, l: string[], f?: Scope) => ["tree", s, l.join(">"), f ?? {}] as const,
  completeness: (s: string, scope: string, f?: Scope) =>
    ["completeness", s, scope, f ?? {}] as const,
  completenessRules: ["completeness-rules"] as const,
  setting: (key: string) => ["setting", key] as const,
};

const FRESH = { staleTime: 60_000 } as const;
const keep = { placeholderData: keepPreviousData } as const;

/* ==================================================================== hooks */
export function useMeta(options?: Partial<UseQueryOptions<MetaOut>>) {
  return useQuery({
    queryKey: keys.meta,
    queryFn: () => api.get<MetaOut>("/meta"),
    staleTime: 5 * 60_000,
    ...options,
  });
}

/** Snapshot/year options, refetched after an upload so a new quarter appears. */
export function usePeriods() {
  return useQuery({
    queryKey: keys.periods,
    queryFn: () => api.get<PeriodOptions>("/meta/periods"),
    staleTime: 60_000,
  });
}

export interface InitiativeFilters {
  snapshot?: string;
  filters?: Record<string, string[]>;
  search?: string;
  include_metrics?: boolean;
  limit?: number;
}

/** The Portfolio filter bar, sent to an analytic. Omitted = whole snapshot. */
export type Scope = Pick<InitiativeFilters, "filters" | "search">;

/** `filters` is flattened to repeated `filter=column:value` -- registry-generic. */
function flatten(f: InitiativeFilters) {
  const filter = Object.entries(f.filters ?? {}).flatMap(([col, vals]) =>
    vals.map((v) => `${col}:${v}`));
  return {
    snapshot: f.snapshot, search: f.search,
    include_metrics: f.include_metrics, limit: f.limit, filter,
  };
}

export function useInitiatives(f: InitiativeFilters) {
  return useQuery({
    queryKey: keys.initiatives(f),
    queryFn: () => api.get<InitiativeList>("/initiatives", flatten(f)),
    enabled: Boolean(f.snapshot),
    ...keep, ...FRESH,
  });
}

export function useCompare(a?: string, b?: string, scope?: Scope) {
  return useQuery({
    queryKey: keys.compare(a ?? "", b ?? "", scope),
    queryFn: () => api.get<CompareOut>("/analytics/compare",
      { ...flatten({ ...scope, snapshot: b }), baseline: a }),
    enabled: Boolean(a && b), ...keep, ...FRESH,
  });
}

export function useTop(a?: string, b?: string, limit = 10, basis: TopBasis = "target",
                       scope?: Scope) {
  return useQuery({
    queryKey: keys.top(a ?? "", b ?? "", limit, basis, scope),
    queryFn: () => api.get<TopOut>("/analytics/top",
      { ...flatten({ ...scope, snapshot: b }), baseline: a, limit, basis }),
    enabled: Boolean(a && b), ...keep, ...FRESH,
  });
}

export function useMonthly(snapshot?: string, scope?: Scope) {
  return useQuery({
    queryKey: keys.monthly(snapshot ?? "", scope),
    queryFn: () => api.get<MonthlySeries>("/analytics/monthly",
      { ...flatten({ ...scope, snapshot }) }),
    enabled: Boolean(snapshot), ...keep, ...FRESH,
  });
}

export function useQuarters(snapshot?: string, stackBy = "stage_code", scope?: Scope) {
  return useQuery({
    queryKey: keys.quarters(snapshot ?? "", stackBy, scope),
    queryFn: () => api.get<QuarterOut>("/analytics/quarters",
      { ...flatten({ ...scope, snapshot }), stack_by: stackBy }),
    enabled: Boolean(snapshot), ...keep, ...FRESH,
  });
}

export function useStageMatrix(snapshot?: string, scope?: Scope) {
  return useQuery({
    queryKey: keys.stageMatrix(snapshot ?? "", scope),
    queryFn: () => api.get<StageMatrixOut>("/analytics/stage-matrix",
      { ...flatten({ ...scope, snapshot }) }),
    enabled: Boolean(snapshot), ...keep, ...FRESH,
  });
}

export function useTree(snapshot?: string, levels: string[] = [], scope?: Scope) {
  return useQuery({
    queryKey: keys.tree(snapshot ?? "", levels, scope),
    queryFn: () => api.get<TreeOut>("/analytics/tree",
      { ...flatten({ ...scope, snapshot }), levels }),
    enabled: Boolean(snapshot) && levels.length > 0, ...keep, ...FRESH,
  });
}

export function useCompleteness(snapshot?: string, scope: "required" | "all" = "required",
                                filters?: Scope) {
  return useQuery({
    queryKey: keys.completeness(snapshot ?? "", scope, filters),
    queryFn: () => api.get<CompletenessOut>("/analytics/completeness",
      { ...flatten({ ...filters, snapshot }), scope }),
    enabled: Boolean(snapshot), ...keep, ...FRESH,
  });
}

export function useCompletenessRules() {
  return useQuery({
    queryKey: keys.completenessRules,
    queryFn: () => api.get<CompletenessRules>("/analytics/completeness/rules"),
    ...FRESH,
  });
}

/* ============================================================== mutations = */

/**
 * The sync contract for the Initiatives tab.
 *
 * Optimistic: the row updates in place immediately, the server response
 * replaces it, and a failure rolls the cache back and surfaces the API's own
 * validation message. `invalidateQueries` then refreshes every analytic that
 * depended on the row -- editing a value target moves the treemap without a
 * page reload, because the cache key graph already expresses that dependency.
 */
export function usePatchInitiative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; patch: Record<string, unknown> }) =>
      api.patch<Initiative>(`/initiatives/${v.id}`, v.patch),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["initiatives"] });
      const prev = qc.getQueriesData<InitiativeList>({ queryKey: ["initiatives"] });
      prev.forEach(([key, data]) => {
        if (!data) return;
        qc.setQueryData<InitiativeList>(key, {
          ...data,
          items: data.items.map((r) => (r.id === v.id ? { ...r, ...v.patch } : r)),
        });
      });
      return { prev };
    },
    onError: (_e, _v, ctx) =>
      ctx?.prev.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => void qc.invalidateQueries(),
  });
}

export function useCreateInitiative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<Initiative>("/initiatives", body),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useDeleteInitiative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ deleted: boolean }>(`/initiatives/${id}`),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export type PeriodType = "FY" | "H" | "Q" | "M";

/** Cheap pre-submit lookup for the period builder -- no file involved yet. */
export function useResolvePeriod(fiscalYear?: number, periodType?: PeriodType,
                                 periodOrdinal?: number | null) {
  return useQuery({
    queryKey: ["snapshot-resolve", fiscalYear, periodType, periodOrdinal],
    queryFn: () => api.get<SnapshotResolveOut>("/snapshots/resolve", {
      fiscal_year: fiscalYear, period_type: periodType,
      period_ordinal: periodOrdinal ?? undefined,
    }),
    enabled: Boolean(fiscalYear && periodType
      && (periodType === "FY" || periodOrdinal != null)),
    staleTime: 10_000,
  });
}

export function useUploadExcel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      file: File; fiscalYear: number; periodType: PeriodType;
      periodOrdinal: number | null; label?: string; reason?: string;
      dryRun: boolean; force: boolean; confirmedIds?: string[];
    }) => {
      const form = new FormData();
      form.append("file", v.file);
      form.append("fiscal_year", String(v.fiscalYear));
      form.append("period_type", v.periodType);
      if (v.periodOrdinal != null) form.append("period_ordinal", String(v.periodOrdinal));
      if (v.label) form.append("label", v.label);
      if (v.reason) form.append("reason", v.reason);
      form.append("dry_run", String(v.dryRun));
      form.append("force", String(v.force));
      if (v.confirmedIds?.length) form.append("confirmed_ids", JSON.stringify(v.confirmedIds));
      return api.upload<UploadReport>("/uploads/excel", form);
    },
    onSuccess: (report) => {
      // A dry run wrote nothing. A real load may have created a new snapshot,
      // so the period options have to be refetched too.
      if (report.status === "loaded") void qc.invalidateQueries();
    },
  });
}

/**
 * Every snapshot, unfiltered -- what the Snapshots page lists. Distinct from
 * `usePeriods`, which returns only what a picker may offer and therefore
 * hides locked, archived and other users' draft snapshots.
 */
export function useAllSnapshots() {
  return useQuery({
    queryKey: keys.snapshots,
    queryFn: () => api.get<SnapshotInfo[]>("/snapshots"),
    ...FRESH,
  });
}

/** draft -> published. Locks the prior published revision of the same period. */
export function usePublishSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api.post<SnapshotInfo>(`/snapshots/${snapshotId}/publish`, {}),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/** published -> locked, manually. Corrections after this require a new revision. */
export function useCloseSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api.post<SnapshotInfo>(`/snapshots/${snapshotId}/close`, {}),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/**
 * locked -> published, reversing a sign-off. Restricted server-side to the
 * operators in UNLOCK_ADMINS, so this 403s for everyone else.
 */
export function useReopenSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api.del<SnapshotInfo>(`/snapshots/${snapshotId}/close`),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/**
 * Designates a snapshot as its fiscal year's plan/budget baseline -- the
 * fixed anchor "plan" comparison mode resolves to, regardless of which
 * period is currently selected. Implies `pinned`. Exactly one snapshot per
 * fiscal year can hold this; setting it clears any other.
 */
export function useSetPlanBaseline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api.post<SnapshotInfo>(`/snapshots/${snapshotId}/plan-baseline`, {}),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useClearPlanBaseline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snapshotId: string) => api.del<SnapshotInfo>(`/snapshots/${snapshotId}/plan-baseline`),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/**
 * Withdraws a snapshot from every picker without destroying anything --
 * reversible via `useRestoreSnapshot`. Refused with 409 while the snapshot
 * is the plan baseline.
 */
export function useArchiveSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api.post<SnapshotInfo>(`/snapshots/${snapshotId}/archive`, {}),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

export function useRestoreSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (snapshotId: string) =>
      api.del<SnapshotInfo>(`/snapshots/${snapshotId}/archive`),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/** Edits label / notes / pinned. Send only the fields that changed. */
export function usePatchSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SnapshotPatch }) =>
      api.patch<SnapshotInfo>(`/snapshots/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries(),
  });
}

/**
 * Shared UI/presentation configuration -- e.g. the funnel stage order. Distinct
 * from overrides, which curate figures, not display config. `payload` is
 * `null` when nothing has been saved under `key` yet.
 */
export function useSetting<T>(key: string) {
  return useQuery({
    queryKey: keys.setting(key),
    queryFn: () => api.get<{ key: string; payload: T } | null>(`/settings/${key}`),
    enabled: Boolean(key), ...FRESH,
  });
}

export function usePutSetting(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.put(`/settings/${key}`, { payload }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.setting(key) }),
  });
}

export function useDeleteSetting(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/settings/${key}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.setting(key) }),
  });
}

/* ================================================================ helpers = */
export const fmt = {
  musd: (v: number | null | undefined, d = 1) =>
    v == null ? "—" : `$${v.toFixed(d)}M`,
  int: (v: number | null | undefined) =>
    v == null ? "—" : Math.round(v).toLocaleString("en-US"),
  pct: (v: number | null | undefined, d = 1) =>
    v == null ? "—" : `${v.toFixed(d)}%`,
  delta: (v: number | null | undefined, unit = "") =>
    v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}${unit}`,
  date: (v: unknown) =>
    !v ? "—" : new Date(String(v)).toLocaleDateString("en-CA"),
};

/** Value -> display label, using the vocabulary the server sent. */
export function labeller(registry?: Registry) {
  return (column: string, code: unknown): string => {
    if (code == null || code === "") return "—";
    const spec = registry?.fields.find((f) => f.column === column);
    if (!spec?.vocab) return String(code);
    const term = registry?.vocab[spec.vocab]?.terms.find((t) => t.code === code);
    return term?.label ?? String(code);
  };
}

/** Vocabulary colours, so charts and the register agree without a second palette. */
export function colourer(registry?: Registry) {
  const FALLBACK = ["#2C6E9B", "#3E9E74", "#C77D28", "#7E5AA6", "#C0574E",
    "#6B7785", "#2C7FB8", "#1FA971", "#E8A93C", "#E03E2D"];
  return (column: string, code: string, index = 0): string => {
    const spec = registry?.fields.find((f) => f.column === column);
    if (spec?.vocab) {
      const term = registry?.vocab[spec.vocab]?.terms.find((t) => t.code === code);
      if (term?.color_hex) return term.color_hex;
    }
    return FALLBACK[index % FALLBACK.length];
  };
}
