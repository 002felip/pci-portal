/**
 * Snapshots — the whole lifecycle of a reporting period on one screen:
 * upload, publish, lock, archive, restore, plan baseline, and editing the
 * three operator-owned fields.
 *
 * The table reads `GET /snapshots`, not `/meta/periods`. Those answer
 * different questions: `/meta/periods` is the *picker's* view and therefore
 * hides locked, archived and other users' draft snapshots, which is exactly
 * the set an administrator needs to see. Everything else on this page
 * (including the plan-baseline radios) stays on the picker view, because
 * those controls should only ever offer a period a reader could select.
 *
 * The period builder below is dropdown-only (spec step 3): fiscal year,
 * period type and ordinal are bounded selects, so an invalid or malformed
 * period is unrepresentable in the UI, not merely rejected after submission.
 * `period_key` is always derived server-side from those three values -- the
 * dropdowns constrain the *shape* of a period, never its *novelty*; a period
 * that has never been loaded before is still selectable, because uploading
 * is how a new period comes into existence.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useDropzone } from "react-dropzone";
import { useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";

import {
  fmt, useAllSnapshots, useArchiveSnapshot, useClearPlanBaseline, useCloseSnapshot,
  useMeta, usePatchSnapshot, usePublishSnapshot, useReopenSnapshot,
  useResolvePeriod, useRestoreSnapshot,
  useSetPlanBaseline, useUploadExcel,
  type PeriodType, type SnapshotInfo, type SnapshotPatch, type UploadReport,
} from "../api";
import { PageHead } from "../App";
import { useChartTooltip } from "../ChartTooltip";
import {
  DataTable, Empty, Kpi, Loading, Panel, Problem, Select, usePeriod,
} from "../ui";

const CURRENT_FY = new Date().getFullYear();
const FISCAL_YEARS = [CURRENT_FY + 1, CURRENT_FY, CURRENT_FY - 1, CURRENT_FY - 2];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const PERIOD_TYPES: { value: PeriodType; label: string }[] = [
  { value: "Q", label: "Quarter" }, { value: "M", label: "Month" },
  { value: "H", label: "Half-year" }, { value: "FY", label: "Full year" },
];

function ordinalOptions(pt: PeriodType): { value: string; label: string }[] {
  if (pt === "Q") return [1, 2, 3, 4].map((n) => ({ value: String(n), label: `Q${n}` }));
  if (pt === "H") return [{ value: "1", label: "H1 (Jan–Jun)" },
    { value: "2", label: "H2 (Jul–Dec)" }];
  if (pt === "M") return MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));
  return [];
}

function buildPeriodKey(fy: number, pt: PeriodType, ord: number | null): string {
  if (pt === "FY") return `${fy}-FY`;
  if (pt === "M") return `${fy}-M${String(ord ?? 0).padStart(2, "0")}`;
  return `${fy}-${pt}${ord ?? ""}`;
}

function standardLabel(fy: number, pt: PeriodType, ord: number | null): string {
  if (pt === "FY") return `FY ${fy}`;
  if (pt === "Q") return `Q${ord} ${fy}`;
  if (pt === "H") return `H${ord} ${fy}`;
  if (pt === "M") return `${MONTHS[(ord ?? 1) - 1]} ${fy}`;
  return String(fy);
}

type LabelPreset = "standard" | "close" | "forecast" | "restated" | "custom";
const LABEL_PRESETS: { value: LabelPreset; label: string }[] = [
  { value: "standard", label: "Standard" }, { value: "close", label: "Close" },
  { value: "forecast", label: "Forecast" }, { value: "restated", label: "Restated" },
  { value: "custom", label: "Custom…" },
];

function presetLabel(preset: LabelPreset, base: string): string {
  if (preset === "close") return `${base} close`;
  if (preset === "forecast") return `${base} forecast`;
  if (preset === "restated") return `${base} restated`;
  return base;
}

export default function SnapshotsPage() {
  const [manual, setManual] = useState(false);
  return (
    <>
      {/* Deliberately not wrapped in WhenReady: that short-circuits when no
          snapshot exists, which is precisely when the upload panel is needed. */}
      <PageHead title="Snapshots"
        blurb="Every reporting period ever loaded — publish, lock, archive and edit.">
        <button className="ghost" onClick={() => setManual(true)}>
          How snapshots work
        </button>
      </PageHead>
      <Registry />
      <Upload />
      {manual && <Manual onClose={() => setManual(false)} />}
    </>
  );
}

/* ================================================================ manual = */
/**
 * The lifecycle, in the operator's language. Written here rather than in a
 * wiki because the rules it describes are enforced by the buttons on this
 * page -- the two drift apart the moment they live in different places.
 */
