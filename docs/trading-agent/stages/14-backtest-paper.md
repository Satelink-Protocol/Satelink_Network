# Stage 14 — Backtester and paper simulator

**Branch:** `trading-agent/stage-14-backtest-paper`, stacked on Stage 13 (#469).

**Goal:** one event-driven simulation engine in Node, running the Stage 13 evaluator, shared by a backtester and a paper runner. Same data in → same signals, orders and fills out (parity). Results are labelled **`hypothetical`** (backtest) or **`simulated`** (paper).

**Code:**
- `apps/api/src/trading_agent/backtest/` (engine, fill model, calendar, params, job, stores)
- `apps/api/src/trading_agent/paper/` (feed adapter, persistence)

**DB:** additive migration `024_backtests.sql`. Its down file is `database/migrations-down/024_backtests.down.sql` (local/ephemeral only).

**API:** none. Nothing is mounted, and nothing schedules the job runner or starts a paper run.

## Inspection and STOP evaluation

> STOP if: a Python sidecar seems necessary (propose, do not add).

**Not triggered.**
- The Stage 13 evaluator is already Node, pure and deterministic. The rest is event bookkeeping in exact fixed-point arithmetic.
- No numerical library is needed, and nothing in vectorbt / pandas is required.

**Throughput measured on this machine** (the Stage 13 evaluator recomputes indicators over its window every bar):

| `windowBars` | 1,200 bars |
|---|---|
| 60 | ≈ 0.6 s |
| 120 | ≈ 1.2 s |
| 500 | ≈ 3.9 s |

That is ample for hourly strategies and for this stage's fixtures. Long minute-bar backtests would want an **incremental evaluator** (same maths, O(1) per bar) in `strategies/`; that is a Node change, not a sidecar, and is listed as a follow-up.

**Queue / job convention** (brief §3–4; from audit 02 §3):
- **No queue runs in production.** BullMQ exists only in unreachable code (`src/queue/*`, `services/scheduler`).
- Every live job is an in-process `setInterval` / self-scheduling `setTimeout` in `Satelink-api`, with Redis used for counters and caches only.

So Stage 14 adds **no queue library and no Redis use**. The `backtests` table is the queue:
- `enqueue()` inserts a `queued` row;
- `runOnce()` claims the oldest one with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, runs it, and marks it `completed` or `failed`.

`runOnce()` is the unit a scheduler or worker would call. Wiring it, behind a flag, is a later stage.

**Licences:** no vectorbt or GPL/AGPL code. The engine is original, and a test greps both directories for vectorbt and GPL markers.

## Engine (shared)

Per closed candle, in `(openTime, instrument)` order:

| Step | What happens |
|---|---|
| 1. Fill | The instrument's pending order fills if it **arrived** during this bar (`decision time + latencyMs < bar close`). **Market:** bar open moved by `slippageBps`, tick-rounded against the trader. **Limit:** fills if the bar trades through, at the better of open and limit. **Participation:** at most `maxParticipationPct` % of bar volume (lot-floored), so the rest carries over (**partial fills**). An unfilled order expires after `maxBarsToFill` bars. **Fees:** taker for market, maker for limit (negative = rebate) |
| 2. Book | Window update, mark-to-market, position ageing, and `barsSinceLastExit` for cooldown |
| 3. Signal | Skipped if the bar is **stale**: a data gap (missing bars) or flagged by paper's wall-clock check. Otherwise the Stage 13 evaluator runs at bar close; `enter` / `exit` becomes an order after these **checks / rejects**: market hours at arrival (`market_closed`), `max_positions`, sizing floored to the lot (`below_min_qty`), `below_min_notional`, 1× cash collateral (`insufficient_cash`), and seeded venue rejects (`rejectRateBps` + `seed` → `venue_reject`) |
| 4. Equity | Running peak and max drawdown |

**Model limits (stated, not hidden):**
- **Intrabar path is unknown:** fills use the bar open, and limits use the bar's high/low.
- **No margin, funding or borrow model:** entries need 1× cash collateral on both sides.
- **Exits:** always market orders, and they skip min-size filters.
- **Stale bars:** a stale bar also skips that bar's stop check, so the exit comes on the next fresh bar.
- **Holidays:** injected via `params.holidays`, not built in. Half-days are not modelled.

**Market hours** (`calendar.mjs`):
- binance / mock: 24/7.
- upstox (NSE): Mon–Fri 09:15–15:30 Asia/Kolkata.
- alpaca (NYSE): Mon–Fri 09:30–16:00 America/New_York, DST-aware via Intl tz data.

**Parameters** (`sim-params/1.0`, validated, normalised and hashed like a strategy):
- `initialCash`, `quoteCurrency`;
- per-instrument `tickSize` / `lotSize` / `minQuantity` / `minNotional` (Stage 10 shape);
- `fees`, `slippageBps`, `latencyMs`, `partialFills`, `rejectRateBps`, `seed`, `windowBars`, `holidays`, `passCriteria`.

**Reproducibility:** a backtest result is fully determined by `definition_hash + params_hash + data_hash`.

## Paper runner (adds only feed handling)

- Ignores unclosed candles.
- Drops duplicates from overlapping polls.
- **Watermark release:** a bar is released only when every instrument has reached it, so a shared cash book sees exactly the backtest's order.
- **Staleness:** Stage 11 `computeStaleness` against the injected clock. A bar is stale if its close is older than `staleAfterMs` (default one interval). For parity, `staleAfterMs` must exceed the feed's worst lag.
- **Polling:** `pump()` polls a Stage 11 provider-shaped port with `purpose: 'internal_use'`, so entitlements apply and a failed poll fails closed.

## Labelling

| | Backtest | Paper |
|---|---|---|
| `result.label` | `hypothetical` | `simulated` |
| id | `bkt_…` | `ppr_…` |
| `disclaimer` | "HYPOTHETICAL RESULTS: simulated on historical data … no orders were placed and no funds moved …" | "SIMULATED RESULTS: paper trading against a simulated book … no real orders …" |

The 024 CHECK makes any other pairing impossible.

## Migration 024 — `backtests`

- **Keys and provenance:** FKs to `principals` and `strategy_versions`; `mode`, `label`, `status`; hashes for definition, params, data and result; `engine_version`, `attempts`.
- **CHECKs:**
  - label ↔ mode ↔ id prefix;
  - only backtests are queued;
  - backtests need a data window;
  - `completed` ⇒ result, hash, passed and bars present;
  - a final status ⇒ `finished_at`;
  - `failed` ⇒ error.
- **Trigger:** provenance columns are immutable, and a final row is frozen.
- **DELETE** is revoked from PUBLIC and `satelink_app`.

**Rollback order (new rule):** 024 has an FK into 021 (`strategy_versions`), so 021's down migration only works after 024's. Rollbacks run in reverse order. The Stage 09 round-trip test now rolls back dependents first (`DEPENDENT_DOWNS`); any future migration referencing 021 tables must be added there.

## Lifecycle integration (Stage 13)

| Helper | Gives | Status |
|---|---|---|
| `backtestEvidence(row)` | `{backtestId, definitionHash, bars, passed}` | **Tested end to end:** a job's result moves a version DRAFT → BACKTESTED through `StrategyService` |
| `paperEvidence(row)` | `{paperRunId, definitionHash, days, trades}` | Passes the PAPER → LIVE_SMALL evidence schema; the transition is still refused, solely by the `LIVE_TRADING` lock (asserted) |

`passed` uses `params.passCriteria` (`minTrades`, default 1; `maxDrawdownPct`, default 50).

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-06 (no staging) | yes (migration 024) | applied only to local ephemeral Postgres; nothing deployed or scheduled |
| B-07 (migration tooling) | yes | additive 024 via the canonical runner; down file is local-only; rollback order documented |
| B-09 (scope / legal, market data) | yes | candles only via injected ports; paper polls with `purpose: 'internal_use'` (Stage 11 entitlements, deny by default); no redistribution |
| B-08 (KMS / execution) | no | simulated book only; no broker, credentials or orders. A static test forbids those imports and real-book writes |
| B-03 / B-10 | no | not mounted (the register test checks `app_factory.mjs` / `server.js`) |
| B-01, B-02, B-04, B-05, B-11 | no | — |

No blocker changes status. The Stage 14 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-04)

