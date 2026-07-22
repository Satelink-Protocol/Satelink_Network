# Adapter: Blockchain Indexing

- **Status:** REJECTED (2026-07-20)
- **Kind:** Workload adapter (candidate)

## Scorecard summary

| # | Answer |
|---|---|
| 1 | YES — dapp developers pay for indexed query access (The Graph-class) [protocol docs] |
| 4 | NO — participating as a gateway/indexer requires GRT stake and indexer operations; curation/delegation mechanics are the protocol's own economics, changed by participation |
| 13 | NO — stake capital and indexer ops exceed existing resources |
| **Verdict** | REJECT |

## Reopen trigger

A fixed-price, machine-settled query market for indexed chain data emerges with no staking requirement to participate as a broker (pure resale of listed query endpoints).

## Rationale note

Structurally identical to GPU/Storage: protocol-internal economics (staking, curation, rebates) occupy the seats Satelink would need, and entry requires capital this team doesn't have. The pattern across GPU/Storage/Indexing rejections is not coincidence — DePIN-style protocols tend to internalize the router seat by design, which is exactly why First Principle #2 (tax existing flows, don't create markets) steers vNext toward HTTP-native, machine-rail-settled ecosystems like x402 instead.
