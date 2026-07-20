# Paying-Ecosystem Scorecard

> The admission gate. An ecosystem becomes an adapter only if ALL thirteen questions answer YES with evidence. One NO → `MARKET_REJECTION_LOG.md`. Filled scorecards below reflect the 2026-07-20 audit; each answer is tagged `[code]`, `[measured]`, `[protocol]`, or UNKNOWN.

## The 13 questions

1. Who already pays? (named payer class, money verifiably moving)
2. Where does money originate? (source of funds, not circular token emissions)
3. Who determines price? (a mechanism Satelink can read, not negotiate)
4. Can Satelink join WITHOUT changing economics?
5. Can demand import itself? (machines find and pay us with zero contact)
6. Can supply import itself? (machine-readable listings, no recruitment)
7. Can routing become autonomous?
8. Can settlement become autonomous? (both directions)
9. Can Satelink collect spread automatically?
10. Can the ecosystem continue without Satelink? (we are optional → no platform risk to them, no obligation on us)
11. Does Satelink improve efficiency? (price, latency, availability, or discovery — measurable)
12. Can another adapter reuse this architecture?
13. Can engineering finish with existing resources? (this repo, one team, no capex)

## Scorecard: x402 machine-payment ecosystem (Base USDC via CDP facilitator) — **ADMITTED, with stated volume risk**

| # | Answer | Evidence |
|---|---|---|
| 1 | YES — autonomous agents/scripts paying HTTP merchants per request | [measured] Satelink received real mainnet USDC settlements from an external EOA, Jul 9–10 2026 |
| 2 | USDC balances funded by agent operators; exogenous to the protocol (no emissions) | [protocol] x402 v2 |
| 3 | Each merchant lists price in its 402 challenge / Bazaar listing; machine-readable | [protocol; code: our own listing] |
| 4 | YES — Satelink is an ordinary merchant downstream and an ordinary payer upstream; no economics change | [protocol] |
| 5 | YES mechanism (402 challenge + Bazaar listing; zero-signup) — proven by our own inbound settlements. Volume: thin | [measured: 3 paid calls total] |
| 6 | YES — facilitator discovery list is machine-readable and unauthenticated; suppliers list themselves | [protocol; verified via our own listing lookup] |
| 7 | YES — supplier selection over indexed listings; nothing requires human routing | [code: Routing Engine design] |
| 8 | YES both directions — inbound live [code], outbound clients exist (x402-kit, 4 mainnet txs [measured]); port required | gap is engineering, not mechanism |
| 9 | YES — resale spread: charge P via our 402, pay C via upstream's 402, per unit | mechanism complete once outbound built |
| 10 | YES — ecosystem runs fine without us | trivially true |
| 11 | YES, three measurable ways: single-endpoint aggregation over N merchants; failover across equivalent merchants; bundling below-floor micro-units ($0.001 CDP floor [measured]) | must be measured, see AUTONOMY_TESTS |
| 12 | YES — this scorecard *is* the generic adapter pattern; any x402 merchant class reuses it | by construction |
| 13 | YES — inbound exists [code]; outbound is a bounded port; crawler+router are small | CODE_AUDIT.md |
| **Verdict** | **ADMIT (Phase 1).** Known risk, stated plainly: measured demand volume for Satelink is 3 paid calls; ecosystem aggregate volume UNKNOWN. Admission is on mechanism-completeness — it is the only evaluated ecosystem where all 13 mechanisms exist today. The bet is bounded: Phase-1 spend caps ≤ $5/day. |

## Scorecard: traditional blockchain RPC (Infura/Alchemy-class) — **REJECTED as ecosystem; self-supply only**

| # | Answer |
|---|---|
| 1 | YES — dapp developers pay providers [protocol/public pricing] |
| 2 | Fiat/credit cards, developer budgets |
| 3 | Provider dashboards; human-negotiated at scale |
| 4 | NO for the paid tier — joining means signing up as a human customer of each provider and reselling against ToS in most cases; UNKNOWN/likely-prohibited resale terms |
| 5 | **NO — measured.** Demand acquisition is human signup; Satelink ran this play: 496k req/day free, 8 funnel PRs, ~zero conversion [measured 2026-07-11→16] |
| 8 | NO — settlement is credit-card/invoice, not machine-automatic |
| **Verdict** | **REJECT** (fails Q4, Q5, Q8). Survives ONLY as self-supply: Satelink's own RPC capacity sold through the x402 adapter (`../06_ADAPTERS/RPC.md`). This formally demotes RPC from product to supplier row #1 (ADR-002). |

## Other evaluated ecosystems

AI inference, GPU, storage, search, indexing, general compute, browser automation, video: all currently REJECT — full per-ecosystem scorecards with evidence and re-admission triggers live in their `../06_ADAPTERS/*.md` files; one-line reasons in `MARKET_REJECTION_LOG.md`. Every rejection defines the specific measurable trigger that reopens it (e.g., "≥ N inference merchants listed on Bazaar with concrete pricing").

## Scorecard hygiene

- A scorecard answer without a tag is invalid.
- Scorecards are re-run when a trigger fires or every 90 days, whichever first; answers dated.
- "It would be cool" is not a question on this card.
