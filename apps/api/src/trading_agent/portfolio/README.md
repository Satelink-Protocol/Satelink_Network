# trading_agent/portfolio

**Status:** Stage 18 portfolio, P&L and broker reconciliation. `STATUS = 'skeleton'` = not wired: no routes, and nothing schedules the consumer, snapshotter or reconciler.

**Responsibility:** what we hold and what it earned, derived only from venue fills, and always checked against the broker, which is authoritative. **It never writes the ledger** (the real book).

**Tables:**
- `fills` (021, append-only, `ledger_txn_id` stays NULL);
- `positions` (021 + 028);
- `portfolio_snapshots`, `reconciliation_events`, `portfolio_consumer_cursors` (028);
- emits to `trading_outbox` (aggregate `strategy`) and `audit_events`.

| Module | Purpose |
|---|---|
| `pnl.mjs` | `foldPosition` (average cost, realised P&L, fees, flips; order-independent, deduped) and `valuePosition` (unrealised P&L, gross / net exposure) |
| `ingest.mjs` | `FillConsumer`: OMS `order_events` → `listFills` → idempotent fill insert → position recomputed from all fills. Durable cursor that never skips a failed event |
| `snapshots.mjs` | `PortfolioSnapshotter`: hashed, append-only valuation. A stale or missing mark gives null, never a guess |
| `reconcile.mjs` | `PortfolioReconciler`: broker vs internal within tolerance. A persistent mismatch (or unreadable broker) auto-pauses the account |
| `service.mjs` | `PortfolioReadService`: tenant-scoped reads |
| `store.mjs` | `InMemoryPortfolioStore`, `PgPortfolioStore` |

**Ports:**
- `brokerPositions.snapshot({ brokerAccountId, mode })`: the Stage 10 adapter has no positions call yet; real adapters must provide one;
- `marks.mark(instrument)`: a Stage 11 quote mid with purpose `internal_use`;
- `accounts.get(id)`: the tenant check;
- `killSwitches`: Stage 15;
- an optional `strategyPauser`.