function Manual({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide manual" onClick={(e) => e.stopPropagation()}>
        <h3>How snapshots work</h3>
        <p className="sm">
          A snapshot is one reporting period — one workbook, loaded once. The
          cockpit never edits a period's history in place: what leadership saw
          on a given date has to stay recoverable, so a correction is a new
          load, not an overwrite. Everything below follows from that.
        </p>

        <h4>The three phases</h4>
        <p className="sm">
          Every snapshot moves in one direction: <b>draft → published → locked</b>.
          Only the last step can be walked back, and only by an authorised
          operator. The phase controls two separate things — who can see the
          period in a picker, and whether its numbers can still change.
        </p>
        <div className="tablewrap">
          <table className="grid dense">
            <thead>
              <tr>
                <th>Phase</th><th>Who sees it</th><th>Can the data change?</th>
                <th>Why it exists</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><i className="pill sm warn">draft</i></td>
                <td>Only whoever loaded it</td>
                <td>Yes</td>
                <td>Somewhere to check a workbook before anyone reports off it.
                  A half-finished load never reaches the front page.</td>
              </tr>
              <tr>
                <td><i className="pill sm good">published</i></td>
                <td>Everyone, in every picker</td>
                <td>Yes</td>
                <td>The working period. Numbers are trusted enough to compare
                  and present, and small corrections are still allowed.</td>
              </tr>
              <tr>
                <td><i className="pill sm">locked</i></td>
                <td>Everyone, in every picker</td>
                <td>No</td>
                <td>The sealed record of what leadership saw. Frozen so a figure
                  in a board pack still means the same thing a year later — but
                  still open on the portfolio pages, because a closed quarter is
                  exactly what gets revisited.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h4>Publishing vs. locking</h4>
        <p className="sm">
          They are often confused because both are one-way, but they do opposite
          jobs. <b>Publishing makes a period visible</b> — it promotes your private
          draft into everyone's period picker, and is refused on an empty snapshot.
          <b> Locking makes a period final</b> — it freezes the numbers so nothing
          can be edited again, while leaving the period in the pickers so it can
          still be read. To take a period out of circulation entirely, archive it.
        </p>
        <p className="sm">
          Publish when the load is good. Lock when the quarter is closed and the
          figures have been reported. Between those two points the period is live
          and correctable, which is where it should spend most of its life. If a
          locked quarter genuinely has to be corrected in place, an operator named
          in <code>UNLOCK_ADMINS</code> can reopen it; anyone else gets a refusal.
        </p>

        <h4>Locked is frozen, not hidden</h4>
        <p className="sm">
          A locked period stays in the pickers, answers to a direct link, and
          comparisons still run against it — a closed quarter is precisely what
          leadership comes back to on the portfolio pages. Locking only stops the
          numbers changing. A deck citing Q1 keeps working after Q1 is locked, and
          so does the dropdown. If the dropdowns get long, that is what
          <b> Pinned</b> and "Show all years" are for; if a period should not be
          in the list at all, archive it.
        </p>

        <h4>Archiving — the separate question</h4>
        <p className="sm">
          Archiving is not a fourth phase; it answers a different question. The
          phases ask <i>how final is this period?</i> Archiving asks <i>should this
          period be in the pickers at all?</i> — the answer for a wrong workbook, a
          mis-typed period or a test upload. It is the only thing that hides a
          period; locking does not.
        </p>
        <p className="sm">
          So any snapshot can be archived whatever its phase, and restoring it
          returns it to exactly the phase it held. Nothing is deleted: the period,
          its initiatives and its history all survive, and it stays reachable by a
          direct link. Archiving is reversible by anyone — either with
          <b> Restore</b> here, or simply by loading that period again, which
          brings it back automatically.
        </p>
        <p className="sm">
          One refusal: a period that is the plan baseline cannot be archived, since
          the "Vs. plan" comparison would lose its anchor. Clear the plan baseline
          first.
        </p>

        <h4>Revisions</h4>
        <p className="sm">
          Loading a workbook for a period that already exists creates a revision:
          the revision number goes up, the period returns to draft, and you are
          asked for a reason — which is kept against the period permanently. Use a
          revision when the numbers were wrong. Use archiving when the period
          should never have been loaded.
        </p>

        <h4>The two flags</h4>
        <dl className="sm">
          <dt>Pinned</dt>
          <dd>Keeps a period in the picker no matter how old it gets. Without it,
            older years collapse behind "Show all years". Toggle it straight from
            the <b>Pinned</b> column — a locked period can still be pinned, since
            that is placement, not figures.</dd>
          <dt>Plan baseline</dt>
          <dd>The fixed anchor "Vs. plan" compares against for a fiscal year,
            whichever period is currently selected. One per fiscal year, and it is
            always pinned — an un-pinned baseline could age out of the picker and
            stop resolving.</dd>
        </dl>

        <h4>What you can edit</h4>
        <p className="sm">
          Click any row to change its <b>label</b> and <b>notes</b>; the pin also
          toggles directly in its column.
          Everything else — the period it covers, its revision number, its phase —
          is derived from the load or owned by the buttons above, so that two
          people reading "2026-Q3" are always reading the same quarter.
        </p>

        <div className="modal-actions">
          <button className="primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================= icons = */
/**
 * Inline rather than an icon package: six glyphs do not justify a dependency,
 * and `currentColor` lets one button class drive every tone.
 */
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

const ICON = {
  publish: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 16.5V8" />
    <path d="m8.5 11.5 3.5-3.5 3.5 3.5" /></>),
  lock: svg(<><rect x="4" y="10.5" width="16" height="10" rx="2" />
    <path d="M7.75 10.5V7a4.25 4.25 0 0 1 8.5 0v3.5" /></>),
  archive: svg(<><rect x="3" y="3.75" width="18" height="4.5" rx="1" />
    <path d="M5 8.25v10.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V8.25" />
    <path d="M10 12.5h4" /></>),
  restore: svg(<><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3 8.6" />
    <path d="M3 3.6v5h5" /></>),
  star: svg(<path d="m12 3.6 2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83L6.62 20.25l1.03-6L3.3 10l6-.9L12 3.6Z" />),
  unlock: svg(<><rect x="4" y="10.5" width="16" height="10" rx="2" />
    <path d="M7.75 10.5V7a4.25 4.25 0 0 1 8.13-1.7" /></>),
  pin: svg(<><path d="M12 13.5V21" /><path d="M8 3.75h8l-1 6 2.5 2.25H6.5L9 9.75l-1-6Z" /></>),
} as const;

/** Same pin, filled, so a pinned period reads at a glance down the column. */
const ICON_PIN_ON = (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M12 13.5V21" /><path d="M8 3.75h8l-1 6 2.5 2.25H6.5L9 9.75l-1-6Z" />
  </svg>
);

/** Same star, filled, so a set plan baseline reads at a glance. */
const ICON_STAR_ON = (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8"
    strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m12 3.6 2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83L6.62 20.25l1.03-6L3.3 10l6-.9L12 3.6Z" />
  </svg>
);

/**
 * An icon-only button. The label is mandatory: it is both the accessible name
 * and the hover tooltip, so an icon can never ship without its explanation.
 *
 * Reuses the app's one floating tooltip (`useChartTooltip`), which is mounted
 * at the root and positioned `fixed` -- a CSS tooltip would be clipped by
 * `.tablewrap`'s scroll container the moment the actions column overflowed.
 */
function IconButton({ icon, label, tone, disabledReason, onClick }: {
  icon: ReactNode;
  label: string;
  tone?: "danger" | "on";
  /** When set, the button is inert and the tooltip says why. */
  disabledReason?: string;
  onClick: () => void;
}) {
  const tip = useChartTooltip();
  const off = Boolean(disabledReason);
  const text = disabledReason ?? label;

  return (
    <button type="button" className={`iconbtn${tone ? ` ${tone}` : ""}`}
      aria-label={text} aria-disabled={off || undefined}
      onMouseEnter={(e) => tip.show(e, text)}
      onMouseMove={(e) => tip.move(e)}
      onMouseLeave={tip.hide}
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        tip.show({ clientX: r.left, clientY: r.bottom }, text);
      }}
      onBlur={tip.hide}
      onClick={(e) => {
        // The row itself opens the edit drawer; an action must not also trigger it.
        e.stopPropagation();
        if (off) return;
        tip.hide();
        onClick();
      }}>
      {icon}
    </button>
  );
}

