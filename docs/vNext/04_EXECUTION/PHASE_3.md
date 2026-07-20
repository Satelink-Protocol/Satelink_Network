# Phase 3 — Rail Independence and the Second Adapter

> Entry condition: T6 passed (a genuinely autonomous loop exists). Objective: remove the two remaining existential dependencies — single rail (x402/CDP) and single workload class — making the 10-year claim structural rather than aspirational.

## Objectives

1. **Second rail (B-14): `erc20-polygon`.**
   Inbound: USDT deposits to RevenueVaultV2 `0x577D…BaCEF` (live, permissionless [code: PR #234]) mapped to credits — mechanism already exists via `/credits` path. Outbound: plain ERC-20 transfer with confirmation watching (design in `SETTLEMENT_ENGINE.md`). Gas/ops note: outbound wallet needs POL for gas; legacy signer holds 1.41 POL [measured] but vNext uses its own dedicated wallet (Rule: never the legacy signer). RPC sending path: use a tx-capable endpoint (drpc read-only issue [measured, memory: revenue-vault-v2]).
   Exit: one full spread event settled entirely on rail #2 (Shadow first, then minimal live).
   This is the point at which "no dependency on x402 success" becomes a demonstrated fact.

2. **Second workload adapter (B-15).**
   Whichever `MARKET_REJECTION_LOG.md` trigger fires first. Watchlist, in expected-value order:
   - **AI inference** (unit prices 10²–10⁵× RPC; trigger: ≥5 inference merchants with concrete pricing on a crawlable machine-rail index).
   - **Search/SERP** (agent-native demand; floor-compatible pricing; trigger: search merchants on x402 index, resale-permissive).
   If no trigger has fired by Phase 3: **do not force one.** Deepen rail #2 and catalog quality instead, and record the non-firing as market data in the rejection log (dated). An Autonomous Revenue OS with one honest adapter beats one with three fictional ones — the legacy repo is the proof [audit: 48 workload files, ~$0].

3. **Legacy retirement decisions (founder-gated).**
   With rail #2 live, the epoch/anchor path's remaining purpose is nil; retirement (and any change to `SETTLEMENT_DRY_RUN`) is a founder decision with the Rule #3 checklist, never autonomous. H-2 zero-traffic mounts get flagged off. The legacy `/rpc` free surface stays as long as it feeds discovery (its cost is already sunk in infra).

4. **Structural review (only now).**
   With measured load and measured revenue, decide with evidence: does anything leave the monolith? Does the crawler need its own process? Is Postgres enough (almost certainly yes at any Phase-3 scale)? Each answer is an ADR citing ledger and load numbers.

## 10-year survivability checklist (the point of the whole reset)

| Property | Where it is guaranteed |
|---|---|
| Survives death of x402/CDP | rail adapters; rail #2 live (this phase) |
| Survives death of RPC demand | RPC is supplier row #1, deletable (ADR-002) |
| Survives founder attention gaps | T6 zero-touch discipline; caps; kill switches |
| Survives agent/human turnover | evidence-tagged docs; append-only ledgers; ADRs |
| Survives ecosystem shifts | 13-question gate + rejection log with triggers keeps the adapter roster honest |
| Survives its own success | additive-only migration path; structural review gated on measurement |

## Phase-3 exit = steady state

There is no Phase 4 document on purpose. After Phase 3 the system's rhythm is: crawler watches markets → triggers fire → scorecards run → adapters ship behind caps → ledger tells the truth. That rhythm, not any roadmap, is the operating system.
