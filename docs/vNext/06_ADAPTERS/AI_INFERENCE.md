# Adapter: AI Inference

- **Status:** REJECTED (2026-07-20) — highest-priority watchlist item
- **Kind:** Workload adapter (candidate)

## Scorecard summary

| # | Answer |
|---|---|
| 1 | YES — developers/agents pay per-token/per-request [public pricing, industry-wide] |
| 4 | NO (dominant path) — prepaid fiat API keys per provider; joining as reseller either violates ToS or requires becoming a funded reseller account, changing economics |
| 5 | NO (dominant path) — signup-based |
| 8 | NO (dominant path) — no machine settlement on the dominant rail |
| **Verdict** | REJECT under current dominant distribution. Repo has a dormant seed (`apps/api/src/workloads/ai_gateway/` [code]) — do not extend until reopened. |

## Why this is the top watchlist item, not a dead end

Per-unit prices for inference are 10²–10⁵× RPC ($0.001–$0.06/1K tokens vs $0.00003/call). If even a handful of inference providers become x402-settled machine-payable merchants, the same Phase-1 architecture (crawler → probe → quote → route → settle → ledger) applies unchanged — this would be a Phase-3 `B-15` pickup, not a redesign.

## Reopen trigger (concrete, watched by the crawler from Phase 1)

≥ 5 inference providers listed as machine-payable (x402 or equivalent machine-settled rail) merchants with concrete per-token or per-request pricing on a crawlable index.

## What NOT to build until the trigger fires

No inference-specific pricing model, no model routing/arbitrage logic, no `ai_gateway/` feature work. The existing `ai_gateway/` code is ARCHIVE-class per `../03_ENGINEERING/KEEP_REMOVE_ARCHIVE.md` and stays untouched.
