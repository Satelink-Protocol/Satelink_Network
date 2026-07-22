# Seat Analysis

> Every ecosystem has a fixed set of economic seats. Spread accrues to whoever occupies the seat between demand and supply *at the moment of routing*. This document identifies which seat Satelink takes, who already sits there, and why the seat is takeable.

## The seats in any machine-commerce ecosystem

| Seat | Function | Occupant in x402/Base ecosystem today |
|---|---|---|
| Demand | originates paid requests | agent operators (external; growing? UNKNOWN) |
| Price-setter | posts unit prices | each merchant, in its own 402 challenge [protocol] |
| **Router / aggregator** | chooses which supplier serves a request | **largely VACANT** — agents hardcode merchant URLs or pick from Bazaar listings manually/naively; no dominant meta-merchant found [survey 2026-07: no aggregator among indexed merchants; verification limited by broken platform-wide `/discovery/search` [measured], so coverage is partial — UNKNOWN beyond the CDP index] |
| Settlement | verifies + moves funds | CDP facilitator (Coinbase) [protocol] |
| Supply | performs work | listed merchants (e.g., OneSource with 13 resources [measured]) |
| Spread-taker | margin between P and C | today: nobody structural; facilitator takes protocol-level economics, not per-route spread |

**Satelink's seat: Router/aggregator + spread-taker.** It is the only vacant seat that (a) requires no permission, (b) requires no capex, (c) is defensible through accumulated supplier-quality data (the Reputation ledger) rather than through exclusivity.

## Why the seat is takeable by this team specifically

- The inbound half of the seat's tooling is already built and mainnet-proven [code: x402 merchant stack].
- The outbound half exists as a working prototype in x402-kit (4 mainnet txs) [measured].
- Operating cost of the seat ≈ existing Railway deployment (already running 496k req/day [measured]); marginal infra ≈ $0.

## Why the seat is currently worth little — and what changes that

Honest valuation: seat revenue = ecosystem paid-request volume × capture rate × margin. Measured inputs today: Satelink's own paid volume 3 calls; ecosystem volume UNKNOWN; capture rate 0. The seat is cheap precisely because it is early — the identical seat in adjacent, matured ecosystems (LLM API aggregation) became OpenRouter-shaped businesses. That analogy is directional, not evidence; no revenue projection is made here.

What changes the value (watch signals, quarterly review):
1. Bazaar listing count and activity trend (crawler measures this from Phase 1 — item S-1).
2. Higher-value workloads appearing as x402 merchants (inference > RPC by 3–5 orders of magnitude per-unit price).
3. Facilitator ecosystem expansion beyond CDP (more rails → rail adapter #3+).

## Seat risks

| Risk | Assessment |
|---|---|
| Coinbase/CDP builds the aggregator seat into the facilitator | Real. Mitigation: rail-agnostic core (ADR-001) — the seat exists per-rail; being the incumbent router with supplier-quality history is the only moat available. Probability: UNKNOWN. |
| Ecosystem never grows | Real; bounded loss: Phase-1 total exposure ≤ caps (≤ $5/day outbound) + already-sunk infra. This is why Phase 1 is small. |
| Upstream merchants forbid resale | Handled per-supplier: exclusion + rejection-log entry (Rule #13). x402 protocol itself imposes no resale restriction [protocol]. |
| Agents route around aggregators on principle (prefer direct) | UNKNOWN — measured by M1's A/B pick-rate instrumentation (P-1). |