| Suite | Result |
|---|---|
| `apps/api/test/trading_backtest_paper.test.js` (mocha) | **26 passing** |
| Integration, local Postgres 16 (guard-DB recipe): `trading-backtests` (4 new) + strategy DSL + agent traces + market data + foundation (021 round trip now rolls back 024 first) | **17 passing**; temporary DBs dropped, none left behind |
| `scripts/ci-baseline-check.sh` | clean run: **682 tests / 562 pass / 2 known failures / 118 pending** (+26/+26 vs Stage 13) |

**Baseline flakiness, reported honestly:**
- Two other full runs reported failures outside the baseline, in `identity_rate_limit.test.js` (different cases each time; time-window rate-limit tests, already flaky at Stage 12) and once in `rpc_charge_after_success.test.js`.
- Run alone, both pass 3/3 (17/17 and 9/9).
- They sort before the `trading_*` files, so they run before any Stage 14 code is loaded. Not fixed here (out of scope).

### Brief acceptance mapping

**Parity: 100% on fixture data.** The fixture is 2 instruments × 600 hourly bars, from a deterministic generator. Three variants were run:
- market orders with the default fill model;
- limit orders + latency > 1 bar + 8% seeded venue rejects + 15% participation with a 2-bar expiry;
- short side + maker rebate + data gaps in both instruments.

