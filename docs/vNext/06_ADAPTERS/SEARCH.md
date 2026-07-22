# Adapter: Search / SERP

- **Status:** REJECTED (2026-07-20) — second-priority watchlist item
- **Kind:** Workload adapter (candidate)

## Scorecard summary

| # | Answer |
|---|---|
| 1 | YES — agents and developers pay per-query SERP/search APIs [public pricing] |
| 3 | YES — per-query pricing, published |
| 8 | NO (dominant path) — fiat API keys, not machine-settled |
| **Verdict** | REJECT under current dominant distribution, likely earliest reopen after AI inference |

## Why this is a near-term watchlist item

Search is agent-demanded almost by definition (an autonomous agent needs live information constantly), per-query priced in a range compatible with the CDP floor ($0.001–$0.01/query, well above the $0.001 floor unlike raw RPC calls), and structurally simple to resell (stateless request/response, easy to probe and score for correctness).

## Reopen trigger

Search/SERP merchants appear on a crawlable machine-settled index (x402 or equivalent) with resale-permissive terms.

## What NOT to build until the trigger fires

No search-specific normalization, no query-result caching layer, no ranking logic. This file exists to be re-read the moment the crawler (B-4, running from Phase 1) surfaces a qualifying listing — the crawler is workload-agnostic by design (`SUPPLY_IMPORT_ENGINE.md`), so it will notice without any search-specific code running yet.