/* ============================================================== registry = */
/** Archive is orthogonal to `state`, so the single status a reader cares
 *  about is "archived, else whatever state it holds". */
type Status = SnapshotInfo["state"] | "archived";
const statusOf = (s: SnapshotInfo): Status => (s.archived_at ? "archived" : s.state);

const FILTERS: { value: Status | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "locked", label: "Locked" },
  { value: "archived", label: "Archived" },
];

const STATUS_TONE: Record<Status, string> = {
  draft: "warn", published: "good", locked: "", archived: "",
};

/** What the operator is being asked to confirm, and what to run if they do. */
interface Confirmation {
  title: string;
  body: ReactNode;
  cta: string;
  run: () => void;
}

function Registry() {
  const { data: snapshots, isLoading, error } = useAllSnapshots();
  const { snapshot: selected, set } = usePeriod();

  const archive = useArchiveSnapshot();
  const restore = useRestoreSnapshot();
  const publish = usePublishSnapshot();
  const close = useCloseSnapshot();
  const reopen = useReopenSnapshot();
  const setBaseline = useSetPlanBaseline();
  const clearBaseline = useClearPlanBaseline();
  // Backs the pinned column's toggle, so pinning never needs the detail panel.
  const patchPin = usePatchSnapshot();

  const [filter, setFilter] = useState<Status | "all">("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<SnapshotInfo | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);

  const busy = archive.isPending || restore.isPending || publish.isPending
    || close.isPending || reopen.isPending || setBaseline.isPending
    || clearBaseline.isPending || patchPin.isPending;

  const mutationError = archive.error ?? restore.error ?? publish.error
    ?? close.error ?? reopen.error ?? setBaseline.error ?? clearBaseline.error
    ?? patchPin.error;

  /**
   * Withdrawing the currently-selected period would otherwise leave the URL
   * carrying an id no picker can offer. Clearing it lets the resolver's own
   * defaults take over.
   */
  const dropSelectionIf = (id: string) => {
    if (id === selected) set({ snapshot: undefined, baseline: undefined });
  };

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: snapshots?.length ?? 0 };
    for (const s of snapshots ?? []) {
      const k = statusOf(s);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }, [snapshots]);

  const rows = useMemo(() => (snapshots ?? [])
    .filter((s) => filter === "all" || statusOf(s) === filter)
    // Newest first: an administrator is nearly always here about a recent load.
    .slice()
    .reverse(), [snapshots, filter]);

  const columns = useMemo<ColumnDef<SnapshotInfo, any>[]>(() => [
    {
      id: "period_key", accessorKey: "period_key", header: "Period", size: 100,
      cell: (ctx) => <span className="cell" title="Identity — permanent, never changes">
        {ctx.getValue()}</span>,
    },
    {
      id: "label", accessorKey: "label", header: "Label", size: 190,
      cell: (ctx) => <span className="cell">{ctx.getValue()}
        {ctx.row.original.is_baseline
          && <i className="pill sm" title="Plan baseline for its fiscal year">plan</i>}
        {ctx.row.original.needs_review
          && <i className="pill sm warn" title="Period derived from a legacy code — confirm the fiscal year">check</i>}
      </span>,
    },
    {
      id: "status", accessorFn: (r) => statusOf(r), header: "Status", size: 90,
      cell: (ctx) => {
        const st = statusOf(ctx.row.original) as Status;
        return <i className={`pill sm ${STATUS_TONE[st]}`}>{st}</i>;
      },
    },
    { id: "revision", accessorKey: "revision", header: "Rev", size: 50 },
    {
      id: "initiative_count", accessorKey: "initiative_count",
      header: "Initiatives", size: 80, sortingFn: "basic",
      cell: (ctx) => <span className="cell">{fmt.int(ctx.getValue())}</span>,
    },
    {
      // Toggled in place: pinning is a one-click judgement about picker
      // placement, so it should not cost a trip through the detail panel.
      id: "pinned", accessorKey: "pinned", header: "Pinned", size: 60,
      cell: (ctx) => {
        const row = ctx.row.original;
        const on = Boolean(ctx.getValue());
        return (
          <span className="cell">
            <IconButton icon={on ? ICON_PIN_ON : ICON.pin} tone={on ? "on" : undefined}
              label={on ? `Unpin ${row.label}` : `Pin ${row.label} — keep it in the pickers`}
              disabledReason={busy ? "Another action is still running…"
                : (on && row.is_baseline
                  ? `${row.label} is the FY${row.fiscal_year} plan baseline, which must `
                    + `stay pinned — clear the baseline first`
                  : undefined)}
              onClick={() => patchPin.mutate({ id: row.id, patch: { pinned: !on } })} />
          </span>
        );
      },
    },
    {
      id: "notes", accessorKey: "notes", header: "Notes", size: 200,
      cell: (ctx) => <span className="cell" title={ctx.getValue() ?? undefined}>
        {ctx.getValue() ?? "—"}</span>,
    },
    {
      // ISO-8601 strings sort chronologically as plain text, so the default
      // comparator is already right; `sortUndefined` keeps the periods that
      // predate the column from crowding the top of a descending sort.
      id: "uploaded_at", accessorFn: (r) => r.uploaded_at ?? undefined,
      header: "Uploaded", size: 100, sortUndefined: "last",
      cell: (ctx) => <span className="cell"
        title={ctx.row.original.uploaded_at
          ? new Date(ctx.row.original.uploaded_at).toLocaleString()
          : "Loaded before upload times were recorded"}>
        {fmt.date(ctx.getValue())}</span>,
    },
    {
      id: "created_by", accessorKey: "created_by", header: "Loaded by", size: 150,
      cell: (ctx) => <span className="cell">{ctx.getValue() ?? "—"}</span>,
    },
    {
      id: "published_at", accessorKey: "published_at", header: "Published", size: 100,
      cell: (ctx) => <span className="cell">{fmt.date(ctx.getValue())}</span>,
    },
    {
      id: "archived_at", accessorKey: "archived_at", header: "Archived", size: 100,
      cell: (ctx) => <span className="cell" title={ctx.row.original.archived_by ?? undefined}>
        {fmt.date(ctx.getValue())}</span>,
    },
    {
      id: "__actions", header: "", enableSorting: false, size: 110,
      cell: (ctx) => <Actions row={ctx.row.original} />,
    },
  // Actions close over the mutations and the confirm dialog, so the column
  // list has to be rebuilt when those change identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [busy, selected]);

  /** Which verbs a row offers is entirely a function of its status. */
  function Actions({ row }: { row: SnapshotInfo }) {
    const st = statusOf(row);
    const working = busy ? "Another action is still running…" : undefined;

    if (st === "archived") {
      return (
        <span className="rowactions">
          <IconButton icon={ICON.restore} label="Restore — put it back in the pickers"
            disabledReason={working} onClick={() => restore.mutate(row.id)} />
        </span>
      );
    }

    return (
      <span className="rowactions">
        {st === "draft" && (
          <IconButton icon={ICON.publish}
            label="Publish — make this period visible to everyone"
            disabledReason={working
              ?? (row.initiative_count === 0
                ? "Nothing to publish: this snapshot has no initiatives"
                : undefined)}
            onClick={() => publish.mutate(row.id)} />
        )}
        {st === "published" && (
          <IconButton icon={ICON.lock}
            label="Lock — freeze the figures permanently"
            disabledReason={working}
            onClick={() => setConfirming({
              title: `Lock ${row.label}?`,
              body: <p>A locked snapshot is the record of what leadership saw: no
                initiative or override on it can be edited again, and corrections
                require uploading a new revision. It <b>stays in every picker</b>, so
                the portfolio pages can still be opened against it. Only an
                authorised operator can reopen it.</p>,
              cta: "Lock",
              // No dropSelectionIf: a locked period stays selectable, so the
              // URL may keep pointing at it.
              run: () => close.mutate(row.id, {
                onSuccess: () => setConfirming(null),
              }),
            })} />
        )}
        {st === "locked" && (
          <IconButton icon={ICON.unlock}
            label="Reopen — make this period editable again (authorised operators only)"
            disabledReason={working}
            onClick={() => setConfirming({
              title: `Reopen ${row.label}?`,
              body: <p>This returns the period to <b>published</b>, making its
                initiatives and overrides editable again — so the figures leadership
                signed off on can change. The lock history is kept. Restricted to the
                operators in <code>UNLOCK_ADMINS</code>; it will be refused otherwise.</p>,
              cta: "Reopen",
              run: () => reopen.mutate(row.id, {
                onSuccess: () => setConfirming(null),
              }),
            })} />
        )}
        {st !== "locked" && (row.is_baseline
          ? <IconButton icon={ICON_STAR_ON} tone="on"
            label={`Clear — stop using this as the FY${row.fiscal_year} plan baseline`}
            disabledReason={working}
            onClick={() => clearBaseline.mutate(row.id)} />
          : <IconButton icon={ICON.star}
            label={`Set as the FY${row.fiscal_year} plan baseline`}
            disabledReason={working}
            onClick={() => setBaseline.mutate(row.id)} />)}
        <IconButton icon={ICON.archive} tone="danger"
          label="Archive — withdraw it from the pickers, reversibly"
          disabledReason={working}
          onClick={() => setConfirming({
            title: `Archive ${row.label}?`,
            body: <p>It disappears from every period picker and stops being comparable
              by default. Nothing is deleted — its {fmt.int(row.initiative_count)} initiative(s)
              and its history survive, and you can restore it from this table.</p>,
            cta: "Archive",
            run: () => archive.mutate(row.id, {
              onSuccess: () => { dropSelectionIf(row.id); setConfirming(null); },
            }),
          })} />
      </span>
    );
  }

  if (error) return <Problem error={error} />;

  return (
    <Panel title="All snapshots"
      actions={<div className="chips">
        {FILTERS.map((f) => (
          <button key={f.value}
            className={filter === f.value ? "chip on" : "chip"}
            onClick={() => setFilter(f.value)}>
            {f.label} {counts[f.value] ?? 0}
          </button>
        ))}
      </div>}>
      {isLoading ? <Loading what="snapshots" /> : (
        <>
          <div className="filterbar">
            <input type="search" placeholder="Search label, period, loader…"
              value={query} onChange={(e) => setQuery(e.target.value)} />
            <span className="filter-count muted sm">{rows.length} of {counts.all}</span>
          </div>
          {mutationError && <Problem error={mutationError} prefix="Could not save" />}
          {rows.length === 0
            ? <Empty>No {filter === "all" ? "" : filter} snapshots.</Empty>
            : <DataTable data={rows} columns={columns} globalFilter={query}
              dense onRowClick={setEditing} />}
          <p className="muted sm">
            Click a row to edit its label, notes and pin. Period, revision and
            state are derived — they change only by uploading or by the actions above.
          </p>
        </>
      )}

      {editing && <Editor snapshot={editing} onClose={() => setEditing(null)} />}
      {confirming && <Confirm confirmation={confirming} busy={busy}
        onCancel={() => setConfirming(null)} />}
    </Panel>
  );
}

/* ================================================================ editor = */
/** Accumulates a diff and PATCHes only the dirty keys, so two people editing
 *  different fields of the same snapshot do not overwrite each other. */
function Editor({ snapshot, onClose }: { snapshot: SnapshotInfo; onClose: () => void }) {
  const patch = usePatchSnapshot();
  const [draft, setDraft] = useState<SnapshotPatch>({});

  const value = <K extends keyof SnapshotPatch>(k: K): SnapshotPatch[K] =>
    (k in draft ? draft[k] : (snapshot[k as keyof SnapshotInfo] as SnapshotPatch[K]));

  const edit = <K extends keyof SnapshotPatch>(k: K, v: SnapshotPatch[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const dirty = (Object.keys(draft) as (keyof SnapshotPatch)[])
    .filter((k) => draft[k] !== (snapshot[k as keyof SnapshotInfo] ?? null));

  const save = () => {
    if (!dirty.length) return;
    const body = Object.fromEntries(dirty.map((k) => [k, draft[k]])) as SnapshotPatch;
    patch.mutate({ id: snapshot.id, patch: body }, { onSuccess: onClose });
  };

  const archived = Boolean(snapshot.archived_at);
  const readOnly = archived || snapshot.state === "locked";

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>
            <h3>{snapshot.label}</h3>
            <p className="muted sm">{snapshot.period_key} · revision {snapshot.revision}</p>
          </div>
          <button className="link" onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className="drawer-body">
          {readOnly && (
            <p className="muted sm">
              This snapshot is {archived ? "archived" : "locked"} and cannot be
              edited. {archived ? "Restore it" : "Upload a new revision"} first.
            </p>
          )}

          <fieldset>
            <legend>Editable</legend>
            <div className="formrow">
              <span className="formlabel">Label</span>
              <input type="text" maxLength={120} disabled={readOnly}
                value={value("label") ?? ""}
                onChange={(e) => edit("label", e.target.value)} />
            </div>
            <div className="formrow">
              <span className="formlabel">Notes</span>
              <textarea rows={3} disabled={readOnly} value={value("notes") ?? ""}
                onChange={(e) => edit("notes", e.target.value)} />
            </div>
            <div className="formrow">
              <span className="formlabel">Pinned</span>
              <label className="check">
                <input type="checkbox" disabled={readOnly}
                  checked={Boolean(value("pinned"))}
                  onChange={(e) => edit("pinned", e.target.checked)} />
                Always offer this period in the picker, whatever its age
              </label>
            </div>
            {snapshot.is_baseline && (
              <p className="muted sm">
                This is the FY{snapshot.fiscal_year} plan baseline, which resolves
                only to a pinned snapshot — clear the plan baseline before unpinning.
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend>Derived — changes only by uploading</legend>
            <Facts snapshot={snapshot} />
          </fieldset>
        </div>

        <div className="drawer-actions">
          <button className="primary" onClick={save}
            disabled={!dirty.length || patch.isPending || readOnly}>
            {patch.isPending ? "Saving…" : "Save"}
          </button>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <span className="muted sm">
            {dirty.length ? `${dirty.length} field(s) changed` : "No changes"}
          </span>
          {patch.error && <Problem error={patch.error} prefix="Could not save" />}
        </div>
      </aside>
    </div>
  );
}

function Facts({ snapshot: s }: { snapshot: SnapshotInfo }) {
  const rows: [string, ReactNode][] = [
    ["Snapshot id", <code key="id">{s.id}</code>],
    ["Period key", s.period_key],
    ["Fiscal year", s.fiscal_year],
    ["Period", `${s.period_type}${s.period_ordinal ?? ""}`],
    ["State", s.state],
    ["Revision", s.revision],
    ["Initiatives", fmt.int(s.initiative_count)],
    ["Reason for revision", s.reason ?? "—"],
    ["Original file", s.original_filename ?? "—"],
    ["Stored as", s.stored_filename ?? "—"],
    ["Uploaded", s.uploaded_at
      ? new Date(s.uploaded_at).toLocaleString() : "— (predates upload times)"],
    ["Loaded by", s.created_by ?? "—"],
    ["Published", s.published_at ? `${fmt.date(s.published_at)} · ${s.published_by ?? "—"}` : "—"],
    ["Archived", s.archived_at ? `${fmt.date(s.archived_at)} · ${s.archived_by ?? "—"}` : "—"],
  ];
  return <>{rows.map(([label, v]) => (
    <div className="formrow" key={label}>
      <span className="formlabel">{label}</span>
      <span className="sm">{v}</span>
    </div>
  ))}</>;
}

/* =============================================================== confirm = */
function Confirm({ confirmation, busy, onCancel }: {
  confirmation: Confirmation; busy: boolean; onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{confirmation.title}</h3>
        <div className="sm">{confirmation.body}</div>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={busy} onClick={confirmation.run}>
            {busy ? "Working…" : confirmation.cta}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ upload = */
function Upload() {
  const { data: meta } = useMeta();
  const { options } = usePeriod();
  const upload = useUploadExcel();

  const [file, setFile] = useState<File | null>(null);
  const [fiscalYear, setFiscalYear] = useState(CURRENT_FY);
  const [periodType, setPeriodType] = useState<PeriodType>("Q");
  const [periodOrdinal, setPeriodOrdinal] = useState<number | null>(1);
  const [labelPreset, setLabelPreset] = useState<LabelPreset>("standard");
  const [customLabel, setCustomLabel] = useState("");
  const [customBaseAtEntry, setCustomBaseAtEntry] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [force, setForce] = useState(false);
  const [report, setReport] = useState<UploadReport | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    setFile(accepted[0] ?? null);
    setReport(null);
  }, []);

  // react-dropzone replaces ~60 lines of dragenter/dragover/drop bookkeeping,
  // and gets keyboard activation and file-type rejection for free.
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "application/vnd.ms-excel.sheet.macroEnabled.12": [".xlsm"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
  });

  const changePeriodType = (pt: PeriodType) => {
    setPeriodType(pt);
    if (pt === "FY") { setPeriodOrdinal(null); return; }
    const options = ordinalOptions(pt);
    const stillValid = periodOrdinal != null
      && options.some((o) => Number(o.value) === periodOrdinal);
    // Switching type clears an invalid ordinal rather than coercing it.
    setPeriodOrdinal(stillValid ? periodOrdinal : Number(options[0]?.value ?? 0) || null);
  };

  const base = standardLabel(fiscalYear, periodType, periodOrdinal);
  const effectiveLabel = labelPreset === "custom" ? customLabel : presetLabel(labelPreset, base);
  const labelDrifted = labelPreset === "custom" && customBaseAtEntry !== null
    && customBaseAtEntry !== base && customLabel.trim() !== "";

  const changeLabelPreset = (preset: LabelPreset) => {
    if (preset === "custom" && labelPreset !== "custom") {
      setCustomLabel(base);
      setCustomBaseAtEntry(base);
    }
    setLabelPreset(preset);
  };

  const periodKey = buildPeriodKey(fiscalYear, periodType, periodOrdinal);
  const resolve = useResolvePeriod(fiscalYear, periodType, periodOrdinal);
  const needsReason = resolve.data?.state === "revision";
  // A draft is visible only to its owner, so someone else's draft looks like an
  // empty period from here -- say whose it is before it is replaced.
  const foreignDraftOwner = resolve.data?.state === "draft_exists"
    && resolve.data.existing_snapshot?.created_by
    && resolve.data.existing_snapshot.created_by !== resolve.data.current_actor
    ? resolve.data.existing_snapshot.created_by : null;
  const reloadsArchived = Boolean(resolve.data?.existing_snapshot?.archived_at);

  const ext = file ? `.${file.name.split(".").pop()}` : "";
  const storedFilename = resolve.data ? `${resolve.data.stored_filename}${ext}` : "…";

  const missing: string[] = [];
  if (!file) missing.push("workbook file");
  if (periodType !== "FY" && periodOrdinal == null) missing.push("period");
  if (needsReason && !reason.trim()) missing.push("reason for the revision");

  const run = () => {
    if (missing.length) return;
    upload.mutate({
      file: file!, fiscalYear, periodType, periodOrdinal,
      label: effectiveLabel || undefined, reason: needsReason ? reason.trim() : undefined,
      dryRun, force,
    }, { onSuccess: setReport });
  };

  return (
    <Panel title="Load a workbook"
      actions={<span className="muted sm">
        Writing to {meta?.data_backend === "sql" ? "Lakebase" : "the local JSON store"}
      </span>}>
      <fieldset className="periodbuilder">
        <legend>1. Which period is this?</legend>
        <div className="formrow-group">
          <Select label="Fiscal year" value={String(fiscalYear)}
            onChange={(v) => setFiscalYear(Number(v))}
            options={FISCAL_YEARS.map((y) => ({ value: String(y), label: String(y) }))} />
          <Select label="Period type" value={periodType}
            onChange={(v) => changePeriodType(v as PeriodType)}
            options={PERIOD_TYPES} />
          {periodType !== "FY" && (
            <Select label={periodType === "M" ? "Month" : periodType === "H" ? "Half" : "Quarter"}
              value={periodOrdinal != null ? String(periodOrdinal) : ""}
              onChange={(v) => setPeriodOrdinal(Number(v))}
              options={ordinalOptions(periodType)} />
          )}
          <Select label="Label" value={labelPreset}
            onChange={(v) => changeLabelPreset(v as LabelPreset)}
            options={LABEL_PRESETS} />
          {labelPreset === "custom" && (
            <label className="field">
              <span className="sm muted">Custom label</span>
              <input type="text" value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)} />
            </label>
          )}
        </div>
        {labelDrifted && (
          <p className="muted sm">Label no longer matches the selected period.</p>
        )}

        <div className="periodpreview">
          <div><span className="muted sm">Period key</span><b> {periodKey}</b>
            <span className="muted sm"> (identity — permanent, never changes)</span></div>
          <div><span className="muted sm">Label</span><b> {effectiveLabel || "—"}</b>
            <span className="muted sm"> (display — editable later)</span></div>
          <div><span className="muted sm">Stored file</span><b> {storedFilename}</b></div>
        </div>

        {resolve.data && (
          <p className="muted sm">
            {resolve.data.state === "new" &&
              `${periodKey} is a new period. Loading it will create the snapshot.`}
            {resolve.data.state === "draft_exists" && (foreignDraftOwner
              ? `An unpublished draft for ${periodKey} created by ${foreignDraftOwner} `
                + `already exists. Loading will replace its contents and make the draft `
                + `yours -- it will then appear in your period picker instead of theirs.`
              : `A draft for ${periodKey} already exists. Loading will replace its contents.`)}
            {resolve.data.state === "revision" &&
              `${periodKey} already exists (${resolve.data.existing_snapshot?.label ?? "published"}). `
              + `This will be loaded as revision ${resolve.data.next_revision} and will `
              + `require a reason before publishing.`}
          </p>
        )}
        {reloadsArchived && (
          <p className="muted sm">
            {periodKey} is currently archived. Loading it will bring it back.
          </p>
        )}
        {needsReason && (
          <label className="field">
            <span className="sm muted">Reason for this revision</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>2. The workbook</legend>
        <div {...getRootProps()} className={`dropzone${isDragActive ? " active" : ""}`}>
          <input {...getInputProps()} />
          {file
            ? <><b>{file.name}</b><span className="muted sm">
              {" "}({(file.size / 1024 / 1024).toFixed(1)} MB) — drop another to replace</span></>
            : <span className="muted">Drop the register workbook here, or click to choose
              a .xlsx / .xlsm file.</span>}
        </div>
      </fieldset>

      <fieldset>
        <legend>3. How should it be loaded?</legend>
        <label className="check">
          <input type="checkbox" checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)} />
          Validate only (write nothing)
        </label>
        <p className="muted sm">Checks the workbook and reports issues without writing.</p>
        <label className="check">
          <input type="checkbox" checked={force}
            onChange={(e) => setForce(e.target.checked)} />
          Force replay of identical bytes
        </label>
        <p className="muted sm">Re-loads even if these exact bytes were already loaded once.</p>
      </fieldset>

      <fieldset>
        <legend>4. Result</legend>
        <button className="primary" onClick={run} disabled={missing.length > 0 || upload.isPending}>
          {upload.isPending ? "Processing…" : dryRun ? "Validate" : "Load"}
        </button>
        {missing.length > 0 && (
          <p className="muted sm">
            {missing.length} required field(s) outstanding: {missing.join(", ")}.
          </p>
        )}
        {upload.error && <Problem error={upload.error} />}
        {report && <Report report={report} />}
      </fieldset>

      <fieldset>
        <legend>5. Plan baseline</legend>
        <p className="muted sm">
          The fixed anchor the "Vs. plan" comparison mode resolves to for
          fiscal year {fiscalYear}, regardless of which period is currently
          selected -- unlike sequential/YoY, which shift with the selection.
        </p>
        <PlanBaseline fiscalYear={fiscalYear} snapshots={
          options?.by_year.find((g) => g.year === fiscalYear)?.snapshots ?? []
        } />
      </fieldset>
    </Panel>
  );
}

function PlanBaseline({ fiscalYear, snapshots }: {
  fiscalYear: number; snapshots: { id: string; label: string; is_baseline: boolean }[];
}) {
  const set = useSetPlanBaseline();
  const clear = useClearPlanBaseline();
  const busy = set.isPending || clear.isPending;

  if (!snapshots.length) {
    return <Empty>No snapshots loaded yet for fiscal year {fiscalYear}.</Empty>;
  }

  return (
    <div className="planbaseline">
      {snapshots.map((s) => (
        <label key={s.id} className="check">
          <input type="radio" name="plan-baseline" disabled={busy}
            checked={s.is_baseline}
            onChange={() => set.mutate(s.id)} />
          {s.label}
          {s.is_baseline && (
            <button type="button" className="link sm" disabled={busy}
              onClick={(e) => { e.preventDefault(); clear.mutate(s.id); }}>
              (clear)
            </button>
          )}
        </label>
      ))}
      {(set.error || clear.error) && <Problem error={(set.error ?? clear.error)!} />}
    </div>
  );
}

function Report({ report }: { report: UploadReport }) {
  const { set } = usePeriod();
  const navigate = useNavigate();
  const publish = usePublishSnapshot();
  const [published, setPublished] = useState(false);
  const tone = report.status === "loaded" ? "good"
    : report.status === "failed" ? "bad" : "warn";

  const reviewDataQuality = () => {
    set({ snapshot: report.snapshot_id });
    navigate("/data-quality");
  };

  const state = published ? "published" : report.state;

  return (
    <div className={`report ${tone}`}>
      <div className="kpirow tight">
        <Kpi label="Status" value={report.status} tone={tone as any} />
        <Kpi label="Inserted" value={fmt.int(report.initiatives_inserted)} />
        <Kpi label="Updated" value={fmt.int(report.initiatives_updated)} />
        <Kpi label="Removed" value={fmt.int(report.initiatives_deleted)} />
        <Kpi label="Monthly points" value={fmt.int(report.metric_rows)} />
        {report.carried_edits > 0 && (
          <Kpi label="Carried edits" value={fmt.int(report.carried_edits)}
            tone={report.carried_edits_flagged > 0 ? "warn" : "good"}
            sub={report.carried_edits_flagged > 0
              ? `${report.carried_edits_flagged} need review` : undefined} />
        )}
      </div>
      {report.status === "loaded" && state && (
        <p className="sm">
          <i className={`pill sm ${state === "published" ? "good" : "warn"}`}>{state}</i>
          {state === "draft" && (
            <button type="button" className="link" style={{ marginLeft: 8 }}
              disabled={publish.isPending}
              onClick={() => publish.mutate(report.snapshot_id, { onSuccess: () => setPublished(true) })}>
              {publish.isPending ? "Publishing…" : "Publish this snapshot"}
            </button>
          )}
        </p>
      )}
      {publish.error && <Problem error={publish.error} />}
      {report.message && <p className="sm">{report.message}</p>}
      <p className="muted sm">
        Batch {report.batch_id || "—"} · sha256 {report.content_sha256.slice(0, 16)}…
      </p>
      {report.errors.length > 0 && (
        <Issues title={`${report.errors.length} blocking error(s)`}
          items={report.errors} tone="bad" />
      )}
      {report.warnings.length > 0 && (
        <Issues title={`${report.warnings.length} warning(s)`}
          items={report.warnings} tone="warn" />
      )}
      {!report.errors.length && !report.warnings.length && (
        <Empty>No issues found.</Empty>
      )}
      {report.status !== "failed" && report.period_key && (
        <p className="sm">
          <button type="button" className="link" onClick={reviewDataQuality}>
            Review data quality for {report.period_key} →
          </button>
        </p>
      )}
    </div>
  );
}

function Issues({ title, items, tone }: {
  title: string; items: Record<string, unknown>[]; tone: string;
}) {
  return (
    <details open={tone === "bad"}>
      <summary className={tone}>{title}</summary>
      <div className="tablewrap">
        <table className="grid dense">
          <thead><tr><th>Row</th><th>Field</th><th>Message</th></tr></thead>
          <tbody>
            {items.map((i, n) => (
              <tr key={n}>
                <td>{String(i.row ?? "—")}</td>
                <td>{String(i.field ?? "—")}</td>
                <td>{String(i.message ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
