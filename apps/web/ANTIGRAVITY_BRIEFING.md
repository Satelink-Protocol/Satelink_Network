# Satelink Admin Dashboard — Project Briefing for Antigravity

**Read this entire file before proposing any redesign.** This is a handoff from
a prior multi-session effort (Claude + Claude Code). Every constraint below was
learned by hitting a real wall — re-deriving them by trial and error will waste
time that's already been spent.

---

## 1. What Satelink Is

Satelink is a live DePIN RPC gateway and settlement infrastructure on Polygon
mainnet (chain 137). It routes blockchain RPC traffic through 16 upstream
providers, meters calls at $0.00003/call, accumulates revenue in epochs, and
settles on-chain via Polygon smart contracts.

**Business state right now:** Pre-revenue. $0 external revenue. The dashboard's
entire purpose is to monitor the gateway and identify "Customer Zero" — the
first machine operator whose usage converts to a real USDT deposit. One IP
(`65.108.122.248`, Hetzner Finland) is the dominant candidate: it started at
~16K calls/day and has grown past 150K calls/day over ~183 days of continuous
usage, tracked live in the dashboard's lead pipeline.

This is **not** a consumer SaaS dashboard and not a generic analytics tool.
Every screen exists to answer one of: is the gateway healthy, who is about to
pay, what does the money pipeline look like, is settlement safe to enable.

---

## 2. Tech Stack — DO NOT DEVIATE WITHOUT CHECKING FIRST

```
Monorepo: apps/web (frontend) + apps/api (backend)
Frontend: Next.js (App Router), React, TypeScript
Styling:  Tailwind CSS v4  ← CRITICAL, see warning below
Charts:   recharts (already installed, v3.8.x)
Backend:  Express, Postgres (Railway), Redis (Railway)
Hosting:  Vercel (web), Railway (api)
Blockchain: Polygon mainnet via ethers/web3
```

### ⚠️ Tailwind v4 — this broke things twice already

This repo uses Tailwind v4: CSS-based `@import "tailwindcss"`, **no**
`tailwind.config.js`. Any library assuming Tailwind v3 (JS config, content
globs, `tailwind-*` prefixed utility classes from a plugin) will render
completely unstyled.

**Already tried and confirmed INCOMPATIBLE — do not suggest these again:**
- `@tremor/react` (latest 3.18.7) — built for Tailwind v3, uses
  `border-tremor-border` / `text-tremor-content` classes that don't exist on v4.
  No real v4 migration path exists (`tremor-ui` npm package does not exist).
- Gentelella v4 — not a React library at all. It's a vanilla JS + Vite +
  SCSS multi-page static template. Cannot be "installed" into a Next.js app.
- Any Bootstrap-based template — wrong CSS paradigm entirely for this stack.

**Confirmed COMPATIBLE and already partially trialed:**
- `shadcn/ui` — Tailwind v4 native, copy-paste source (no version-lock risk),
  chart component built on top of the recharts already installed. A trial
  card (`Customer Zero Countdown`) was rebuilt with it, scoped under a
  `.theme-shadcn` wrapper class so its CSS variables never leak into `:root`
  (the landing page already owns `--primary: #408A71` etc. in `:root` —
  letting shadcn write there breaks the landing page).

---

## 3. Current Design System — `satelink-os`

Location: `apps/web/src/components/satelink-os/`

A custom component library built specifically for this project, CSS Modules +
design tokens (`--sat-*` CSS custom properties), dark theme only, SigNoz-DNA
density (compact rows, mono fonts for data, uppercase 11px labels).

```
satelink-os/
  badges/StatusBadge
  charts/SparkArea, TrendStat
  events/EventStream
  forms/Button, Input
  layout/Grid, PageHeader, TopBar
  metrics/MetricCard
  navigation/SideNav
  shared/Panel, SectionLabel
  shell/AppShell
  tables/DataTable
  theme/theme.css   ← all --sat-* tokens defined here
```

Key tokens:
```css
--sat-canvas: #060910      /* page background */
--sat-panel: #0C1120        /* card/panel background */
--sat-border: #1A2840
--sat-teal: #4ECDC4         /* brand accent — used everywhere */
--sat-warn: #F59E0B
--sat-green: #34D399
--sat-red: #EF4444
--sat-text: #E2EAF4
--sat-muted: #64748B
Font (UI): Geist Sans (locally bundled, no network font fetch)
Font (mono/data): JetBrains Mono
```

**Decision standing:** keep `satelink-os` as the primary system. shadcn/ui may
be expanded to more panels ONLY if scoped the same way (`.theme-shadcn`
wrapper, never touching `:root`). Do not propose ripping out satelink-os
wholesale — it's deployed, working, and wired to real data across 6 pages.

---

## 4. Real Backend API Contracts — verified working, do not guess shapes

All routes proxied through `apps/web/src/app/api/admin-proxy/route.ts` (or
equivalent), which injects `ADMIN_SECRET_TOKEN` server-side. **Never** put the
admin token in client code or `NEXT_PUBLIC_*` env vars.

