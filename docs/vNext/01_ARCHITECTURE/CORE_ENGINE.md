# Core Engine

> The rail-agnostic, workload-agnostic kernel. Everything here must make sense with the words "RPC" and "x402" deleted from the vocabulary.

## Responsibilities

The core owns exactly five nouns and their lifecycles:

| Noun | Definition | Persisted in |
|---|---|---|
| **Resource** | A unit of sellable capability Satelink offers downstream (URL + schema + price policy) | `vnext_resources` |
| **Supplier** | An upstream endpoint that already sells that capability with automatic settlement | `vnext_suppliers` |
| **Quote** | A priced offer for one unit of work: cost C, price P, expiry | in-memory + `vnext_quotes` (audit) |
| **SettlementPair** | (inbound settlement, outbound settlement) for one executed unit | `vnext_spread_ledger` |
| **Score** | A supplier's rolling quality measure | `vnext_supplier_scores` |

New Postgres tables, additive (Non-Negotiable Rule #7). The legacy 32 tables are untouched.

## Interfaces (normative)

```js
// Workload adapter — one per capability class (06_ADAPTERS/*)
interface WorkloadAdapter {
  key();                          // 'rpc' | 'ai-inference' | ...
  discoverSuppliers();            // → Supplier[] from existing listings ONLY
  probe(supplier);                // health/latency/correctness probe (cheap or free)
  execute(supplier, request);     // perform one unit of work upstream
  unitCost(supplier, request);    // C for this unit, from supplier's own listed price
  describeResource();             // downstream-facing resource description (discovery)
}

// Rail adapter — one per settlement mechanism
interface RailAdapter {
  key();                          // 'x402-base' | 'erc20-polygon' | ...
  challenge(price, resource);     // produce payment-required response (inbound)
  verifyAndSettleIn(payment);     // → {txRef, amount, payer}
  payOut(supplier, amount);       // outbound payment → {txRef}   [CAPPED — Rule #1]
  verifyOut(txRef);               // confirm outbound settled
}
```

Precedent in-repo: `apps/api/src/settlement/adapters/ISettlementAdapter.js` and `BaseSettlementAdapter.js` [code] already define a settlement-adapter contract with EVM, Polygon-USDT, Shadow, and Simulated implementations. The `RailAdapter` interface is its vNext successor; the Shadow/Simulated pattern (execute the full path, skip only the broadcast) is retained for testing — it is the one genuinely good idea in the legacy settlement stack.

## What the core reuses from legacy (with evidence)

| Core need | Legacy source | Verdict |
|---|---|---|
| Inbound x402 merchant flow | `apps/api/src/payments/x402/{config,middleware,settlement}.js` — live, mainnet-proven | REUSE as first RailAdapter inbound half |
| Credit ledger + idempotent deposits | `apps/api/src/routes/credits.js`, `api_credits` table | REUSE for prepaid bundles |
| Price floors & advisory pricing | `apps/api/src/economics/pricing_intelligence/` (price_floor, market_intel) | REUSE inside Pricing Engine |
| Circuit breaking / health probing | `apps/api/src/nodes/node_circuit_breaker.js`, `heartbeat.js` concepts | PORT (concepts, not token economics) into Reputation Engine |
| Settlement adapter pattern | `apps/api/src/settlement/adapters/` | PORT interface; drop escrow/futures/rewards files |
| RPC execution | `apps/api/src/workloads/rpc_gateway/` | WRAP as WorkloadAdapter `rpc` supplier #1 |

## What the core explicitly does NOT contain

- No accounts, tiers, or API-key management in the money path (keys remain a legacy convenience surface).
- No token, no staking, no node rewards (`node_incentives.js`, `rewards.js`, `growth_engine.js` → archive).
- No epoch batching in the vNext path. The legacy epoch scheduler (`economics/epoch_scheduler.js`, dry-run since inception [measured: never broadcast]) stays running for the legacy path but vNext settles per-transaction on the rail's native cadence.
- No forecasting/oracle theater: `revenue_forecast_engine.js`, `revenue_oracle.js`, `authenticity_service.js` → archive (aspirational, no consumers in the money path).

## Runtime placement

Core lives at `apps/api/src/vnext/` (new directory), mounted additively in `app_factory.mjs` under `/x/` (resale surface) and `/vnext/admin/` (read-only observability, behind existing `requireAdminAuth`). Rationale: same process = reuses live deploy pipeline, logging, and DB pool; zero new infrastructure to operate [code: Railway auto-deploy from `main` is the only deploy mechanism].
