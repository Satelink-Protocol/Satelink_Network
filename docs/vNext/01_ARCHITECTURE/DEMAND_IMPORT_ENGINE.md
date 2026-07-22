# Demand Import Engine

> How paying machines find and pay Satelink with zero human contact. "Import" means: the demand already exists and already pays somebody; Satelink makes itself reachable inside that flow.

## Mechanisms (in force order)

### 1. HTTP 402 challenge (the primary import path)
Any machine that hits a vNext resource without payment receives a self-contained x402 v2 challenge: price, network, payTo, facilitator. Agents with an x402 client complete it autonomously. [code: live today on `/rpc` via `x402Middleware` in `apps/api/app_factory.mjs:369`; mainnet settlements proven Jul 9–10]

### 2. Facilitator discovery (Bazaar)
Resources are listed in the CDP facilitator's discovery index automatically upon first settlement. [measured: Satelink IS indexed — verified via `discovery/resources?payTo=0x966E…7Ad4`]. Known platform defects and their consequences:
- `/discovery/search` returns 0 hits for all merchants platform-wide [measured 2026-07]. Consequence: do not build anything that depends on search ranking; list-crawlers still see us.
- Satelink currently lists **1 resource with a wildcard URL** (`/rpc/:var1`) vs. e.g. OneSource's 13 concrete resources [measured]. Consequence: vNext lists each resale resource at a **concrete URL** (`/x/<slug>`) with a method-level description (PR #257 pattern).

### 3. Machine-readable self-description
`.well-known` + OpenAPI surfaces already exist [code: `createWellKnownSatelinkRouter`, `createOpenApiRouter`, LangChain tool adapter at `/v1/tools` — `app_factory.mjs:391–398`]. vNext extends them to enumerate resale resources. These are import surfaces for agent frameworks that index tool manifests.

### 4. Existing free traffic as a discovery pool — with honesty
496k req/day of mostly-anonymous RPC traffic exists [measured 2026-07-16]. The legacy thesis was "convert it"; measured result: ~zero. vNext's only use of this pool: the 402 challenge on rate-limit (already live via `freeTierGateUnlessX402Paid`) is kept as a passive surface. **No further conversion features are built until the existing ones show a non-zero measured rate** (First Principle #7).

## What demand import explicitly is NOT

- No outreach, no email, no Discord campaigns (founder-rejected; `OutreachEngine` archived).
- No signup funnels, no dashboards in the money path.
- No paid marketing. If a demand source requires convincing, it fails scorecard Q5.

## Inventory: where paying machine demand verifiably exists today

| Source | Evidence | Status |
|---|---|---|
| x402 agents paying Bazaar merchants | Satelink's own inbound settlements (Jul 9–10, mainnet, external EOA) [measured] | LIVE but thin — Satelink measured 3 paid calls |
| x402 ecosystem aggregate volume | UNKNOWN — no public aggregate metric found; do not quote numbers | UNKNOWN |
| Agent-framework tool marketplaces (LangChain/MCP indexes) | Satelink tool manifest exists [code]; calls attributable to it: UNKNOWN | UNKNOWN |

The engine is measured by: **distinct non-founder payers per week** and **paid units per week**, both from the spread ledger (`is_test_data = false` rows only). Targets and review dates in `../04_EXECUTION/CHECKLIST.md`.
