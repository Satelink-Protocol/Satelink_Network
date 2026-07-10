# Pricing Intelligence Engine

Autonomous market pricing intelligence: competitor tracking, an advisory
pricing brain with a hard profit floor, machine decision APIs, a
machine-preference trust score, and a conversion feedback loop.
Added 2026-07-10 (branch `worktree-pricing-intelligence`). All numbers in
every response are computed from production data or carry explicit
provenance (`source_url`, `observed_at`, `confidence`) — nothing is
fabricated (CLAUDE.md permanent rule).

## What it is NOT

- **It does not change what you are billed.** The serving path bills the flat
  `PRICE_PER_CALL_USDT` in `src/billing/credit_service.mjs` (credits rail) and
  `X402_PRICE_PER_CALL` (x402 rail), exactly as before. The engine records
  *recommendations* in `pricing_decisions` with `applied=false`. Applying one
  is an explicit human code change, the same class of decision as flipping
  `SETTLEMENT_DRY_RUN`.
- It does not touch x402 verification, settlement, RevenueVault, credits,
  the deposit listener or ledger accounting.

## Architecture

```
market_price_points (competitor snapshots, sourced)   node_health_logs / registered_nodes
        │                                                     │
        ▼                                                     ▼
  market_intel.js ──────────────┐                      capacity/perf signals
                                ▼                             │
  conversion_funnel.js ──▶ pricing_brain.js ◀─────────────────┘
  (ft:* Redis, payment_sources,     │
   api_credits, revenue_events_v2)  ▼
                            pricing_decisions (advisory, floor-clamped)
                                    │
        ┌───────────────────────────┴───────────────┐
        ▼                                           ▼
  /v1/pricing /v1/compare /v1/capabilities    /admin/pricing/*
  /.well-known/satelink.json                  (Pricing Command Center)
```

Module: `apps/api/src/economics/pricing_intelligence/`
(`schema.js`, `market_intel.js`, `price_floor.js`, `trust_score.js`,
`conversion_funnel.js`, `pricing_brain.js`, `index.js` facade with a 60s cache).

## Public machine endpoints

| Endpoint | Purpose |
|---|---|
| `GET /v1/pricing` | Billed pricing (unchanged base body) + market position, trust score, `why_choose_satelink`. Enrichment fails open — base body always returns. |
| `GET /v1/compare` | Satelink vs tracked providers: per-plan effective $/M, per-plan break-even volume vs Satelink pay-per-call, market median/average over verified rows, methodology + disclaimer. |
| `GET /v1/capabilities` | Live capabilities: served chains (from `registered_nodes`), auth modes, payment rails (x402 rail listed only when `X402_ENABLED=true`), measured 24h performance. |
| `GET /.well-known/satelink.json` | Manifest now links `compare_url` / `capabilities_url`. |

## Honest positioning (read this before quoting numbers)

Satelink's credits rail is **$30 per million calls** — roughly 10× the
per-million rate of bulk subscription plans ($1.2–8.9/M est.). The engine
never claims otherwise. The real, computed advantage is **zero commitment**:
no signup, no subscription, no monthly minimum. Break-even vs a $49/mo plan
is `49 / 0.00003 ≈ 1.63M calls/month`; below that volume Satelink costs fewer
absolute dollars. `/v1/compare` computes this per plan
(`breakeven_monthly_calls_vs_satelink`).

Competitor rows carry `confidence`:
`published` (request-priced plan, no conversion), `derived_estimate`
(plan price ÷ quota with the unit-conversion assumption documented in
`notes`), `unverified` (listed, **excluded from aggregates**). Update or add
rows via `POST /admin/pricing/competitor` — `source_url` and `confidence`
are mandatory.

## Machine Preference Score

