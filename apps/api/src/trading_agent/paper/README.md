# trading_agent/paper

**Status:** Stage 14. `STATUS = 'skeleton'` = not wired: nothing starts a paper run, and there's no route.

**Responsibility:** paper trading on a **simulated book**, using the *same* `SimulationEngine`, evaluator, fill model and params as a backtest. Results are labelled **`simulated`**.

`PaperRunner` only adapts a live feed into the ordered stream a backtest replays:
- ignores unclosed (forming) candles;
- drops duplicates from overlapping polls;
- releases a bar only when every instrument has reached it (watermark), in `(openTime, instrument)` order;
- marks a bar stale when its close is older than `staleAfterMs` by the injected clock (Stage 11 `computeStaleness`). A stale bar produces no signal.

`pump(marketData, principalId)` polls a Stage 11 `MarketDataProvider`-shaped port with `purpose: 'internal_use'`, so entitlements apply. A failed poll means no data and therefore no signal (fail closed).

`startPaperRun` / `stopPaperRun` persist the run in `backtests` (`mode='paper'`, id `ppr_…`, `label='simulated'`).

**It never places an order, touches a broker, or writes orders, fills, positions or the ledger.**
