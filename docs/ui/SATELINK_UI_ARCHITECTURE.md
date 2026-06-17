# Satelink-OS — UI Architecture (Phase 11)

The Satelink-OS design system ports SigNoz's *architecture* onto Satelink's actual
stack (Next 15 App Router, Tailwind v4, CSS variables, geist). Target feel:
**80% SigNoz · 10% Netdata · 10% Satelink**.

## Styling strategy (why CSS Modules + CSS variables)

SigNoz uses styled-components + SCSS + antd theming. Satelink's web app has **no**
antd/styled-components and uses Tailwind v4 + CSS variables. To avoid a heavy migration
and dependency churn (and a fragile install in this repo's `node_modules`), Satelink-OS
uses **CSS Modules** (native to Next, zero new deps) whose rules reference **CSS custom
properties** (`var(--sat-*)`) defined once by the token layer.

Result:
- **Views and components contain no inline styles.** All styling lives in
  co-located `*.module.css` files.
- The token system is the single source of truth: `theme/*.ts` (typed JS, used by
  charts/recharts and any JS that needs values) mirrored by `theme/theme.css`
  (CSS variables, used by every `*.module.css`).
- Theme is scoped under a `.sat-os` root class so it never bleeds into the landing site.

```
theme/*.ts  ──(same values)──▶  theme/theme.css ( .sat-os { --sat-* } )
     │                                   │
     ▼                                   ▼
recharts colors, JS logic        *.module.css  →  components  →  views
```

## Directory layout

```
apps/web/src/components/satelink-os/
├── theme/         tokens.ts colors.ts spacing.ts typography.ts elevation.ts borders.ts theme.css index.ts
├── shared/        Panel, SectionLabel, EmptyState, DataState, Skeleton, Spinner
├── shell/         AppShell  (SideNav + TopBar + PageHeader + content)
├── navigation/    SideNav   (typed, collapsible, route/active aware)
├── layout/        TopBar, PageHeader (title/subtitle/breadcrumb/status/env)
├── metrics/       MetricCard, MetricGrid
├── charts/        ChartFrame + Area/Line/Bar/Donut/Kpi/Trend (recharts, empty-aware)
├── tables/        DataTable (typed columns, loading/empty/error)
├── topology/      TopologyDiagram (data-driven from a TopologyModel prop)
├── badges/        StatusBadge, StatusDot
├── events/        EventStream (SSE-fed log feed)
├── forms/         Button
├── filters/       (reserved — query-object filters; not needed until telemetry lands)
├── search/        (reserved — global cmd-K placeholder lives in TopBar)
├── treasury/ intelligence/ revenue/ agents/ security/   (view compositions; see note)
└── index.ts       barrel
```

> **Note on the 18-directory spec.** Directories that have real, reusable primitives
> are populated now. `filters/`, `search/`, and the per-domain folders
> (`treasury/`, `intelligence/`, `revenue/`, `agents/`, `security/`) are **view-level
> compositions**, not new primitives — today they are assembled inside the command
> center page from the primitive layer. They are reserved here as the documented home
> for extraction when each view grows beyond a single screen. Creating them empty now
> would be directory theater; they are listed as the migration target instead.

## The four-state data contract (from SigNoz `DataStateRenderer`)

Every data surface renders exactly one of: **loading → error → empty → data**.
`shared/DataState` and `shared/EmptyState` encode this. No surface ever shows
simulated data while the real one is unavailable (Phase 7).

```
<DataState loading={...} error={...} empty={!rows.length}
           emptyLabel="…" emptyNote="telemetry backend not yet implemented">
  {() => <DataTable .../>}
</DataState>
```

## Brand system (Phase 4)

| Token | Value | Use |
|---|---|---|
| `--sat-primary` | `#5EEAD4` | primary accent (teal) — Satelink identity |
| `--sat-secondary` | `#00C8FF` | secondary (cyan) |
| `--sat-accent` | `#0090FF` | accent (azure) — **not** generic enterprise blue |
| `--sat-success` | `#34D399` | healthy |
| `--sat-warn` | `#F59E0B` | warning |
| `--sat-danger` | `#EF4444` | critical |
| `--sat-bg-0..3` | `#050816 → #1A2740` | SigNoz-style dark surface hierarchy |
| `--sat-font-sans` | Geist Sans | UI / labels / tables |
| `--sat-font-mono` | JetBrains Mono → Geist Mono fallback | operational data / metrics / logs |

Type scale (`typography.ts`): `display 28 · h1 18 · h2 14 · body 12 · small 11 ·
label 9 (mono, letter-spacing 2–3, uppercase) · data 10–28 (mono)`.

## Shell (Phase 5)

`AppShell` composes `SideNav` (left, collapsible, typed nav model) + `TopBar`
(persistent: brand, global search placeholder, environment indicator, live/refresh
status, clock) + `PageHeader` (icon, title, subtitle, breadcrumb, per-view status
chips) + a responsive scroll content region. Pages render only into content.

## Charts (Phase 9)

`ChartFrame` wraps every chart with title + the four-state contract. Area/Line/Bar/
Donut use recharts; Kpi/Trend are numeric stat tiles. With no telemetry endpoint, every
chart renders its **empty state** ("Telemetry backend not yet implemented") — never
fabricated series.

## Topology (Phase 8)

`TopologyDiagram` takes a `TopologyModel` (`{ nodes, links }`) via props. No hardcoded
providers/counts. The command center passes a **structural architecture model**
(clients → free-tier gate → gateway → upstream pool → billing) explicitly labelled
"architecture, not live data". When a real topology endpoint exists, pass its model.

## Honest-data policy (Phases 7 & 10)

- No fabricated metrics, revenue, settlements, threat feeds, provider counts, or
  topology metrics — anywhere.
- Missing backend → professional empty state.
- Fallback/sample data may exist **only** behind an explicit local-dev flag and is
  **never** shown when the production API returns empty.

## Migration status

- **Done:** token system, shell, primitives (shared/metrics/badges/tables/charts/
  topology/events/forms), and the command-center page rebuilt on them with zero inline
  styles and all logic preserved.
- **Next (documented, not faked):** adopt antd-parity primitives only if needed,
  swap recharts→uPlot if telemetry volume demands it, and extract per-domain view
  folders (`treasury/` etc.) as each view grows. Wire charts when telemetry endpoints
  ship.
