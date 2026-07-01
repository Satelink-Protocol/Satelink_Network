# Satelink UI Design System — Grafana-Grade (Fable 5 rebuild)

Dark control-room aesthetic (Grafana / Datadog / New Relic / Cloudflare tier),
built on one non-negotiable rule:

> **Never render a number that isn't traceable to a real API response.**
> No data source → `<EmptyState>` ("No data yet"). A gorgeous empty panel is a
> success. A gorgeous fake-data panel is a failure that gets reverted.
> See `DATA_SOURCE_MAP.md` for the per-panel audit.

## Architecture

```
packages/ui/src/
├── tokens/            ← SINGLE SOURCE OF TRUTH
│   ├── tokens.css     state colors, spacing, radius, elevation, mono stack,
│   │                  motion, focus rings + .text-state-* utilities
│   └── index.ts       SystemState, STATE_META, normalizeState, MOTION
├── styles/theme.css   .satelink-os scope (imports tokens.css)
├── components/        primitives (below)
└── index.ts           public surface
```

The `.satelink-os` class scopes every token; `DashboardShell` applies it, and
standalone surfaces (e.g. the public status page) apply it at their layout.

## Tokens

### State color — color IS state, never decoration

| State | Token | Color | Meaning |
| :-- | :-- | :-- | :-- |
| `healthy` | `--state-healthy` | green | working |
| `degraded` | `--state-degraded` | amber | limping |
| `critical` | `--state-critical` | red | broken |
| `unknown` | `--state-unknown` | zinc | **no signal — the honest default** |
| `dry-run` | `--state-dry-run` | violet | simulated, not broadcasting |

Every pill/badge/dot/threshold resolves through `normalizeState(raw)` +
`STATE_META` from `tokens/`. Unrecognized statuses render **zinc**, never a
guessed green. Utilities: `.text-state-*`, `.bg-state-*`, `.pill-state-*`.

### Other scales

- **Spacing**: 4px base (`--space-1` … `--space-8`).
- **Radius**: `--radius-sm/md/lg` (4/6/8px).
- **Elevation**: `--elev-panel` (1px ring + soft shadow), `--elev-overlay`.
- **Typography**: `.numeric` → JetBrains Mono / system-mono, tabular-nums.
  ALL metric values are monospaced.
- **Motion**: 120–200ms ease-out ONLY (`--motion-fast: 140ms`,
  `--motion-slow: 200ms`, `--ease-out`). No bounce, no scale pops.
  `pulse-glow` is opacity-only. `prefers-reduced-motion` collapses all motion.
- **Focus**: 2px `--ring` outline on every interactive element inside
  `.satelink-os` (see tokens.css `:focus-visible` rule).

## Primitives (all support loading + empty + error)

| Component | File | Notes |
| :-- | :-- | :-- |
| `Panel` | `components/panel.tsx` | Core Grafana shell: title, description, actions, timeRange slot, status pill, context menu. Body renders skeleton / EmptyState / retryable error / children. |
| `KPIStat` | `components/kpi-stat.tsx` | Mono value, state accent edge, delta pill, low-opacity sparkline (real history only), time-window chip. `value: null` → "—". |
| `TimeseriesPanel` | `components/grafana/TimeseriesPanel.tsx` | Area/line/bar, low-opacity fills, `error` + `emptyHint` built in. |
| `StatusPill` / `HealthBadge` | `components/status-pill.tsx` | THE state-color source. `StatusBadge` (legacy) delegates to the same map. |
| `DataTable` | `components/data-table.tsx` | Sticky header (`maxHeight`), sortable columns (`sortValue`), pagination (`pageSize`), row hover, keyboard-activatable rows, shape-matched skeleton rows, empty + error states. |
| `LogFeed` | `components/grafana/LogFeed.tsx` | Mono rows, timestamp gutter, severity coding, keyboard-expandable rows, capped rows. |
| `AlertBand` | `components/grafana/AlertBand.tsx` | critical / high / warning / info / **resolved**, optional `ts` timeline gutter. |
| `EmptyState` | `components/empty-state.tsx` | Defaults to "No data yet". The ONLY correct rendering for absent data. |
| `Skeleton` | `components/ui/skeleton.tsx` | Shape-matched placeholders; DataTable/KPIStat/Panel compose it. |
| `DashboardShell` | `components/dashboard-shell.tsx` | Left nav, top bar, ⌘K palette, env chip, system-health dot (`health` prop — defaults to zinc **unknown**, never fake green), `refreshedAt` indicator. |

## Composition

Every page: **Header → KPI strip → status strip → panels → tables → activity.**
All six subdomains (admin, developer, node, machine, ops, status) share the
shell + tokens; each keeps its own nav.

## Data honesty contract (per panel)

1. Real endpoint with real data → wire it, render real values.
2. Endpoint returns 0 / tiny values ($0.00003, 1 node) → render the REAL value.
3. No endpoint → `<EmptyState>` + `// TODO: no data source yet — empty by design`.
4. Never pad sparklines/series with invented datapoints (zeros included).

## Accessibility

- WCAG AA contrast on all text.
- Focus rings on all interactive elements (token-level rule).
- Keyboard: ⌘K palette, sortable headers are buttons, clickable table rows and
  log rows respond to Enter/Space with `role="button"`.
- `aria-busy` on loading regions, `role="alert"` on error states,
  `aria-sort` on sorted columns.
