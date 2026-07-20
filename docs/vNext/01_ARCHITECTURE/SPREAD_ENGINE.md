# Spread Engine

> The P&L of the system, computed per unit of work, verifiable on-chain, never fabricated. If the Spread Engine reads zero, Satelink earns zero — no other number in the system is allowed to claim otherwise.

## The ledger

One append-only table, `vnext_spread_ledger`:

```
id, ts, adapter, resource_slug, supplier_id,
rail_in,  amount_in,  tx_in,      payer_addr,
rail_out, amount_out, tx_out,
spread   = amount_in − amount_out,      -- CHECK (spread >= 0) at write time
route_log_id, is_test_data
```

Rules:
- **Append-only.** No UPDATE/DELETE path in application code. Corrections are compensating rows with a reference. (This is the structural answer to the repo's history of retroactively-discovered fake revenue [measured: war-room 2026-07-11; wiped `revenue_events_v2` incident].)
- **On-chain verifiable.** `tx_in`/`tx_out` are real chain references; any reported total must be reproducible by summing verified transactions. A weekly job re-verifies a sample against chain data and alarms on mismatch.
- **`is_test_data` discipline** inherited from #268; founder wallets auto-flagged [code: `payments/founder_wallets.js`]. Every reported metric filters `is_test_data = false`.
- **Bundles decompose**: a $0.10/1,000-call bundle settlement writes one inbound row at settlement and amortizes outbound rows as units execute; unexecuted remainder is visible as float, reported separately, never claimed as spread.

## Metrics this engine emits (the only revenue numbers vNext recognizes)

| Metric | Definition |
|---|---|
| `spread_total_usd_7d / 30d` | Σ spread, real rows only |
| `spread_events_7d` | count of rows with spread > 0 |
| `distinct_payers_7d` | distinct non-founder `payer_addr` |
| `recurrence` | payers seen in ≥ 2 distinct weeks — the "recurring" in autonomous recurring revenue |
| `float_outstanding` | bundle value settled-in but not yet executed-out |
| `loss_avoided_events` | routing refusals that prevented negative spread |

Exposed read-only at `/vnext/admin/spread` behind existing admin auth, and wired into the (now-truthful, post-#267) admin dashboard. EmptyState when zero — zeros are displayed as zeros [code: Fable5 UI rules, PR #214].

## What replaces the legacy revenue stack

`economics/revenue_oracle.js`, `revenue_forecast_engine.js`, `revenue_stability_service.js`, `economic_ledger.js`, `profitability_engine.js`, `breakeven_service.js`, `growth_engine.js` — ARCHIVE class. They compute derived narratives over revenue that measured ~$0; several fed the fabricated dashboard era. The Spread Engine's design stance: **one table, raw sums, chain-verifiable, no derived storytelling in the money path.** Forecasting can return someday as a report *reading* the ledger, never as an engine other code depends on.

Also superseded: the 50/30/20 waterfall (operators/platform/distribution) [code: `sql/layer70_economics_waterfall.sql`]. vNext has exactly two economic legs per unit: cost (to supplier) and spread (to treasury). Revenue-sharing returns only if a future adapter's ecosystem demands it, via ADR.
