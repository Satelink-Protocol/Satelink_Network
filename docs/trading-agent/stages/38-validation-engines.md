# Stage 38 — Validation engines: walk-forward + stress / Monte Carlo (Phase 6 item 5)

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| deterministic simulator + `runBacktest` (fees, slippage, partial fills, seeded rejects) | `backtest/engine.mjs`, `backtest/run.mjs` (Stage 14) | every validation run is a `runBacktest` call — no second simulator |
| HYPOTHETICAL disclaimer, sealing (`resultHash`) | `backtest/engine.mjs`, `strategies/canonical.mjs` | reused for every validation result |
| seeded PRNG (mulberry32) for venue rejects | `backtest/engine.mjs` (not exported) | same algorithm in `validation/common.mjs` for the bootstrap |
| trade records (`entryTime` as **epoch ms**) | `backtest/engine.mjs` | the OOS filter compares in ms (a string comparison bug was caught by the tests — see below) |

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_validation.test.js` | **14 passing**: 5 rolling windows with exact IS/OOS boundaries; OOS counts only trades entered in the window (checked against independent runs, trade times asserted numeric); anchored windows grow from bar 0; determinism; efficiency null when IS made no money; insufficient history refused; bootstrap seeded (distributions differ by seed), hand check (+10 × 3 → 1030 on every path), all-losing → P(loss) 100% and ruin; percentile order; NO_TRADES; exact gap application; fee / slippage shocks never improve P&L and scale costs; stress determinism and baseline hash; no bootstrap without trades |
| Mutation checks (11) | all caught, incl. **the real bug found while writing the tests** (OOS filter compared epoch-ms trade times to an ISO string → zero OOS trades) and a bootstrap that stops resampling (survived at first because the result echoes its seed → the test now compares distributions only) |
| Postgres integration | **not applicable**: pure computation over in-memory history; persisted with scorecard decisions (item 6) |

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-03 / B-06 / B-10 | no | no route, no migration, nothing mounted |
| B-09 (legal) | no | results are labelled hypothetical and are not shown to users by this stage |
