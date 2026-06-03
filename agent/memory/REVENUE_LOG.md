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
