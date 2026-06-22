# COMMAND_CENTER_V3_PLAN.md

Target: `apps/web/src/app/admin/command-center/` becomes the infrastructure cockpit
(Railway/Datadog/Cloudflare-class). Transform in place — no new architecture.

---

## What exists today (verified)

- `page.jsx` — 394 lines, `"use client"`. Renders a `DashboardShell` from `@satelink/ui`
  with two nav groups (`Operations`, `Infrastructure`) and a 7-view switcher held in
  `useState("overview")`.
- `constants.ts` — 72 lines: `NAV`, `HEADERS`, `PROJECTION_DATA`, `ARCH_TOPOLOGY`,
  `TEMPLATES`, `TRIGGERABLE_JOBS`, `fmt`.
- `layout.tsx` — scopes `satelink-os` CSS under `.sat-os`.
- `page.jsx.bak` — stale backup (DELETE).
- Data via `adminFetch()` → `POST /api/admin-proxy` → backend
  (`/settlement/status`, `/intel/developers`, `/jobs/status`, nodes).
- Domain viz from `@/components/satelink-os`: `TopologyDiagram`, `RevenueProjectionChart`,
  `LeadPipelineTable`, `CustomerZeroPanel`, `LiveEventStream`, `AutomationHealth`,
  `FilterPanel/Group/Checkbox`.

**Current views (NAV ids):** `overview, noc, radar, revenue, treasury, nodes, settings`.

---

## Required sections → current mapping → gap

| # | Required section | Current view | Status | Action |
|---|---|---|---|---|
| 1 | Executive Overview | `overview` | EXISTS | Add SLA/uptime + revenue-truth KPI tiles |
| 2 | Revenue Command Center | `revenue` | PARTIAL | Split "metered (unbilled)" vs "collected on-chain"; wire to `/settlement/status` + revenue endpoints |
| 3 | Network Operations Center | `noc` + `radar` | PARTIAL | Merge into one NOC: node fleet table + `TopologyDiagram` + live RPC throughput |
| 4 | Settlement Operations | `treasury` | PARTIAL | Surface epoch anchor state, `POLYGON_SIGNER_KEY` presence, last settlement tx, RevenueVault balance |
| 5 | Billing Operations | — | **MISSING** | New view: deposits, credits balance, per-customer usage, API-key issuance |
| 6 | Security Operations | — | **MISSING** | New view: rate-limit hits, auth failures, key abuse, firewall/WAF signals |
| 7 | Alert Center | — | **MISSING** | New view: feed of `ACTIVE_EVENTS.md`-class incidents + ack/resolve actions |

---

## File-by-file actions

### C0 — Hygiene
```bash
git rm apps/web/src/app/admin/command-center/page.jsx.bak
```

### C1 — Extend nav model (`constants.ts`)
Add three ids to `NAV` and `HEADERS`:
```ts
// NAV (Infrastructure group)
{ id: "billing",  label: "Billing Ops" },
{ id: "security", label: "Security Ops" },
{ id: "alerts",   label: "Alert Center" },
```
Add matching `HEADERS[...]` entries (title/subtitle) and `ICONS` map entries in `page.jsx`
(`CreditCard`, `ShieldAlert`, `BellRing` from `lucide-react`).

### C2 — Billing Ops view (NEW, §5)
- Data: extend `adminFetch` calls — `/credits/admin/overview` (deposits, credit balances),
  `/intel/developers` (already wired) for per-customer usage, `/api/keys/admin` for issuance.
- UI: `KPIGrid` (total deposited, active credits, paying customers, keys issued) +
  `DataTable` of customers (deposit, balance, calls today, key status) + `EmptyState`
  ("No paying customers yet — Customer Zero open").
- All `@satelink/ui`.

### C3 — Security Ops view (NEW, §6)
- Data: backend already has `apps/api/src/security/middleware/rate_limits.js` and
  `featureGate.js`. Add/consume an admin endpoint summarizing rate-limit blocks, auth
  failures, and abusive keys.
- UI: `KPIGrid` (blocked requests, auth failures 24h, flagged keys) + `DataTable` of recent
  security events + `StatusBadge` severity.

### C4 — Alert Center view (NEW, §7)
- Data source: surface `agent/memory/events/ACTIVE_EVENTS.md` via an admin endpoint, or a
  new `/alerts` API reading the events store.
- UI: reuse `LiveEventStream` (already imported) for the feed + `DataTable` for open
  incidents with ack/resolve buttons (`Button` from `@satelink/ui`).

### C5 — Settlement Ops hardening (§4, existing `treasury`)
- Add tiles: epoch anchor running (yes/no), `POLYGON_SIGNER_KEY` configured (yes/no — the
  documented revenue blocker), last settlement tx hash (Polygonscan link), RevenueVault USDT
  balance. Pull from `/settlement/status` (already fetched as `status`).

### C6 — Revenue truth (§2, existing `revenue`)
- Enforce the "real data only" rule from CLAUDE.md: clearly label **metered/unbilled** epoch
  revenue vs **collected on-chain** USDT. Use `RevenueProjectionChart` for projection,
  `StatCard` with `MetricTrend` for collected truth.

### C7 — Extract domain viz to `@satelink/ui` (cross-cuts DESIGN_SYSTEM_CONSOLIDATION)
Move the 7 viz components command-center depends on out of `satelink-os` into
`packages/ui/src/components/viz/` and re-export, so command-center stops importing
`@/components/satelink-os`. This is the final step to make `@satelink/ui` the sole source.

---

## Sequencing
C0 → C1 → (C5, C6 quick wins on existing data) → (C2, C3, C4 new views) → C7 (extraction).
Each view ships independently behind the existing `view` switcher; no big-bang rewrite.
