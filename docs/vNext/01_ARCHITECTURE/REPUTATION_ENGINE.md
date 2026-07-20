# Reputation Engine

> Supplier quality scoring that exists to protect spread, not to gamify a network. Scores are Satelink-internal, non-transferable, and carry no token weight.

## What it scores and why

Satelink resells other people's capacity; a bad supplier burns Satelink's money (outbound paid, work failed) and Satelink's standing with demand (delivered garbage). The Reputation Engine is therefore an *underwriting* function: it answers "how much of our money and reputation do we risk per unit on this supplier?"

## Score inputs (Phase 1)

```
per supplier, rolling windows (1h / 24h / 7d):
  probe_success_rate          from Supply Import probes (cheap/free)
  live_success_rate           from routed real traffic outcomes
  p50 / p95 latency           probes + live
  price_honesty               settled amount == listed amount (bool rate)
  schema_conformance          responses parse per adapter schema
  payment_acceptance          outbound payments accepted first try

score ∈ [0,100] = weighted blend, config-defined weights,
new supplier starts at provisional 50 with exploration cap (ROUTING_ENGINE.md #3)
```

Circuit breaker sits below the score: consecutive-failure trip → OPEN (no routing) → half-open probe → close. Ported from `apps/api/src/nodes/node_circuit_breaker.js` [code].

## Legacy verdicts

| Legacy | Verdict | Reason |
|---|---|---|
| `nodes/node_circuit_breaker.js` | PORT | sound, rail-agnostic logic |
| `nodes/node_reputation.js`, `nodes/reputation_engine.js` | CONCEPTS ONLY | written for recruited operators with stake/reward mechanics; scoring windows reusable, incentive coupling is not |
| `economics/pricing_intelligence/trust_score.js` | REVIEW Phase 2 | demand-side trust concept; may inform payer-risk if abuse appears |
| `security/` classifier stack (machine/developer/scanner) [code: 21 files; live, 70k IPs classified] | KEEP (legacy surface) | demand-side abuse defense for the free tier; vNext's paid path needs less of it (payment is the sybil filter) but the classifier keeps protecting shared infrastructure |

## Deliberate non-goals

- No public reputation, no leaderboards, no badges. (Marketing surfaces invite Goodharting; scores are routing inputs.)
- No payer-side reputation in Phase 1: settlement-before-service means demand cannot owe us money. Revisit only if refund abuse appears in measured data.
- No cross-adapter score transfer: an actor's RPC-supplier score says nothing about their inference endpoint. Scores key on (supplier endpoint, adapter).

## Failure honesty

A supplier's score and breaker state are recorded in every route-log row, so any spread event (or loss-avoided event) can be audited back to "what did we know when we routed there." This closes the loop with `SPREAD_ENGINE.md`: money outcomes and quality knowledge are join-able forever.
