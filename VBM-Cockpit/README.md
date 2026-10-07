# VBM Strategic Cockpit — v2 rebuild

React + TanStack Query frontend, FastAPI backend, Databricks Lakebase storage,
deployed as a single Databricks App. The deployment contract is unchanged:
`app_entry.py` still imports `backend.app.main:app`, so `app.yaml`,
`databricks.yml` and `docker-compose.yml` work exactly as before.

---

## 0. Start here — 60 seconds

```bash
unzip cockpit-v2.zip && cd cockpit-v2

python -m pip install -r requirements.txt
python backend/seed_demo.py        # synthetic register, see §10
python backend/smoke_test.py       # 33 assertions, all should pass

make dev-api                       # :8000
cd frontend && npm install && npm run dev    # :5173
```

Then read **§10 first** — it explains why the seed is synthetic and what to
replace it with.

---

## 1. What changed, against what you asked for

| # | Ask | Where it landed |
|---|---|---|
| 1 | Replace code-like visuals with libraries | `charts.tsx`, `pdf.ts`, `ui.tsx` — **−3,100 lines**, §3 |
| 2 | Make the period choosable, not Q1-vs-Q2 | `periods.py` + `PeriodProvider`, §4 |
| 3 | SOLID: schema changes in one place | `registry.py`, proof in §7 |
| 4 | Editable Initiatives tab, synced | `pages/Initiatives.tsx` + CRUD routes, §6 |
| 5 | Under 20 files | **20 application modules**, §8 |

---

## 2. File map

```
cockpit-v2/
├── app.yaml · databricks.yml · docker-compose.yml   UNCHANGED from v1
├── app_entry.py · requirements.txt · Makefile
│
├── backend/
│   ├── app/                        ← 10 application modules
│   │   ├── registry.py    ★ THE schema. Everything below is derived from it.
│   │   ├── core.py          settings · repo-root paths · Lakebase engine
│   │   ├── models.py        SQLAlchemy tables, columns GENERATED from registry
│   │   ├── schemas.py       Pydantic contracts, GENERATED from registry
│   │   ├── periods.py     ★ snapshot/year discovery and resolution
│   │   ├── analytics.py     every business rule, period- and field-agnostic
│   │   ├── repositories.py  4 narrow Protocols + Json + Sql implementations
│   │   ├── etl.py           vocab · excel parse · validation · idempotent load
│   │   ├── api.py           all routes, incl. initiative CRUD
│   │   └── main.py          ASGI app: /api + the SPA
│   ├── seed_demo.py         DEV UTILITY — synthetic seed (§10)
│   └── smoke_test.py        DEV UTILITY — 33 endpoint assertions (§9)
│
└── frontend/
    ├── index.html · vite.config.ts · tsconfig.json · package.json
    └── src/                        ← 9 application modules + 1 stylesheet
        ├── api.ts               transport + types + TanStack Query hooks
        ├── ui.tsx             ★ PeriodProvider · atoms · DataTable · print registry
        ├── charts.tsx           Recharts + react-d3-tree wrappers
        ├── pdf.ts               html2canvas + jsPDF
        ├── App.tsx              shell, routes, self-naming tabs, entry point
        ├── pages/               Portfolio · Compare · Initiatives · Data
        └── styles/app.css
```

---

## 3. Change 1 — what got outsourced, and what did not

### Replaced

| Was | Lines | Now | Why it wins |
|---|---:|---|---|
| `charts/primitives.tsx` — bars, lines, donuts, axes | 643 | **Recharts** | Scales, axes, legends, stacking, responsive sizing are solved problems |
| `charts/Treemap.tsx` — squarified layout by hand | 210 | Recharts `<Treemap>` | The layout algorithm was the whole file |
| `charts/ChartTooltip.tsx` — portal tooltip + provider | 301 | Recharts `<Tooltip>` | Positioning, flipping, portals — built in |
| `charts/StageMatrix.tsx` — SVG grid + funnel | 265 | HTML `<table>` + CSS ramp; funnel → Recharts | It was always a table. Now it's selectable text a screen reader can read |
| `charts/DecompositionTree.tsx` — tree layout by hand | 222 | **react-d3-tree** | `/analytics/tree` already returns `{name, children}` — its exact input shape. Collapse, pan, zoom free |
| `hooks/useMeasuredWidth.ts` — ResizeObserver | 30 | `<ResponsiveContainer>` | — |
| `lib/pdf.ts` — **hand-encoded PDF**: xref tables, object offsets, DCTDecode streams | 385 | **html2canvas + jsPDF** | See below |
| 5 bespoke `<table>` blocks, each re-implementing sorting; register table also paginating | ~380 | **TanStack Table**, one `<DataTable>` | Sort/filter/paginate once, headless so the CSS is untouched |
| Upload drag-and-drop bookkeeping | ~60 | **react-dropzone** | Keyboard activation and type rejection free |
| `PrintProvider` + `PrintDialog` + `PrintSection` (3 files) | 308 | folded into `ui.tsx` + `App.tsx`, ~90 lines | Same behaviour, one less indirection |

