# Stage 43 — Automation bot runner (Phase 6 item 10)

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| worker pattern (self-scheduling loop, no overlap, fail-open, health server) | `workers/reconciler` | copied for `workers/trading-bots` |
| `runOnce()` jobs: OMS dispatcher / reconciler, fill consumer, portfolio reconciler | Stages 17–18 | the deterministic bots call them unchanged |
| kill-switch resolution | `risk/kill_switch.mjs` `engagedSwitches` | global switch → acting bots stop |
| daily key re-check | `security/key_recheck.mjs` (item 2) | scheduled daily |
| shadow revenue variance | `revenue/` (item 1) | hourly gauge |
| orchestrator / memory | items 8–9 | the only path for the event-driven AI bots |
| separate prom-client registry | `observability/metrics.mjs` (Stage 29) | same approach for bot metrics |

Before this item nothing scheduled the dispatcher, reconcilers or fill consumer (architecture map). The API process still schedules nothing (tested).

## What was built

- `apps/api/src/trading_agent/bots/` — 9 scheduled deterministic bots (market monitor 1 min, broker health 1 min, OMS dispatcher 2 s, OMS reconciler 15 s, fill consumer 5 s, portfolio reconciler 5 min, kill-switch watcher 10 s, key re-check 24 h [BINANCE], revenue variance 1 h [REVENUE_ENGINE]) and 2 event-driven AI bots (`opportunity.detected` → orchestrator `evaluate_opportunity`; `trade.closed` → orchestrator `post_trade_review` + memory). `BotRunner`: flags read per run, global kill switch stops acting bots (and fails closed when kill-switch state is unavailable), missing deps → not_configured, no overlap, timeouts, fail-open, bounded event queues, Prometheus metrics.
- `workers/trading-bots` — the separate process (`/health`, `/metrics`, SIGTERM). Lockfile: workspace link only. **Not deployed** (no Railway service, no `railway.json`): creating it, in staging first, is a founder action (B-06). Venue adapters and model providers are injected by the future execution service (B-08); until then those bots report not_configured.

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_bots.test.js` | **11 passing**: registry (9 + 2); deterministic bots run the jobs and never reach the orchestrator; flags read at run time (master + per-bot); **global kill switch stops acting bots, watchers continue**; fail-closed without kill-switch visibility; not_configured; fail-open error then recovery; overlap skipped; timeout; scheduling at each interval + stop() clears all timers; event bots via the orchestrator only, post-trade review writes memory, bounded queue drops; metrics text; API process has no bot/trading imports; **a real spawned worker process serves /health (11 bots) and /metrics (skipped_flag, no ok runs)** |
| Full API suite | 1066 passing, no new failures from this stage. The first run caught a real test fragility: another suite stubs `globalThis.fetch` and never restores it, so the worker test now uses `node:http`. The rate-limiter / TI / api-keys tests that failed under load pass alone (7/7, 2/2, 19/19 ×2) |
| Mutation checks (9) | all caught: master flag ignored, kill switch ignored, acting without kill-switch visibility, overlap allowed, timeout ignored, no rescheduling, unbounded queue, dispatcher not treated as acting, missing deps run |
| Postgres | the worker reads kill-switch events through the existing `PgRiskStore` (covered by Stage 15's integration suite); the bots drive Postgres stores end to end in the item-14 full-loop E2E |

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-06 (no staging) | yes, **not resolved** | the worker is not deployed anywhere |
| B-08 (execution service) | yes | venue adapters not wired in the worker → acting bots not_configured |
| B-03 / B-10 | no | nothing mounted in the API; no migration |
