# trading_agent/backtest

**Status:** Stage 14. `STATUS = 'skeleton'` = not wired at runtime: no routes, and nothing schedules the job runner.

**Responsibility:** event-driven backtesting of Stage 13 strategies on historical candles, with results labelled **`hypothetical`**. The engine here is shared with `../paper`.

**Table:** `backtests` (migration 024). It also serves as the job queue (`status = 'queued'`, claimed with `FOR UPDATE SKIP LOCKED`).

| Module | Purpose |
|---|---|
| `params.mjs` | sim-params v1 schema; normalised and hashed. Includes the per-instrument exchange filters |
| `calendar.mjs` | market hours: crypto 24/7, NSE 09:15–15:30 IST, NYSE 09:30–16:00 ET (DST-aware), injected holidays |
| `fill_model.mjs` | fees (taker / maker, rebates), slippage, tick / lot rounding (always against the trader), participation caps, limit fills |
| `engine.mjs` | `SimulationEngine`: fill → book → signal (Stage 13 evaluator) → equity, on a **simulated book only** |
| `data.mjs` | candle shape conversion; history validation, sorting and `dataHash` |
| `run.mjs` | `runBacktest`: pure, deterministic, sealed with `resultHash` |
| `job.mjs` | `BacktestJobService`: `enqueue` and `runOnce` (claim → run → complete / fail) |
| `store.mjs` | `InMemoryBacktestStore`, `PgBacktestStore` |
| `result.mjs` | `sealResult`, `parityView`, and Stage 13 lifecycle evidence (`backtestEvidence`, `paperEvidence`) |

**Rules:**
- Never imports a broker adapter, credentials, execution, orders / positions / outbox, the ledger, Redis or a queue library. This is checked by a test.
- Every result carries `label` + `disclaimer`. The database refuses `backtest` + `simulated` and `paper` + `hypothetical`.
- No vectorbt or other GPL/AGPL code; the engine is original.