In every variant `parityView(paper)` deep-equals `parityView(backtest)`: signals, orders, fills, trades, rejects, metrics, open positions and `passed`. The paper side is fed through a **live-like replay**:
- overlapping 5-bar polls (duplicates);
- a forming, unclosed bar on every poll;
- ETH lagging one bar on every third poll (exercises the watermark);
- Stage 11-shaped candles with ISO timestamps.

The test also asserts that duplicates and unclosed bars were actually seen, and that every call used `purpose: 'internal_use'`. A control case shows that a strict staleness threshold makes paper diverge, with every bar stale and no signals.

**Fee and slippage maths are exact:**
- fees (including rebates and tiny notionals);
- slippage with tick rounding against the taker;
- passive limit prices;
- limit fill rules;
- participation caps.

**A hand-computed round trip matches to the last digit:**
- buy fills at 107.11 (fee 0.10711); sell at 92.90 (fee 0.0929);
- PnL −14.41001; final equity 985.58999; max drawdown 1.518…%.

A hand-computed **limit** round trip also matches: rests at 105.89, misses a bar, fills with a 2 bps maker fee (0.021178), PnL −13.104078.

**Other behaviours covered:**
- latency ≥ 1 bar delays the fill;
- partial fills and expiry;
- every reject reason;
- gaps and stale bars suppress signals;
- out-of-order, overlapping or malformed candles are refused with no state change;
- params bounds and hashing;
- market hours across NSE, NYSE (summer and winter time) and holidays.

**Determinism:** reversed input order gives the same `resultHash` and `dataHash`.

**Job:** enqueue → runOnce → completed → evidence → DRAFT → BACKTESTED. Failures are recorded as `failed` with a code and never silently retried:
- empty data;
- out-of-window data;
- a port that throws.

**Postgres:** the label/id CHECKs, the trigger (final rows frozen, provenance immutable) and revoked DELETE all hold. With 6 concurrent workers and 4 queued jobs, each job is claimed exactly once (`attempts = 1`), and identical inputs produce identical simulations.

**Isolation:** a static test forbids imports of brokers, credentials, execution, orders / positions / outbox, ledger, billing or settlement, pg / Redis / BullMQ, `fs` / `net` / `http`, `process.env` and `fetch`, plus `INSERT`s into real-book tables.

**Mutation checks** (each change temporarily applied, then reverted). Every one made the suite fail:
- paper ingests forming bars;
- paper ignores the watermark;
- paper skips dedupe;
- stale bars still signal;
- slippage rounds in the trader's favour;
- maker fee ignored (initially undetected, so the hand-computed limit test was added);
- latency ignored.

## Follow-ups (not in this stage)

- **An incremental evaluator in `strategies/`** for long minute-bar backtests (throughput above).
- **A real historical-data port:** the Stage 11 provider plus storage. It must be entitlement-checked (B-09).
- **Scheduling `runOnce`** (flag-gated) and a backtest API with ownership checks: today `enqueue` records the principal but trusts its caller (internal API only).
- **Paper runs** need a long-lived host process; nothing starts one today.
- **Possible model upgrades:** an exchange-holiday calendar source, a margin / funding model for shorts, and intrabar (lower-timeframe) fill modelling.

## Rollback

Revert the commit. On a local database, apply `024_backtests.down.sql`.
