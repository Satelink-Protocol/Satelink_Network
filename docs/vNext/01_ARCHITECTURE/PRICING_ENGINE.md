# Pricing Engine

> Computes the downstream price P for every resource such that spread = P − C is positive by construction, competitive enough to be chosen by machines, and floor-legal on the rail.

## Price formula (Phase 1)

```
C        = min eligible supplier cost (listed price + rail fee), refreshed by crawler
P        = max( C × (1 + MARGIN_PCT),  C + MARGIN_ABS,  RAIL_FLOOR )
RAIL_FLOOR (x402/CDP) = $0.001         [measured 2026-07-09: facilitator rejects below]
MARGIN_PCT default    = 20%            [config; ADR required to change]
MARGIN_ABS default    = $0.0005
```

Quotes are cached per resource and re-derived when the supply index changes; a quote embedded in a 402 challenge is honored until its expiry even if C moved (the loss-routing invariant in `ROUTING_ENGINE.md` still holds because eligibility is checked at execution — worst case the spread compresses to ≥ 0, never below).

## Bundles

Per-unit machine payments have a floor ($0.001) that exceeds the per-unit cost of cheap workloads (an RPC call costs ~$0.00003 at legacy list price). The live solution is bundling: one settlement of $0.10 credits 1,000 calls [code: `apps/api/src/payments/x402/config.js`; live]. vNext keeps bundles as a pricing-engine output: `bundleSize = ceil(RAIL_FLOOR × SAFETY / unitPrice)`, credited through the existing idempotent credit path [code: `routes/credits.js`, `api_credits`].

## Competitive positioning — honest inputs

The legacy pricing-intelligence engine measured Satelink's RPC list price at **965% above market median**, with "zero-commitment" as the only defensible advantage [code+measured: `apps/api/src/economics/pricing_intelligence/`, PR #242]. vNext consequences:

1. For resale resources, price competitiveness is *inherited from C* — Satelink is at most MARGIN_PCT above the best listed supplier, by construction. This is structurally better positioning than legacy's invented price point.
2. For self-supplied RPC, the legacy $0.00003/call rate is kept only until the supply index has an external RPC-class supplier to benchmark against; then the same formula applies.
3. `market_intel.js` + `price_floor.js` are REUSED as the engine's market-scan input [code]. `trust_score.js`/`conversion_funnel.js` parts tied to the funnel thesis are archived.

## What pricing never does

- Never prices below cost (no loss-leader growth — that is "creating a market", violating First Principle #2).
- Never discriminates per payer (no negotiated deals; Rule #13 symmetry: we don't renegotiate up, we don't get renegotiated down).
- Never invents demand-curve models from unmeasured assumptions. Elasticity work requires ≥ 30 days of real paid-unit data first (First Principle #7). Current real paid-unit history: 3 calls [measured]. So: formula pricing only, for now.

## Open questions (UNKNOWN, tracked)

- Machine price-sensitivity on Bazaar: do agent clients pick the cheapest listing, the first listing, or the best-described listing? UNKNOWN — no public data; M1 instruments this by listing identical resources at two margins (A/B via two concrete resource slugs) and measuring pick-rate. (`CHECKLIST.md` item P-1.)
- CDP facilitator fee structure changes: current verify/settle is free at Satelink's volume; fee schedule at scale UNKNOWN — revisit before Phase 2 volume targets.
