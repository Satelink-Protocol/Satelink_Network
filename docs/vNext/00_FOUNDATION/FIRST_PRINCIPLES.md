# First Principles

> These are derived from measured reality of this repository and market, not from ambition. Each principle cites its evidence.

## 1. Revenue must be machine-initiated or it does not happen

18 months of building produced: 496,273 req/day [measured 2026-07-16, `/admin/observability/metrics`], 70,608 tracked IPs, 48,647 classified machine actors — and ~$0 real revenue [measured, war-room 2026-07-11: all prior revenue was founder test data]. Humans did not convert. The only real mainnet settlements ever received arrived **machine-initiated via x402** (Jul 9–10 settlements, proven via CDP Bazaar merchant lookup for payTo `0x966E…7Ad4`). Conclusion: build only flows a machine can complete end-to-end.

## 2. Do not create markets; tax existing flows

Creating demand (marketing, outreach, funnels) and creating supply (node-operator recruitment) both measurably failed here (zero external nodes [code: node_registry has only the self-heartbeat], ~zero paid conversion [measured]). Joining an existing flow of money and taking a spread requires no persuasion. The intermediary must be *invisible* to the ecosystem's economics — same price mechanics, same settlement rail, no new token, no new account type.

## 3. The spread is the product

Not the gateway, not the dashboard, not the network. A spread event = (inbound settlement) − (outbound settlement) > 0, recorded per unit of work. Everything that does not increase the count or size of spread events is overhead. Corollary: Satelink must be able to **pay** as well as **be paid**. Today the codebase can only be paid [code: `apps/api/src/payments/x402/` is merchant-side only; grep for client-side payment (`wrapFetchWithPayment`, `@x402/fetch`) returns zero hits in `apps/api` and `packages`]. Closing this gap is the first engineering task.

## 4. Rail-agnostic core, rail-specific adapters

vNext must survive the death of any single payment rail (success criterion: no dependency on x402 success). The abstraction already exists in embryo: `apps/api/src/settlement/adapters/ISettlementAdapter.js` with EVM/Polygon-USDT/Shadow/Simulated implementations [code]. The core engine speaks "quote / settle-in / settle-out / verify"; x402-on-Base is implementation #1, direct ERC-20 via RevenueVaultV2 on Polygon is implementation #2.

## 5. Self-supply is just another supplier

Satelink's own RPC gateway [code: `apps/api/src/workloads/rpc_gateway/`] is real, working capacity (p50 46ms at ~500k req/day [measured 2026-07-16]). In vNext it holds no privileged position: it is supplier row #1 in the supply index, competing on the same price/health/latency scoring as imported suppliers. This is what makes "no dependency on RPC success" true.

## 6. Every autonomous loop needs a hard financial guard

The repo's history proves the failure mode: fabricated dashboard numbers (11/13 admin pages hardcoded fake data, fixed PR #267), a `1,878 TX` fabrication incident (INC-013), and a settlement engine kept in `SETTLEMENT_DRY_RUN=1` because broadcasting was never safe. vNext inherits the discipline, not the shame: outbound payments have per-request, per-hour, and per-day caps; spread must be non-negative by construction (quote = cost + margin, floor-clamped); `is_test_data` flagging on every ledger row [code: enforced repo-wide since #268]; kill switch per adapter.

## 7. Measure before building more

Any proposed engine or adapter must state, in advance, the number that proves it works and the date it will be read. Claims without a measurement plan are rejected (see `../02_MARKET_VALIDATION/AUTONOMY_TESTS.md`).

## 8. Small surface, additive changes

The live money path runs through `apps/api/app_factory.mjs` (33 route mounts) [code]. vNext mounts new routers additively; it never refactors the legacy mounts as a precondition. Legacy code is demoted by disuse, not by rewrite. (See `../03_ENGINEERING/MIGRATION_PLAN.md`.)
