# Deployment PR — Customer Zero UI (additive)

**Branch:** `integration/customer-zero-ui` → base `origin/main` (`b5aaec5`, incl. #171).
**Type:** purely additive. No force push. No production deploy. Origin pages untouched.

---

## Summary

Adds the four customer-facing OS routes that currently 404 in production
(`keys`, `usage`, `billing`, `monitoring`), the embedded-Grafana BFF, and the
`@satelink/ui` design system they depend on. All new routes live in a
`(metering)` route group with their own `DashboardShell` layout, so **none of
origin's pages** (`deposit`, `overview`, `nodes`, `command-center`) and **none
of origin's `components/ui` / `satelink-os` design system** are modified.

Build ✅ · Typecheck ✅ · All routes 200 · Origin routes still 200.

---

## Files Added

Design system (`@satelink/ui`, previously uncommitted):
- `packages/ui/src/components/*` — dashboard-shell, kpi-grid, stat-card, data-table,
  dashboard-section, status-badge, metric-trend, page-header, async-boundary,
  error/empty/loading-state, error-boundary, grafana-panel
- `packages/ui/src/components/ui/*` — card, table, badge, input, separator, sheet,
  sidebar, skeleton, tooltip, command, dialog, chart
- `packages/ui/src/hooks/use-mobile.ts`, `packages/ui/src/lib/utils.ts`,
  `packages/ui/src/styles/theme.css`

App (additive):
- `apps/web/src/app/satelink/os/(metering)/layout.tsx` — DashboardShell layout (group-scoped)
- `apps/web/src/app/satelink/os/(metering)/{keys,usage,billing,monitoring}/page.tsx`
- `apps/web/src/app/api/grafana/[...path]/route.ts` — Grafana embed BFF
- `apps/web/src/lib/api-keys.ts`
- `apps/web/src/components/billing/{shared.tsx,DepositQR.tsx}`

## Files Modified (config merges only)

- `apps/web/next.config.ts` — add `transpilePackages: ["@satelink/ui"]`; exclude
  `/api/grafana/*` from the backend `api` rewrite so the BFF route handler wins.
- `apps/web/src/app/globals.css` — import `@satelink/ui` theme tokens + `@source`;
  extend `dark` variant to `.satelink-os`; add `--color-success` / `--color-warning`.
- `apps/web/package.json` — add `@satelink/ui` (workspace) + `qrcode.react`.
- `packages/ui/package.json` — add design-system deps (cva, clsx, tailwind-merge,
  lucide-react, radix-ui, recharts).
- `packages/ui/src/index.ts` — export the full design system (was Button-only).
- `package-lock.json` — lock the two new deps.

## Conflicts Resolved

| File | Resolution |
|---|---|
| `apps/web/src/app/satelink/os/deposit/page.tsx` | **KEEP_ORIGIN** — origin's creditService-coupled deposit page is canonical; my rewrite dropped. |
| `apps/web/src/app/satelink/os/overview/page.tsx` | **KEEP_ORIGIN** — onboarding-strip edit dropped. |
| `apps/web/src/app/admin/command-center/page.jsx` | **KEEP_ORIGIN** — V3 rewrite dropped. |
| `apps/web/src/components/ui/*` (the app's local fork) | **KEEP_ORIGIN** — origin pages depend on it; fork-removal + guard NOT ported. |
| `packages/ui/src/index.ts`, `next.config.ts`, `globals.css`, package.json×2 | **MERGE** — additive only (see above). |

## Routes Added (were 404 in production)

```
/satelink/os/keys        200
/satelink/os/usage       200
/satelink/os/billing     200
/satelink/os/monitoring  200
/api/grafana/[...path]   503 (correct — Grafana unconfigured; not a backend 404)
```
Origin routes unchanged: `/satelink/os/{overview,deposit,nodes}`, `/admin/command-center` → 200.

## Customer Zero Improvements

- **Keys**: create / revoke (local) / copy / masked / one-time reveal, last-used,
  requests-today, credits-consumed, status, Getting-Started + inline first-request curl.
- **Deposit detail surfaced in Billing/Usage** (origin's deposit page remains the funding UI).
- **Billing Command Center**: Current Balance, Consumption (today/week/month),
  Revenue Events (running balance), deposits+deductions Credit-History ledger.
- **Usage**: requests, billable requests, credits consumed, avg cost, usage/cost timelines;
  honest empty states for telemetry the gateway doesn't expose.
- **402 recovery** primitive (`InsufficientBalance`) available to the new pages.

## Monitoring Improvements

- `/satelink/os/monitoring`: real-data KPI strip (live API) over embedded Grafana panels
  (Overview / RPC Health / Provider Health / Revenue / Settlement / Alerts).
- `GrafanaPanel` (@satelink/ui) + `/api/grafana` BFF: server-only `GRAFANA_URL`/`GRAFANA_TOKEN`,
  strips frame-blocking headers, returns 503 until configured. No mock data.

## Risk Assessment

- **Low.** Additive: new files + 4 config merges. No origin page or design system modified.
- Two design systems now coexist (origin `satelink-os` + `@satelink/ui`). Bundle grows by the
  new routes only; origin routes unchanged in size.
- UX seam: the `(metering)` shell nav links to `overview`/`deposit` (origin pages) which render
  without the new shell — clicking them leaves the shell. Acceptable; can be unified later.
- `@wagmi/connectors` optional-peer "module not found" warnings are **pre-existing in origin's
  deposit page**, not introduced here; build still succeeds.

## Rollback Strategy

- Revert the merge commit, or delete the `(metering)` group + revert the 4 config merges.
- No data migrations, no backend changes, no env required for the routes to build/serve
  (Grafana panels degrade to an honest "unavailable" state until `GRAFANA_URL`/`GRAFANA_TOKEN`
  are set).

## Verification

```
npm install            ✅
next build             ✅ (all routes compiled)
tsc --noEmit           ✅ (0 errors)
runtime smoke (:3198)  ✅ new routes 200, origin routes 200, BFF 503
```
