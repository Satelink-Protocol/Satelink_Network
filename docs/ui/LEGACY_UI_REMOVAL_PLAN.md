# Legacy UI Removal Plan (Phase 2)

## Ground truth (verified, not assumed)

The "admin dashboard" is **one page**:

```
apps/web/src/app/admin/command-center/page.jsx   (~700 lines, 100% inline styles)
apps/web/src/app/api/admin-proxy/route.js        (server proxy — KEEP, backend)
```

There is **no shared admin component library**, **no `components/` dir**, and **no
other admin route** in source. (The ~30 `admin/*` paths seen in `tsc` output are
stale `.next/types` build stubs, not source — confirmed via `find apps/web/src/app/admin`.)

Therefore "remove the legacy design system" = **delete the inline design system that
lives inside `command-center/page.jsx`** and re-home its behavior on `satelink-os`.
Nothing is shared, so nothing else breaks.

## Inventory of legacy (inline) UI primitives in `page.jsx`

| Legacy inline primitive | What it is | Replacement (satelink-os) |
|---|---|---|
| `const C = {…}` palette object | inline hex design tokens | `theme/colors.ts` + `theme.css` CSS vars |
| `const FONT = {…}` | inline font stacks | `theme/typography.ts` |
| `Panel` | inline bordered box | `shared/Panel` |
| `Metric` | inline metric card | `metrics/MetricCard` + `metrics/MetricGrid` |
| `Badge` | inline status pill | `badges/StatusBadge` |
| `SectionLabel` | inline section heading | `shared/SectionLabel` |
| `NoBackendYet` | inline empty line | `shared/EmptyState` (DataState contract) |
| `Loading` / `Empty` / `ErrLine` | inline state text | `shared/DataState` helpers |
| `Pulse` | inline status dot | `badges/StatusDot` |
| `Topology` | hardcoded SVG art | `topology/TopologyDiagram` (data-driven, props) |
| `LiveFeed` | inline SSE list | `events/EventStream` |
| `btn()` style factory | inline button styles | `forms/Button` |
| `<table>` in OpsView | inline table | `tables/DataTable` |
| `NOCView/IntelView/WarRoomView/TreasuryView/SecurityView/OpsView` | inline-styled view fns | rebuilt as compositions, **zero inline styles** |
| shell (sidebar + top bar + header) | inline `<div>` chrome | `shell/AppShell` + `navigation/SideNav` + `layout/TopBar` + `layout/PageHeader` |

## What is explicitly KEPT (business logic / integrations — never deleted)

- `adminFetch()` — the `/api/admin-proxy` POST client.
- The **SSE** live-feed `EventSource('/api/admin-proxy?stream=live/feed')`.
- All loaders: `loadStatus`, `loadDevs`, `loadJobs`.
- All actions: `toggleDryRun` (typed-LIVE confirm), `advance` (PATCH stage),
  `outreach` (Discord post), `trigger` (job run), `classify` (IP classifier).
- All endpoint paths and request/response shapes.
- `apps/web/src/app/api/admin-proxy/route.js` (incl. the SSE pass-through) — untouched.
- Routing (`app/admin/command-center`).

## Removal sequence (safe, reversible)

1. **Add** `satelink-os` design system (additive — breaks nothing).
2. **Rebuild** `command-center/page.jsx` to import from `satelink-os`, porting the
   logic above verbatim. The inline `C`, `FONT`, `Panel`, `Metric`, `Badge`,
   `NoBackendYet`, `Topology`, `LiveFeed`, `btn`, view functions are deleted in the
   same change that replaces them — no window where the page is broken.
3. **Verify** parity: every API call site and handler still present; honest empty
   states preserved; no fabricated values reintroduced.

No standalone "delete" commit is needed because the legacy primitives are not exported
or shared — they vanish when `page.jsx` is rewritten. This is the safest possible
removal: the blast radius is a single file.

## Honest-data debt removed permanently (Phase 10)

These were already removed in the v2 work and **must not return**:
`Math.random()`/`jitter()` metric generators, `setInterval` fake event stream,
mock revenue, the fabricated `1878` settled count, fake SOC/threat feeds, hardcoded
provider fleets, hardcoded operational metrics. The rebuild keeps them gone.