| Method | Path | Returns |
|---|---|---|
| GET | `/admin/intel/developers` | `{ ok, developers: [{ip, asn, isp, country, city, user_agent, classification, score, days_active, calls_today, avg_daily_calls, status, notes, outreach_attempts, last_outreach_at, first_seen, last_seen, updated_at}], count }` |
| PATCH | `/admin/intel/developer/:ip/stage` | `{ ok, ip, stage }` — body `{ stage }` |
| POST | `/admin/intel/classify` | `{ ok, classified, developers, crawlers, new }` |
| GET | `/admin/settlement/status` | `{ ok, dryRun, signerBalance, signerAddress, treasuryAddress, threshold, totalSettlements }` |
| POST | `/admin/settlement/dry-run` | body `{ enabled: bool }` → `{ ok, dryRun, updated }` |
| POST | `/admin/settlement/refund-signer` | `{ ok, tx, to, amount, polygonscan }` |
| GET | `/admin/jobs/status` | `{ ok, jobs: [{id, job_name, action, result (JSONB), created_at}] }` |
| POST | `/admin/jobs/trigger/:jobId` | jobId ∈ `ip-classifier`, `conversion-monitor`, `deposit-watcher`, `outreach-engine` |
| GET | `/admin/live/feed` | SSE stream |
| GET | `/admin/outreach/campaigns` | `{ ok, campaigns: [...] }` |
| POST | `/admin/outreach/discord/post` | sends to webhook (currently misconfigured, see §6) |

Tables backing this: `developer_intel`, `outreach_campaigns`, `automation_logs`,
`epoch_claims`, `credit_balances`.

Stage flow for leads: `identified → contacted → deposited → paid`

---

## 5. Current 6-Page Information Architecture

```
Overview      — gateway status, Customer Zero countdown (top 3 leads), 
                automation health, live event stream (SSE), 
                architecture reference diagram (static, not live data)
Demand Radar  — full lead pipeline table (20 real leads), conversion 
                funnel chart, IP classifier trigger, outreach buttons
Treasury      — settlement mode (DRY_RUN/LIVE), signer/treasury 
                addresses, typed-LIVE confirmation gate before 
                enabling real settlement (NEVER use window.prompt 
                for this — must be inline UI, see §6)
Revenue       — external revenue ($0.00 — honest), credit balance, 
                revenue pipeline (Usage→Metering→Epoch→Anchor→
                Settlement→Treasury), demand-by-lead area chart, 
                revenue projection bar chart
Agents        — automation job status/trigger, Paperclip AI link
Settings      — read-only config reference (env, thresholds, 
                external services, Paperclip company info)
```

This IA was deliberately reduced from an earlier 6-tab version that included
"Security" and "Intelligence/NOC" tabs — those were removed because they
displayed 100% fabricated data (hardcoded provider latencies, fake threat
feeds) with no real backend. **Rule: an empty/honest state is always better
than a fabricated metric.** Do not resurrect those tabs unless real backend
data exists to support them.

---

## 6. Hard Rules — learned the expensive way this session

1. **Never fabricate data, ever.** A backend bug once returned a hardcoded
   `1878` as a fallback "settled transactions" count on DB query failure.
   This shipped to production and was treated as real for a full session
   before being caught. Fallback values on error must be `0` or an explicit
   error state, never a plausible-looking fake number.

2. **DRY_RUN safety.** `SETTLEMENT_DRY_RUN=1` must stay on until a real
   Customer Zero deposit is confirmed. Any UI control that disables it must
   require **typed confirmation** ("type LIVE to confirm") via inline UI —
   `window.prompt()` is explicitly forbidden (it was used once, flagged as a
   safety bug, and removed).

3. **The metering rate is $0.00003/call.** A stale branch reintroduced
   `$0.00001/call` twice via merge conflicts. If you see `0.00001` anywhere,
   it's wrong — fix it to `0.00003`.

4. **No fabricated time-series.** Every chart must plot real values from the
   API (e.g., real `avg_daily_calls` per lead) — never synthetic/random walk
   data dressed up as a metric. Where there's genuinely no historical data
   yet, the UI says so explicitly in a caption (e.g., "Live trend available
   after RPC metrics pipeline") rather than inventing one.

5. **Chart type must match data shape.** A line/area chart implies a
   continuous trend. Using one to compare 3 discrete, unrelated leads
   visually implied "demand is crashing" when the opposite was true (one
   lead dominates the other two in magnitude, not over time). Discrete
   categorical comparisons → bar chart. Real trends over a sorted axis →
   area/line chart is fine.

6. **Outreach config bug, still open:** `DISCORD_WEBHOOK_URL` currently
   points to Satelink's own internal `#system-alerts` channel instead of an
   external community channel. The Customer Zero detector fires an alert
   within 5 minutes of any deposit — right now that alert is going nowhere
   useful. This is a backend config fix (Railway env var), not a UI task,
   but worth knowing if you touch the outreach panel.

7. **Branch hygiene.** This session repeatedly hit merge conflicts from
   stale branches sitting around after their PRs were squash-merged.
   Delete branches (local AND remote) immediately after merge.

---

## 7. What's Already Good — don't redesign for the sake of it

- Density and information hierarchy already match SigNoz's visual DNA:
  compact rows, mono fonts for data values, uppercase letter-spaced labels,
  dark canvas with teal accent.
- MetricCard, DataTable, PanelHeader components are solid, reusable, and
  already used consistently across all 6 pages.
- Real data wiring across every page is correct and verified — the gap is
  purely visual polish and (optionally) wider shadcn adoption, not data
  correctness.

---

## 8. What To Actually Do

1. **Audit first.** Browse the live SigNoz documentation/demo at
   https://signoz.io/docs/introduction/ and https://signoz.io directly
   (you have browser capability — use it, don't guess from memory).
   Compare against the current live dashboard at `admin.satelink.network`.
2. **Identify specific, concrete gaps** — not "make it look more like
   SigNoz" in the abstract. Name exact components, exact pages, exact
   visual deltas.
3. **Propose a plan before writing code.** List what changes, what doesn't,
   and why. Get explicit approval before touching more than one panel at a
   time.
4. **Respect every constraint in §2 and §6.** Re-breaking a rule that's
   already documented here is the one mistake that wastes the most time.
