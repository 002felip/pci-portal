/**
 * Shell, routing and the React entry point.
 *
 * NOTE THE TAB LABELS. The old build shipped a literal "🔀 Q1 vs Q2" in this
 * file. Here the comparison tab names itself from the resolved period, so the
 * day a Q3 register is uploaded the navigation says "Q2 vs Q3" without anyone
 * editing anything.
 */

import { StrictMode, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter, NavLink, Navigate, Route, Routes, useLocation,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BASE_PATH, useMeta } from "./api";
import { ChartTooltipProvider } from "./ChartTooltip";
import { exportSections } from "./pdf";
import {
  FilterProvider, PeriodBar, PeriodProvider, PrintProvider, usePeriod, usePrintSections,
  usePrintSetIncluded,
} from "./ui";
import ComparePage from "./pages/Compare";
import DataQualityPage from "./pages/DataQuality";
import SnapshotsPage from "./pages/Snapshots";
import InitiativesPage from "./pages/Initiatives";
import PortfolioPage from "./pages/Portfolio";

import "./styles/app.css";
import "./styles/splitpicker.css";
import "./styles/portfolio-sections.css";

const client = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

/* ================================================================= shell = */
function Shell() {
  const { data: meta } = useMeta();
  const { snapshot, baseline, options, label } = usePeriod();

  const tabs = useMemo(() => [
    { to: "/portfolio", label: "📊 Portfolio" },
    {
      to: "/compare",
      // Self-naming. Falls back gracefully when only one snapshot exists.
      label: baseline && snapshot ? `🔀 ${label(baseline)} vs ${label(snapshot)}` : "🔀 Comparison",
    },
    { to: "/initiatives", label: "📝 Initiatives" },
    { to: "/data-quality", label: "⚠️ Data quality" },
    { to: "/snapshots", label: "🗂️ Snapshots" },
  ], [baseline, snapshot, label]);

  return (
    <div className="shell">
      <header className="masthead">
        <div className="brand">
          <div className="mark">VBM</div>
          <div>
            <h1>VBM Operating Plan · Strategic Cockpit</h1>
            <p className="muted sm">Consolidated BU Initiative Register</p>
          </div>
        </div>
        <div className="meta sm">
          <div>
            Source:{" "}
            <b className="accent">
              {meta?.data_backend === "sql" ? "Lakebase (Postgres)" : "local JSON seed"}
            </b>
          </div>
          <div>
            Periods:{" "}
            <b className="accent">
              {options?.snapshots.map((s) => s.label).join(" · ") ?? "…"}
            </b>
          </div>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((t) => (
          <NavLink key={t.to} to={{ pathname: t.to, search: window.location.search }}
            className={({ isActive }) => (isActive ? "tab on" : "tab")}>
            {t.label}
          </NavLink>
        ))}
        <PrintButton />
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/portfolio" replace />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/initiatives" element={<InitiativesPage />} />
          <Route path="/data-quality" element={<DataQualityPage />} />
          <Route path="/snapshots" element={<SnapshotsPage />} />
          {/* The upload flow used to live here on its own; it is now one
              panel of the Snapshots page. Kept so old bookmarks still land. */}
          <Route path="/data-update" element={<Navigate to="/snapshots" replace />} />
          <Route path="*" element={<Navigate to="/portfolio" replace />} />
        </Routes>
      </main>

      <footer className="muted sm">
        Figures in USD millions unless stated. Value = Current-Year Value Target.
        Actuals = monthly financial actuals to the period end; + forecast = through
        December. In execution = Implementing + Cash flowing + Locked in.
      </footer>
    </div>
  );
}

/* ========================================================== print dialog = */
function PrintButton() {
  const sections = usePrintSections();
  const setIncluded = usePrintSetIncluded();
  const { snapshot, baseline, label } = usePeriod();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = sections.filter((s) => s.included).map((s) => s.id);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      // Baseline vs snapshot only means something on the Compare tab; other
      // tabs show a single period, so the leftover global `baseline` from a
      // prior Compare visit must not leak into their export subtitle.
      const onCompare = pathname === "/compare";
      await exportSections(chosen.length ? chosen : sections.map((s) => s.id), {
        filename: `VBM-Strategic-Cockpit-${snapshot ? label(snapshot) : "export"}.pdf`,
        subtitle: onCompare && baseline && snapshot
          ? `${label(baseline)} vs ${label(snapshot)}`
          : snapshot ? `Snapshot: ${label(snapshot)}` : ""
      });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (sections.length === 0) return null;

  return (
    <>
      <button type="button" className="tab print" onClick={() => setOpen(true)}>
        🖨 Print to PDF
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Export to PDF</h3>
            <p className="muted sm">
              Pre-ticked from each section's "Include in PDF bundle" checkbox.
              Edit here before exporting -- nothing ticked exports all of them.
            </p>
            <ul className="checklist">
              {sections.map((s) => (
                <li key={s.id}>
                  <label>
                    <input type="checkbox" checked={s.included}
                      onChange={(e) => setIncluded(s.id, e.target.checked)} />
                    {s.label}
                  </label>
                </li>
              ))}
            </ul>
            {error && <p className="bad sm">{error}</p>}
            <div className="modal-actions">
              <button onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="primary" onClick={run} disabled={busy}>
                {busy ? "Rendering…" : "Export"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================================================================= entry = */
export default function App() {
  return (
    <QueryClientProvider client={client}>
      {/* basename: o mesmo prefixo do build (vazio no build padrão), para as
          rotas /portfolio, /data-quality... funcionarem dentro do Portal PCI. */}
      <BrowserRouter basename={BASE_PATH || undefined}>
        <PeriodProvider>
          <FilterProvider>
            <PrintProvider>
              {/* Outside every PrintSection, so the PDF export -- which
                  rasterizes one section's subtree -- cannot capture the card. */}
              <ChartTooltipProvider>
                <Shell />
              </ChartTooltipProvider>
            </PrintProvider>
          </FilterProvider>
        </PeriodProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<StrictMode><App /></StrictMode>);
}

/** Shared page header: the period pickers, in the same place on every tab. */
export function PageHead({ title, blurb, compare, children }: {
  title: string; blurb?: string; compare?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="pagehead">
      <div>
        <h2>{title}</h2>
        {blurb && <p className="muted sm">{blurb}</p>}
      </div>
      <div className="pagehead-controls">
        <PeriodBar compare={compare} />
        {children}
      </div>
    </div>
  );
}
