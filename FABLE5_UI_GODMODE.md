# SATELINK @satelink/ui — GRAFANA-GRADE REBUILD

## ROLE
Design Systems Architect for Satelink. Rebuild @satelink/ui so every dashboard
(admin, developer, node, machine, ops, status) looks and feels like Grafana /
Datadog / New Relic / Cloudflare. Full creative freedom over visual system.
ZERO freedom to invent data.

## THE ONE UNBREAKABLE RULE
Real state today: 1 node, 1 paying customer, $0.00003 lifetime revenue, 40,169 IPs.
- NEVER render a number not traceable to a real API response.
- If no data source exists → render EmptyState ("No data yet"). NOT mock numbers.
- Forbidden fabricated values that must NEVER appear: 1878, 642.83, 1482, any invented metric.
- A gorgeous empty panel = SUCCESS. A gorgeous fake-data panel = FAILURE, gets reverted.

## VISUAL TARGET
Grafana dark control-room:
- Background: --background 220 20% 4% (keep/refine)
- Primary teal: 174 80% 38%
- Dense panel grid, 1px borders, generous internal padding
- Monospaced numerics for ALL metric values
- Color = state ONLY: green healthy / amber degraded / red critical / zinc unknown
- Sparklines under KPIs, subtle, low-opacity area fills
- Tables: sticky headers, inline status pills, row hover states

## SCOPE
Work in: packages/ui/src/
May update how apps/web pages IMPORT and COMPOSE components.
Do NOT touch: API endpoints, middleware, backend data fetching, contracts/.

## DESIGN TOKENS — packages/ui/src/tokens/
Single source of truth:
- State-based color (healthy/degraded/critical/unknown/dry-run)
- Spacing scale (4px base)
- Radius scale
- Elevation/shadow
- Typography (mono stack for numerics: JetBrains Mono or system-mono fallback)
- Motion: 120-200ms ease-out ONLY. No bounce. No flashy.
- Focus rings on all interactive elements

## PRIMITIVES — packages/ui/src/components/
Each must support: loading (skeleton) + empty (EmptyState) + error states.

1. Panel — core shell. Props: title, description, actions slot, timeRange slot,
   status badge, contextMenu, loading, empty, error, children. Grafana panel feel.
2. KPIStat — mono primary value, delta with direction color, optional sparkline,
   threshold state indicator, time-window label. loading=skeleton, empty="—"
3. TimeseriesPanel — area/line chart, low-opacity fill, empty state built in.
4. StatusPill / HealthBadge — single state-color source for the whole system.
5. DataTable — sticky header, sortable cols, inline status cells, row hover,
   pagination, empty state, skeleton rows on load.
6. LogFeed — monospaced, timestamp gutter, severity color coding, virtualized.
7. AlertBand — critical/warning/info/resolved variants with timeline support.
8. EmptyState — icon + "No data yet" + optional hint text. Used EVERYWHERE data is absent.
9. Skeleton — shape-matched loading placeholders for all components.
10. DashboardShell — persistent shell: left nav, top bar, env selector, refresh
    status, system-health dot, command palette trigger. Shared across all 6 subdomains.

## DASHBOARD COMPOSITION
Page structure: Header → KPI strip → status strip → panels → tables → activity feed.
Grid-based, dense but not cluttered. Every panel earns its space.

Subdomain personalities (shared shell + tokens, unique nav):
- admin: 15 tabs EXIST and work — RESTYLE with new tokens, do NOT rebuild data logic
- developer: keys, usage, deposit, mission control — restyle
- node: 9 views EXIST — restyle with new system
- machine: 9 views EXIST — restyle with new system
- ops: currently redirect — apply shell theme only, don't build new pages
- status: keep the live health page, apply tokens only

## DATA HONESTY ENFORCEMENT
Per panel, before touching it:
- Real endpoint with real data → wire it, show real values
- Endpoint exists but returns 0/empty (e.g. $0.00003 revenue) → show THE REAL VALUE
- No endpoint → EmptyState + code comment: // TODO: no data source yet — empty by design
- Produce: packages/ui/DATA_SOURCE_MAP.md listing every panel with: real endpoint | empty-by-design

## MOTION + ACCESSIBILITY
- All transitions: 120-200ms ease-out. No bounce, no scale pop, no flashy.
- Focus rings: visible on ALL interactive elements
- Keyboard navigation: tables, command palette, modal dialogs
- Contrast: WCAG AA minimum on all text
