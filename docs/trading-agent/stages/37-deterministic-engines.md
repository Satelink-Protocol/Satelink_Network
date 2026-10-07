# Stage 37 — Deterministic engines (Phase 6 item 4)

## Inspection (reuse before build)

| Existing | Where | Used how |
|---|---|---|
| fixed-point arithmetic (bigint 1e18, half-even) | `strategies/fixed.mjs` (Stage 13) | the only arithmetic the engines use |
| indicators SMA / EMA / RSI / ATR / highest / lowest | `strategies/indicators.mjs` (Stage 13) | **delegated unchanged**; a test proves bit-identity with the strategy evaluator |
| normalized candles / quotes, interval grid | `market_data/types.mjs` (Stage 11) | engine inputs |
| staleness policy (venue timestamp, future skew) | `market_data/staleness.mjs` (Stage 11) | data-confidence freshness |
| order book | — | **no normalizer existed**; the liquidity engine validates the book itself (sorted, non-empty, uncrossed) |

## What was built

`apps/api/src/trading_agent/engines/**` — features (adds VWAP, returns, volatility with an exact integer square root), regime (`regime/1.0`), liquidity / spread (`liquidity/1.0`), data confidence (`data-confidence/1.0`). All thresholds are decimal strings in frozen, versioned configs; each output carries its `configVersion`. Pure: no I/O, no clock, no randomness, no floats (a test enforces it).

## Test evidence (2026-10-07)

| Suite | Result |
|---|---|
| `apps/api/test/trading_engines.test.js` | **19 passing**: exact isqrt / sqrt; returns, volatility (zero-mean and constant-return cases), VWAP vs hand values; Stage 13 delegation **bit-identical** for 5 indicator types; determinism + warm-up nulls; regime trending up/down, ranging + low_vol, high_vol, abnormal (crash bar, 6% gap), uncertain (short history, low data confidence); liquidity spread / mid / depth / imbalance, book-walk average price and slippage, insufficient liquidity (unfillable, thin vs 5× notional), abnormal spread, empty / crossed / unsorted books rejected; data confidence 100 / stale 60 / one gap 86 / > 5% gaps or duplicates → completeness 0 / source disagreement; purity guard |
| Mutation checks (12) | all caught: isqrt without iteration, variance without the mean (survived at first → constant-return case added), VWAP on close, low confidence not uncertain, gap ignored, direction always up, spread flag dropped, depth multiple ignored, crossed book accepted, staleness ignored, duplicates ignored, source disagreement ignored |
| Postgres integration | **not applicable**: pure functions with no persistence; engine outputs are persisted with scorecard decisions (item 6) |

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-03 / B-06 / B-10 | no | no route, no migration, nothing mounted |
| B-09 (market-data terms) | no | engines compute over data already fetched by Stage 11 providers; no new data source or redistribution |
