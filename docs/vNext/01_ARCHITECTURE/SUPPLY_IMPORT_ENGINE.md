# Supply Import Engine

> How Satelink acquires sellable capacity without recruiting anyone. Suppliers must already exist, already list, already settle automatically — Satelink only indexes and buys.

## The lesson this engine encodes

The legacy approach was supply *recruitment*: node operator guides, onboarding engines, genesis-node programs, reputation-weighted reward pools [code: `apps/api/src/nodes/node_onboarding_engine.js`, `src/genesis-nodes/`, `economics/node_incentives.js`]. Measured result after ~18 months: **zero external suppliers** — the only registered node is Satelink's own heartbeat, excluded from routing by design [code: node_registry; memory: node-onboarding audit]. vNext inverts this: if a supplier must be convinced, the ecosystem fails scorecard Q6 and is rejected.

## Import sources (Phase 1)

### 1. CDP facilitator discovery list (Bazaar)
The facilitator's `discovery/resources` list is machine-readable and unauthenticated [protocol: CDP x402 API; verified in practice when checking Satelink's own listing]. A crawler ingests:
`resource URL, method, description, price (maxAmountRequired), payTo, network, lastUpdated`.
Each entry is a candidate supplier row. Known data-quality reality: listings include wildcard URLs, stale entries, and unpriced descriptions — the probe step (below) is what turns a listing into a routable supplier. Aggregate listing count today: UNKNOWN (fetch and record in Phase 1, `CHECKLIST.md` item S-1).

### 2. Self-supply registration
Satelink's own RPC gateway registers through the same interface as any external supplier: same probe, same scoring, same unit-cost accounting (cost = measured upstream Polygon node cost per call, not zero — honest internal transfer pricing, or the router will always pick self-supply and the architecture rots into "RPC platform with extra steps"). [code: `apps/api/src/workloads/rpc_gateway/`]

### 3. On-chain registries (Phase 3+)
Ecosystems with on-chain supplier registries (compute/storage markets) plug in here **only after** passing the 13-question gate. All currently evaluated ones were rejected — see `MARKET_REJECTION_LOG.md`.

## Pipeline

```
crawl (per source, scheduled)          → candidate rows
   ▼
normalize (URL, price, rail, schema)   → vnext_suppliers upsert
   ▼
probe (cheap/free health + honesty)    → latency, availability, schema-conformance
   ▼                                      price-honesty: does it actually settle at listed price?
score (Reputation Engine)              → routable? (score ≥ threshold)
   ▼
routable supplier set                  → consumed by Routing Engine per request
```

Probe budget: probes that require payment are capped at $0.001–$0.01/probe under the outbound caps (Rule #1); free probes (OPTIONS, malformed-payment 402 echo, schema fetch) preferred. A supplier with zero successful probes is never routed to, regardless of listed price.

## Reused legacy code

| Need | Source | Note |
|---|---|---|
| Crawl scheduling | `apps/api/src/scheduler/cron_scheduler` job pattern [code] | reuse job registration, drop legacy jobs |
| Circuit breaker | `apps/api/src/nodes/node_circuit_breaker.js` [code] | port logic to per-supplier breaker |
| Capacity/latency tracking | `nodes/node_capacity.js`, `region_engine.js` concepts | port measurements, drop region-token logic |

## Anti-goals

- No supplier accounts, contracts, or revenue-share negotiations (the 50/30/20 split model is legacy-only).
- No supply-side token incentives, ever.
- No scraping of listings that prohibit programmatic resale; exclusions logged in `MARKET_REJECTION_LOG.md` (Rule #13).

Engine health metric: **routable external suppliers** (probed-healthy in last 24h, external ≠ self-supply). Today: 0. First target: ≥1 (that is Milestone M1's precondition).
