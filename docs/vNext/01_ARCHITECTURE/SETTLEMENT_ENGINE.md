# Settlement Engine

> Moves real money in both directions with no humans. Inbound (be paid) exists and is mainnet-proven; outbound (pay suppliers) does not exist in this repo and is build item #1.

## Inbound (merchant role) — EXISTS

- x402 v2 flow via `@x402/express` + CDP facilitator: challenge → `X-PAYMENT` → verify → settle. [code: `apps/api/src/payments/x402/middleware.js` (407 lines), `settlement.js`; deps `@x402/core@2.17`, `@coinbase/x402@2.1`]
- Mainnet-proven: real USDC settlements on Base to payTo `0x966E1Ae22996545015b1414B35234b10719d7Ad4` from an external EOA, Jul 9–10 2026 [measured, Bazaar merchant lookup].
- Settled bundles credit `api_credits` through an idempotent deposit path with `is_test_data` auto-flagging [code: `routes/credits.js`; #268].
- vNext change: none to the mechanism; only new resources (`/x/<slug>`) are added behind the same middleware.

## Outbound (payer role) — DOES NOT EXIST YET

Verified gap: no client-side x402 payment code in `apps/api` or `packages` (grep `wrapFetchWithPayment` / `@x402/fetch` / `withPaymentInterceptor`: zero hits) [code audit 2026-07-20]. What exists elsewhere: the standalone `x402-kit` repo (same founder) contains a working v2 client flow with 4 mainnet tx hashes [measured, memory: x402-kit]. Build = port that client into a `RailAdapter.payOut` implementation.

Requirements (all Rule #1):
- Dedicated outbound hot wallet, funded manually, small (Phase 1: ≤ $25 USDC on Base). **Never** the treasury/payTo key; never the legacy signer `0x988f…` (reserved for Polygon settlement, currently 1.41 POL [measured]).
- Caps enforced in code before signing: per-payment (default $0.01), per-hour (default $0.50), per-day (default $5), wallet floor (default $5 remains untouched). All defaults conservative; raising = ADR.
- Kill switch `VNEXT_OUTBOUND_ENABLED` (default `false`).
- Idempotency: one outbound payment per (request id, supplier); retries reuse the settled payment, never double-pay.

## Rail adapters

| Rail | Inbound | Outbound | Status |
|---|---|---|---|
| `x402-base` (USDC, `eip155:8453`, CDP facilitator) | live [code] | to build (port x402-kit) | Rail #1, Phase 1 |
| `erc20-polygon` (USDT `0xc213…8e8F`, RevenueVaultV2 `0x577D…BaCEF`) | live for deposits [code: vault permissionless deposit, PR #234] | to design (plain ERC-20 transfer + confirmation watch) | Rail #2, Phase 3 — this is what makes "no dependency on x402" real |

Rail adapters implement the `RailAdapter` interface in `CORE_ENGINE.md`. The legacy `ISettlementAdapter` family [code: `settlement/adapters/`] is the design precedent; its Shadow/Simulated adapters (full path, no broadcast) are the required test double for every new rail.

## Relationship to the legacy settlement stack

The legacy stack (epoch aggregation → batch → anchor to RevenueVault, `SETTLEMENT_DRY_RUN=1` forever, never broadcast [measured]) solved a problem vNext does not have: aggregating sub-cent internal accruals into on-chain payouts to recruited node operators. vNext has no recruited operators; suppliers are paid per unit on their own rail at their own listed price. Therefore:
- Legacy path: left running untouched, dry-run, for the legacy surface. All existing guards stay (Rule #3).
- `settlement/{futures_escrow,job_escrow,rewards,withdraw_service,withdrawal_processor,batch_creator,claim_generator}.js`: ARCHIVE class — they model escrow/reward mechanics for the operator network that never materialized. Withdrawal API tests are already in the known-fail baseline [measured: 3 of the 9].
- `settlement/settlement_engine.js`, `user_settlement.js`: not reused; superseded by per-transaction rail settlement.

## The invariant that defines this engine

For every unit of work: **settle-in strictly before pay-out** (Satelink never extends credit to demand), and **pay-out strictly before execute** only where the upstream requires it (x402 does); otherwise execute-then-settle per rail semantics. Every settled pair lands in the spread ledger within the same request lifecycle — there is no end-of-day reconciliation step that can silently diverge.
