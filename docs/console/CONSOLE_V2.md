# Console V2 — simple for anyone, powerful when needed · 2026-09-25

Branch `feat/console-v2`, stacked on `feat/pricing-v2-dodo` (#426) → `feat/console-accounts-v1` (#425).
Active only with `CONSOLE_ACCOUNTS_V1=true` on the console (Vercel) **and** the API; with the flag
off the console is unchanged (per-browser key mode).

## Two modes, one console
- **Simple** (default for new accounts): Home asks *"What do you want to do?"* with four task cards.
- **Advanced**: a Grafana-style dashboard. Toggle in the header; the choice is an **account
  setting** (`defaultMode`, via `/v1/me/settings`), mirrored in a cookie — a fresh browser opens in
  the saved mode.

### Simple flows (stepper, one primary button per step, a Done screen, plain words)
| Flow | Steps | Notes |
|---|---|---|
| **Get market data** `/data` | what (metric in words) → which market (searchable, **free** symbol list) → price & run (shows which bucket pays) → result | chart + table + **one factual sentence, never advice**; Save / Download CSV / Copy API call. The key never reaches the browser: `POST /v1/me/intelligence/:metric {keyId}` |
| **Give my software access** `/agents/new` | name → what it can use (market data / RPC) → monthly limit → key shown once + **Test it** (free check) → done | scopes + monthly cap enforced by the API on every call |
| **Add money** `/billing/add` | plan / credit pack / USDT → choose (from the PlanCatalog) → pay (Dodo checkout, or USDT address + tx-hash claim) → confirmation | Launch copy "$5 for your first month. Renews at $19/month." comes from the catalog |
| **See what I've spent** `/spend` | one page | this month (credits), credits left, pack UU, plan session/weekly meters with reset times (account timezone), spend per agent |

Jargon (x402, UU, RPC, API key, crypto credits, windows) has an inline **"What's this?"** button
(keyboard/touch, not hover-only).

### Advanced dashboard
Panel grid (12 columns; **drag to reorder**, ← → buttons for keyboard, shrink/grow; **Save layout**
per account), time range 1h/24h/7d/30d/90d, auto-refresh Off/30s/1m/5m (**free reads only**),
template variables **Key** and **Product**.
Panels — all from real endpoints, each with loading/empty/error states:
balance (crypto credits · pack UU · plan UU left) · spend · requests · error rate · plan usage
(session + weekly meters, linear pace projection, labelled) · top agents · requests by agent ·
spend by agent · requests by weekday × hour heatmap · requests by status · **market panels**:
funding heatmap (symbol × exchange, diverging), open-interest change, spread, liquidation pressure
(**labelled model**) · request log explorer (filters, keyset pagination, receipt ids).
Market panels **never auto-run**: each run is an explicit, priced click ("Run ($0.01)").

**Candles / indicators:** the Trading Intelligence API returns point-in-time snapshots, not OHLC or
time series — so there are no candlesticks and no moving averages/bands; the panels say so rather
than inventing a series.

### Charting decision
Dependency-free SVG components (`components/v2/charts.tsx`: line/area with crosshair tooltip,
ranked bars, heatmap, meter, sparkline, stat) — **0 kB of chart library**. Every chart has a legend
for ≥ 2 series, a "Show table" view and a hover readout. Series colours are the brand hues
re-stepped per theme and **validated with the dataviz six-checks script** (light and dark: all
pass; tritan ΔE in the 6–8 band → legends + labels always present). Revisit uPlot only if a panel
needs > ~5k points.

### Everything else
- **Settings**: profile, sign-in methods, **self-serve TOTP 2FA** (Better Auth two-factor; needs a
  password sign-in method), sessions, **preferences** (default mode, timezone for weekly resets,
  account monthly spend cap, credit auto-use, alert thresholds 70/85/95/100, email preferences),
  account data export, deletion request. API-key defaults and team invites stay hidden until built.
- **Billing** renders Pricing V2 from `/v2/plans` + `/v1/me/plan` — the old "included calls / month"
  table is gone (AUDIT_2026-09-25 D9).
- **Mobile**: bottom tab bar (Home · Data · Agents · Billing · More), stacked cards, 360 px tested.

## Gates (2026-09-25, production console build + local harness running the real API routers)
| Gate | Result |
|---|---|
| `e2e/simple-flows.spec.ts` — **all four Simple flows completed using only visible labels**, desktop and **360 px**; axe clean on every screen visited; Billing = PlanCatalog; bottom tabs; Advanced panels + explicit paid run + mode remembered across a fresh browser; perf budget | **13/13**, twice in a row |
| Add money → **real Dodo TEST checkout** (`test.checkout.dodopayments.com`) | pass |
| `e2e/accounts-gate.spec.ts` (Phase 2: same keys on three browser profiles) | pass |
| Performance budget, console home | **119 kB JS** on the wire (budget 160 kB), LCP 144 ms (local, unthrottled) |
| Screenshots, 6 pages × 5 widths × 2 themes (TEST DATA from the harness) | `docs/console/screens-2026-09-25/`, no horizontal scroll |
| API suite | 327 pass / 19 fail — identical to `main`'s pre-existing failures |

Harness: `apps/api/test/harness/console_accounts_harness.mjs` — real `/v1/me`, `/v2/plans`,
`/v1/intelligence` (seeded snapshots marked `test_fixture`), `/v1/console/summary`; runs under
`railway run` for the Dodo **test** key with `DATABASE_URL`/`REDIS_URL` stripped so it can never
touch production.
