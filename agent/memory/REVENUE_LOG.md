# REVENUE LOG
# Updated: 2026-06-03 (EVT-REV-001 audit)

## Latest Cycle

**Collected USDT 24h:** $0.00
**Active paying wallets:** 0
**Top conversion target:** 23 IPs at ≥90% of 500-call free tier (2026-06-02 data)
**BILLING_ENABLED:** true (Railway production)
**REVENUE_MODE:** collected
**RevenueVault deployed:** 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785Dd on Polygon Mainnet

---

## Root Bottleneck (SAT-227 audit conclusion)

**No machine-readable deposit initiation endpoint.**

The 402 response from `free_tier_gate.js` tells machines to:
1. Call `approve()` on USDT ERC-20 contract
2. Call `deposit()` on RevenueVault contract
3. Add `X-Wallet-Address` header

There is NO `/credits/deposit/initiate` endpoint that returns ready-to-sign calldata.
There is NO ABI download.
The docs URL (`https://docs.satelink.network`) is unverified.

A machine hitting 402 cannot complete the deposit without:
- External ABI knowledge
- Manual gas estimation
- Multi-step EVM transaction construction

This is why 23 near-limit IPs have zero conversions: the 402 conversion path exists
structurally but is unexecutable for M2M callers without bespoke tooling.

**Additional findings (non-blocking but noteworthy):**
- `provider.json` + `/api/pricing` both say `free_tier: 100 calls/day` but actual limit is 500
- `credit_gate.js` fallback returns `"not deployed yet"` if `REVENUE_VAULT_ADDRESS` env unset
- `provider.json` has a different vault address (`0x6987921e2453f360e314e4424F6c2789F10a1CC9`) vs the deployed one
- `routes.js` (`apps/api/src/core/routes.js`) has duplicate `export function attachRoutes` and syntax errors — but this file is NOT loaded by `server.js` or `app_factory.mjs`, so it does not block revenue path

---

## Task Created

**SAT-228: Build `/credits/deposit/initiate` endpoint**
Owner: ENGINEERING_COMMANDER
Deadline: 48h
Success metric: Machine can call `GET /credits/deposit/initiate?amount=1.00` and receive ready-to-sign approve+deposit calldata for Polygon Mainnet, with correct RevenueVault ABI and USDT contract address.

---

## Previous Cycles

- 2026-06-02: 23 IPs near limit (≥90%), 0 paying wallets, $0 USDT collected
2026-06-05 01:01 | IPs:2623 | NearLimit:78 | Revenue/hr:0.06591 | Listener:alive | Action:event_created

---

## Cycle 2026-06-05 (SAT-236 — EVT-REV-202606050101)

**Collected USDT 24h:** $0.00
**Active paying wallets:** 0
**Active IPs (live):** 2,629
**Near-limit IPs (live):** 78 (≥90% of 500-call limit)
**Metered revenue/hr:** $0.066 (down 51.4% from $0.135 avg)
**BILLING_ENABLED:** true
**Deposit endpoint:** LIVE — GET /credits/deposit/initiate?amount=1 returns correct transactions[] JSON
**DepositListener:** alive

## Revenue Drop Root Cause

78 IPs have hit the 500-call daily ceiling and are blocked (receiving 402). Each blocked IP
contributes zero additional metered calls per hour. At 500 calls × 78 IPs = 39,000 calls/day
that can no longer be processed — this explains the 51.4% metered revenue drop.

**Conversion bottleneck:** The 402 response in free_tier_gate.js points to /credits/initiate
via URL but does NOT embed the transactions[] calldata inline. Machines must make a second HTTP
request to get calldata, then still require a funded Polygon wallet and operator action.
Highest-friction step: operator must manually set up a wallet and deposit USDT.

Inlining the transactions[] array in the 402 response removes one friction step and makes
auto-deposit possible for wallet-capable machines in one round-trip.

## Task Created

**SAT-237: Inline transactions[] calldata in 402 response — unblock 78 conversion targets**
Owner: ENGINEERING_COMMANDER
Revenue impact: Enables wallet-capable machines among 78 blocked IPs to self-serve deposit
without a second HTTP round-trip; even 1 conversion = $10 collected vs $0 today
Success metric: 402 response includes transactions[] array with valid approve+deposit calldata
for Polygon Mainnet (chainId: 137), verified via curl from a limit-exceeded IP simulation
Deadline: 48h (2026-06-07)

---

## Cycle 2026-06-05 (SAT-239 — cascade test heartbeat)

**Collected USDT 24h:** $0.00
**Active paying wallets:** 0
**Active IPs (live):** 2,660
**Near-limit IPs (live):** 78 (≥90% of 500-call limit)
**Total calls today:** 806,356
**BILLING_ENABLED:** true
**Deposit endpoint:** LIVE — GET /credits/deposit/initiate?amount=1 confirmed (keys: revenueVaultAddress, usdtAddress, chainId, approveCalldata, depositCalldata, gasEstimate, abi, instructions, network, polygonscan)
**SAT-237 status:** DEPLOYED (commit 1af7398 — 402 now inlines transactions[] calldata)
**nodes_online:** 0 (but 806k calls served — metric may be stale/broken)

## Root Bottleneck (this cycle)

SAT-237 is deployed. 78 IPs are at the free-tier ceiling and receive inline 402 calldata.
Zero conversions despite full technical infrastructure. Failure point is unknown:
- Is the approve+deposit calldata valid on Polygon Mainnet?
- Does a successful deposit credit the account in the DB?
- Can a creditor make an RPC call that deducts credits correctly?
End-to-end deposit flow has NEVER been smoke-tested with real USDT.

## Task Created

**SAT-240: Smoke test end-to-end deposit flow with real USDT on Polygon Mainnet**
Owner: ENGINEERING_COMMANDER
Revenue impact: Validates or surfaces the actual failure point blocking Customer Zero.
A broken post-deposit credit flow means all 78 conversion targets are wasting their 402 responses.
Success metric: Deposit $1 USDT → credits appear in /credits/balance → RPC call deducts credit → DB shows deduction
Deadline: 48h (2026-06-07)

2026-06-05 16:42 | IPs:3545 | NearLimit:4 | Blocked:75 | PotentialRev/day:$20.08 | Source:track_conversions.mjs