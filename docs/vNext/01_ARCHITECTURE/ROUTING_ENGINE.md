# Routing Engine

> One function: for one unit of work, pick the supplier that maximizes expected spread subject to quality constraints. No manual routing, no per-customer rules, no privileged self-supply.

## Decision function (Phase 1 — deliberately simple)

```
eligible = suppliers where
    adapter == request.adapter
 && score >= ROUTE_MIN_SCORE          (Reputation Engine)
 && circuitBreaker.closed
 && listedPrice + railFee <= quotedCost   (never route at a loss — hard invariant)

choose  = argmax over eligible of:
    expectedSpread = quotedPrice − (listedPrice + railFee)
    tie-break: score desc, then p50 latency asc
```

Phase 1 is a static scorer over a small index (expected: single-digit suppliers). Learned/statistical routing (bandit-style exploration) is a Phase 2+ item and only after ≥1,000 real routed units exist to learn from — building it earlier is theater.

## Invariants

1. **Loss-routing is impossible**, not discouraged: the eligibility filter excludes any supplier whose cost exceeds the already-quoted price. If the set is empty → 502, no charge (Rule #14).
2. **Self-supply competes honestly.** Internal cost is the measured cost per call (compute + upstream node egress), set in config with an ADR when changed — not zero. See `SUPPLY_IMPORT_ENGINE.md`.
3. **Exploration is bounded.** A new supplier gets at most `ROUTE_EXPLORE_PCT` (default 5%) of traffic until it has 100 scored outcomes.
4. **Every routing decision is recorded** (request id → supplier, eligible-set snapshot hash, reason) in `vnext_route_log`. Autonomy without an audit trail is how the fabricated-dashboard era happened; not again.

## Failure handling

- Upstream execute fails after outbound payment settled: retry same supplier once; then failover to next eligible supplier **only if a second outbound payment keeps total cost ≤ quoted price** (spread may go to zero, never negative); else refund/no-charge per rail semantics and record a loss-avoided event.
- Upstream fails before outbound payment: plain failover, free.
- All suppliers open-circuit: adapter auto-PAUSES (lifecycle in `ADAPTER_SYSTEM.md`), resource delisted from discovery until a probe passes.

## Legacy verdicts

| Legacy code | Verdict |
|---|---|
| `apps/api/src/nodes/node_aware_router.js` | ARCHIVE — routes over the (empty) internal node network; concept superseded |
| `apps/api/src/scheduler/job_matching_engine.js`, `market_scanner.js`, `demand_flywheel_engine.js`, `workload_acquisition_engine.js` | ARCHIVE — aspirational matching over markets that were never connected; no live consumers in the money path |
| `apps/api/src/marketplace/settlement_router.js` | ARCHIVE — single-file experiment |
| `apps/api/src/nodes/node_circuit_breaker.js` | PORT — breaker logic is sound |
| `apps/api/src/workloads/registry.js` normalizer concepts | REVIEW in Phase 2 — may inform adapter request normalization |

## Scheduling note

Legacy "scheduler" meant cron jobs; vNext "scheduling" means per-request supplier selection plus (Phase 2) batching of retryable low-urgency work. The cron infrastructure itself [code: `scheduler/cron_scheduler`] is kept as the host for crawl/probe jobs.