Weighted components (weights renormalize when a data source is empty —
missing data becomes `null` + a caveat, never an invented number):
price 0.25 (vs verified market median, +15 for zero-commitment),
latency 0.20 / uptime 0.20 / reliability 0.15 (measured `node_health_logs`,
24h; single-node sample is caveated per audit #17), payment_ease 0.20
(documented rubric over verifiable capability facts). Live 2026-07-10:
**75.4/100** (price 21.6 — honestly low; latency 95 at p50 44ms; uptime 100;
payment_ease 80; reliability 100).

## Pricing brain

Runs every 6h (`cron_scheduler.js`, needs `ADMIN_CRONS_ENABLED=1`) and on
`POST /admin/pricing/evaluate` or `POST /admin/jobs/trigger/pricing-intel`.
Rules, in order:

1. **Capacity strained** (p50 > 250ms or error rate > 5%) → careful increase.
2. **Above market median + 0 paid conversions in 30d** → walk toward
   `PRICING_TARGET_MEDIAN_FRACTION` (default 0.8) of the median.
3. **Above median but converting** → hold and observe.
4. **At/below median with paid demand** → hold — *never race to zero*.

Every result is clamped: max ±25% move per evaluation, and **never below the
profit floor**. Each decision row stores the full evidence bundle (`inputs`
JSONB: market, demand funnel, capacity, floor derivation).

## Profit floor

`floor = max(PRICE_FLOOR_USD, MARGINAL_COST_PER_CALL_USD / 0.3)` — the 0.3 is
the platform's share of the 50/30/20 revenue split; the platform's slice must
cover marginal cost. Defaults: `PRICE_FLOOR_USD=0.00001`,
`MARGINAL_COST_PER_CALL_USD=0` (self-run node). Fixed infra
(`INFRA_MONTHLY_COST_USD`, default 25) is reported as
`cost_recovery_price_usd` + `break_even_monthly_calls` but deliberately not
folded into the unit floor (fixed cost is a volume problem). The x402 rail
has a separate hard floor of **$0.001/call** — the CDP facilitator rejects
verify below it (confirmed 2026-07-09).

## Admin (X-Admin-Token)

- `GET /admin/pricing/command-center` — mode, current price, market table,
  trust score, floor, conversion funnel, latest decision + recommended action.
- `POST /admin/pricing/evaluate` — run the brain now.
- `POST /admin/pricing/competitor` — upsert a sourced competitor price point.
- `GET /admin/pricing/market` — raw snapshot (same data as `/v1/compare`).

## Conversion funnel (real sources only)

anonymous requests (Redis `ft:*`, fallback `developer_intel`) → 402 wall
(`ft:*` counts ≥ `FREE_TIER_DAILY_LIMIT`) → pricing views (`pi:v:*` counters
bumped by the discovery endpoints, 8-day TTL) → payments
(`payment_sources` where `NOT is_test_data` + `api_deposits`, 30d) → paying
accounts / repeat usage (`api_credits`). Every stage is labeled with its
source in the response. The brain optimizes **paid conversion**, not traffic.

## Env vars

| Var | Default | Meaning |
|---|---|---|
| `PRICING_MODE` | `MANUAL` | Label only — decisions are always advisory in this build |
| `PRICE_FLOOR_USD` | `0.00001` | Absolute per-call floor |
| `MARGINAL_COST_PER_CALL_USD` | `0` | Marginal upstream cost per call |
| `INFRA_MONTHLY_COST_USD` | `25` | Fixed infra, for reported break-even only |
| `PRICING_TARGET_MEDIAN_FRACTION` | `0.8` | Decrease target as fraction of market median |

## Tables

`market_providers`, `market_price_points`, `pricing_decisions` — created by
`ensurePricingIntelTables()` at first use (and mirrored in
`migrations/028_pricing_intelligence.sql`). Seeds insert only when a provider
slug is absent, so admin corrections are never overwritten.

## Tests

`apps/api/test/pricing_intelligence.test.js` (15 tests: floor invariant, step
limiter, decision rules, snapshot math, trust-score honesty, fail-open
pricing endpoint). Run with `npx mocha --no-config --exit`. Verified
2026-07-10: full suite 110 passing; the 6 pre-existing failures on `main`
are byte-identical before/after this branch; all endpoints exercised live
against production Postgres (see PR).