**On the PDF specifically.** v1's README gave three reasons to hand-roll it. Two
still hold and are satisfied anyway; the third was self-inflicted:

- *"`window.print()` may be policy-blocked."* True. We don't use it either.
- *"Nothing may download at runtime."* True. Both libraries are npm
  dependencies bundled by Vite into the asset the SPA already ships. No CDN.
- *"Canvas doesn't survive serialization."* That was a consequence of cloning
  the DOM and inlining computed styles first. html2canvas rasterizes the **live**
  document, so canvas and SVG both come through — and the style-inlining pass
  disappears with it.

The pagination *policy* — keep a section whole, slice only content taller than a
page, so a chart never straddles a break — stayed in our code. That's a product
decision, not plumbing.

### Kept hand-written, and why

| Candidate | Verdict |
|---|---|
| `app.css` → Tailwind | **No.** Tailwind is the same CSS written differently, not less of it. It would churn every `className` in nine files for no behavioural gain. |
| `app.css` → MUI / Mantine / Chakra | **No.** ~90 kB runtime plus a theming layer fighting this stylesheet, to replace controls that are native `<select>`, `<input>`, `<dialog>`. Charts and tables are algorithms worth outsourcing. Layout isn't. |
| `PrintSection` registry | **Kept.** ~20 lines, no library equivalent short of a print framework, and it's the seam the exporter walks. |
| `format.ts` | **Deleted.** `Intl.NumberFormat` was already doing the work; the wrapper is now 5 lines in `api.ts`. |
| Repository / analytics layer | **Kept.** This is the domain. No library knows your business rules. |

### Trade-offs, stated plainly

- **Bundle grows** ~180 kB gzipped (Recharts ~95, jsPDF ~90). For an internal
  cockpit behind SSO this is a non-issue; if it ever matters, `pdf.ts` is the
  obvious `React.lazy` split point since export is rare and user-initiated.
- **You inherit upstream release cycles.** Recharts is mainstream with a large
  maintained surface; react-d3-tree is smaller and the one worth watching. It's
  also the easiest to drop — it renders one panel.
- **Less pixel control.** Everything on screen today is reproduced, but a future
  exotic visual may need `visx` alongside. That's additive to `charts.tsx`.

---

## 4. Change 2 — periods are discovered, not configured

v1 baked the reporting window into **four** places: a `DEFAULT_SNAPSHOT=Q2` env
var, `snapshot_a: str = "Q1"` on three route signatures, `year: int = 2026` on
the monthly endpoint, and a literal `"🔀 Q1 vs Q2"` tab label. Q3 was a code
change *and* a redeploy.

Now the only authority is the data:

- **Snapshots** from the `snapshot` table (or the JSON seed's list).
- **Years** from `DISTINCT EXTRACT(YEAR FROM period_month)` on the monthly
  facts, unioned with planned end years. This works *because* v1 got the
  narrow-facts decision right — a new year is rows, not a migration.
- **Ordering** is `(sort_order, fiscal_year, period_index, code)`. Codes like
  `Q3`, `Q3-27`, `FY27`, `H1-26` parse into `(year, index)` on ingest, so
  chronology survives an operator forgetting `sort_order`. Lexical ordering is
  never trusted — `Q10` sorts before `Q2` and nobody notices until it's wrong on
  a board slide.
- **Defaults** are "latest populated" vs "the one before it" — which is what
  "Q1 vs Q2" always meant.

`PeriodResolver.resolve()` is the single entry point; no other module may invent
a default period. An unknown code returns **400**, never a silent substitution.

On the frontend, `PeriodProvider` holds the selection and round-trips it through
the **URL query string** (so a comparison is shareable) with `localStorage` as
fallback. A remembered code that no longer exists is dropped rather than
trusted, so a stale bookmark can't quietly report an empty quarter. The tabs
name themselves: load a Q3 register and the nav reads **"Q2 vs Q3"**.

`app.yaml` no longer sets `DEFAULT_SNAPSHOT`. It gained commented-out
`PINNED_SNAPSHOT` / `PINNED_YEAR` for the rare case where an environment must
land on a fixed period — an override, not a default.

Upload now **requires** `snapshot_code`. It used to default to `"Q2"`; since
uploading is how a new quarter comes into existence, guessing was exactly wrong.
The Data tab's snapshot box is a free-text `datalist`, not a dropdown, because
it must accept a code that doesn't exist yet.

---

## 5. SOLID, applied — not just asserted

| | Where |
|---|---|
| **S**ingle responsibility | `periods.py` resolves periods and nothing else. `registry.py` declares the schema and nothing else. `api.py` has no arithmetic; `analytics.py` has no I/O. `core.py` holds the three "what environment am I in?" concerns and no business rule. |
| **O**pen/closed | The registry is the extension point. Adding a field, vocabulary, monthly block or groupable dimension **extends** the system without modifying models, schemas, ETL, analytics, routes or the UI. §7 proves it. |
| **L**iskov | `JsonRepository` and `SqlRepository` both inherit `AnalyticsMixin`, which implements all seven analytics calls **once** against the single method they differ on, `rows()`. There is no second copy to drift — the mechanical reason `DATA_BACKEND` can be one env var. |
| **I**nterface segregation | v1 had one 13-method `Repository`. Now four narrow roles — `PeriodSource`, `ReadRepository`, `WriteRepository`, `OverrideStore` — so read-only routes are no longer structurally coupled to the write path, and a caching or read-replica implementation is a drop-in. |
| **D**ependency inversion | Routers depend on roles, never classes. `get_repository()` is the only function that knows which implementation is live. |

Two smaller ones, both per-field `if` ladders in v1:

- **Filters** are now `?filter=column:value`, validated against
  `registry.filterable`. v1 had one query parameter per dimension, so a new
  filterable field meant editing the route signature, the query model, both
  repositories and the UI.
- **Override scopes** are derived: `summary:<SNAPSHOT>`. v1 hard-coded
  `q1_summary` and `q2_summary`, so Q3 needed a third constant in three places.

---

## 6. Change 4 — the Initiatives tab

**Read** → `GET /initiatives`, cached per (snapshot, filters, search).
**Write** → `PATCH /initiatives/{id}` with *only the changed cells*, so two
people editing different columns of the same row don't clobber each other. Also
`POST` and `DELETE`.

**Sync model.** Optimistic update on mutate; the server response replaces the
row; a failure rolls the cache back and surfaces the API's own validation
message. `onSettled` invalidates everything — so editing a value target moves
the treemap, the KPIs and the data-gaps page without a reload, because the query
key graph already expresses that dependency.

**Curation survives ingestion.** Every touched column is recorded server-side in
`initiative.edited_fields` (JSONB). The next Excel load reads it and skips those
columns. Hand-edited cells are underlined in the grid and flagged in the editor.

**Validation is shared.** Writes go through the same `registry.coerce()` the ETL
uses, so `"at risk"` typed in the UI resolves to `AT_RISK` exactly as it would
from a spreadsheet cell — verified in the smoke test.

The page contains **zero column names** — grid, form, filters and required-field
checking are generated from `/api/meta/fields`.

---

## 7. Proof: one FieldSpec, seven places, zero other edits

Add this to `INITIATIVE_FIELDS` in `registry.py` and change nothing else:

```python
FieldSpec("carbon_tco2e", "Carbon Abatement (tCO2e)", Kind.NUMBER, S_FIN,
          required=True, excel=("carbonabatement", "tco2e")),
```

Verified output when I ran exactly this:

```
1. DB column exists       : True                       (models.py, Numeric(20,6))
2. UI registry entry      : Carbon Abatement (tCO2e) | number | 5 · Financial Value | required
3. Completeness scores it : 25 fields (was 24); 100% missing
4. PATCH contract         : True                       (schemas.py, optional)
5. CREATE requires it     : True                       (schemas.py, required)
6. Write + coercion       : 200 → 1234.5; gap drops by one
7. Excel header matching  : True                       (etl.py, by name)
```

The grid gains a sortable column, the editor gains an input in the *Financial
Value* section with a required marker, and the data-gaps page gains a bar —
none of which requires touching the frontend.

**The changes you will actually make:**

| Change | Edit |
|---|---|
| New column in the register | Append one `FieldSpec(...)` to `INITIATIVE_FIELDS` |
| Spreadsheet renamed a header | Edit that spec's `excel=` tuple |
| New BU / stage / confidence value | Add to `VOCAB[...]`. Aliases are data, not code |
| New monthly block (2028 actuals) | One `MetricBlock(...)`. Never a migration |

`make ddl` (i.e. `python -m backend.app.models`) prints CREATE TABLE for the
current registry, replacing the hand-maintained `migrations/001_init.sql` that
could drift from the models. They can no longer disagree, because there is only
one of them.

**The boundary, stated honestly.** Pydantic enforces *types* at the HTTP edge;
the registry normalises *semantics* behind it. So a JSON `PATCH` sending
`"1.234,5"` for a number is rejected with a 422 rather than parsed — correct for
a typed API, and different from the Excel path, which does accept Brazilian
decimal formatting. If you want the API lenient too, that's one `field_validator`
in `schemas.py`, still generated from the registry.

---

## 8. File count

**20 application modules** — 10 backend Python, 9 frontend TS/TSX, 1 stylesheet.

Beyond those, the zip carries: 4 deployment files you already had and I did not
change, 4 build-config files (`package.json`, `tsconfig.json`, `vite.config.ts`,
`index.html`), `requirements.txt`, a `Makefile`, 2 dev utilities
(`seed_demo.py`, `smoke_test.py`) and this README. None of those are application
code, but I'd rather name them than claim a tidier number than is true.

Each module is a coherent unit rather than a shard: `client/types/hooks` became
`api.ts` because they always changed together; `DataGaps` and `Upload` became
`Data.tsx` because diagnosing a gap and fixing it is one task.

---

## 9. What I verified

`python backend/smoke_test.py` → **33 passed, 0 failed**, covering:

- All 12 endpoints answer 200.
- Periods discovered: `Q1(45) → Q2(111) → Q3(118)`, years `[2026, 2027]`,
  default `Q2 vs Q3`, ordering chronological not lexical.
- Unknown snapshot → **400**, never a silent substitution.
- Year picker genuinely switches the window (2026 and 2027 both resolve).
- Full CRUD round-trip: create → 201, `planned_end` derived to 2026 Q4,
  `"at risk"` coerced to `AT_RISK`, `edited_fields` recorded, row appears in the
  filtered list, delete → 200.
- **The new-quarter path end to end**: creating an initiative under `Q9`
  auto-creates the snapshot, it appears in the picker, and `Q2 vs Q9` becomes
  comparable — no config change, no redeploy.
- Registry is the single source of truth: 28 registry fields ⊆ 37 DB columns,
  every editable field is patchable, the UI contract matches the registry
  exactly, completeness scores the registry's required fields.

All 9 TS/TSX files parse clean under the TypeScript parser.

### Not verified — do these first

- **`tsc --noEmit` and a real `vite build`.** The npm registry was blocked in my
  environment, so the frontend is type-*parsed* but not type-*checked* against
  the actual `recharts` / `react-d3-tree` type definitions. Expect one or two
  prop-signature fixes on first compile — most likely in the Recharts `Treemap`
  custom `content` renderer and the `SlopeChart` multi-`data` `<Line>` pattern,
  the two least conventional usages.
- **The SQL backend.** No Postgres available. `JsonRepository` is fully
  exercised and both share `AnalyticsMixin`, so the analytics are proven; the
  SQL-specific surface is `rows()`, the CRUD methods and `distinct_years()`.
  `docker compose up -d && make migrate` will exercise it locally.
- **Migrating your existing override rows.** Scopes moved from `q1_summary` /
  `q2_summary` to `summary:Q1` / `summary:Q2`. For Lakebase that's one
  statement:
  ```sql
  UPDATE override SET scope = 'summary:' || upper(replace(scope, '_summary', ''))
  WHERE scope LIKE '%\_summary';
  ```

---

## 10. About the seed data — read this

**The `initiatives.json` in this package is synthetic.** The sandbox that
produced the rebuild was reset before I could package your real seed, and that
file was your data, not mine to regenerate. `backend/seed_demo.py` writes a
structurally identical stand-in so the app starts and every chart populates.

It deliberately includes **three snapshots and two years**, which your real
two-snapshot seed could not demonstrate — that's what makes the period picker
visibly do something on first run.

**Replace it as soon as you can:**

```bash
# SQL backend — the real path
make load EXCEL="./resources/VBM_BU_Register_Master.xlsm" SNAPSHOT=Q2

# or through the UI: Data quality & update tab → drop the workbook,
# set the snapshot code, untick "Validate only"
```

Totals from the synthetic seed (`$676.1M` on Q2, etc.) are meaningless. The
figures that reconciled to your published dashboard during the rebuild —
111 initiatives, `$331.7M` current-year target, `$318.83M` December cumulative —
came from your real register and will return when you load it.

The v1 known limitation still stands: the dashboard-derived extract carries no
**KPI Baseline Value**, so that field reads as largely missing until a real
workbook is uploaded. The synthetic seed mirrors that gap on purpose.
