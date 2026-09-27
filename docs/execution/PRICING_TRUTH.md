# PRICING_TRUTH

Status: **DRAFT (Wave 2 / C1)** · founder decisions D-1/D-2/D-4 recorded 2026-09-28. Built 2026-09-27 from the machine-readable catalog
`apps/api/config/plan_catalog.v2.json` (version `2026-09-25.2`), live production responses, and the founder
decisions in contract §1. Anything marked **FOUNDER** is a price or limit value the founder must confirm;
none of those values has been changed.

## 1. Rails — never conflated

| Rail | What it pays for | Asset / network | Balance it lands in | Status |
|---|---|---|---|---|
| USDT credits | RPC, Trading Intelligence | USDT on Polygon 137 → RevenueVaultV2 `0x577D…BaCEF` → DepositListener | `api_credits.credits_usdt` | LIVE |
| x402 | RPC bundle, Trading Intelligence per call | USDC on Base `eip155:8453`, payTo `0x966E…7Ad4` (founder EOA — FG treasury) | bundle → `api_credits` alias key `x402_<wallet>` | LIVE |
| Dodo (card / UPI, MoR) | **Trading Intelligence only** | Dodo Payments, TEST mode | legacy: `credits_usdt` ring-fenced by `dodo_funded_usdt` (PR #439); Pricing V2: `pv2_entitlements` / `pv2_pack_balances` | TEST |

Boundary (catalog `boundary`): "Dodo-funded value (plan allowance, packs) is spendable on Trading Intelligence
only. RPC / x402 stay on the crypto rail (USDT credits)." Enforced in code at the deduction since PR #439.

## 2. Unit prices

| Product | Unit | Price | Rail | Source | Status |
|---|---|---|---|---|---|
| RPC call (Polygon) | call | **$0.00003** | USDT credits | `/v1/pricing` `price_per_call_usdt`; `credit_service.mjs` `PRICE_PER_CALL_USDT` | LIVE |
| RPC bundle | 1,000 calls | **$0.10** (= $0.0001/call, 3.33× the credits price) | x402 USDC | `/.well-known/x402`, `/.well-known/satelink.json` | LIVE |
| Trading Intelligence request | request | **$0.01** = 10 UU | USDT credits · x402 · Dodo plan/pack UU | catalog `meters.intelligence_request`; `/.well-known/x402` "$0.01/call" | LIVE (x402/credits), TEST (Dodo) |
| Usage Unit | UU | $0.001 list value | Dodo plans/packs | catalog `unit` | TEST |

The two RPC prices are **different rail prices**, not the same product at two prices. Every surface must label
the rail next to the number (C4).

## 3. Plans (Dodo, TEST mode — Trading Intelligence allowance only)

| Plan | Price | Session UU (5 h window) | Weekly UU (week starts Monday) | Keys / machines | Source |
|---|---|---|---|---|---|
| Free | $0 | 100 | 500 | 1 / 1 | catalog |
| Launch | $5 first month (30-day intro), then $19/month | **1,500** | **7,500** | 5 / 5 | catalog (`entitlement_plan: pro`) — **founder D-1 (2026-09-28): Launch = Pro limits at the intro price; catalog wins** |
| Pro | $19/month · $190/year | 1,500 | 7,500 | 5 / 5 | catalog |
| Max | $79/month · $790/year | 5,000 | 30,000 | 20 / 20 | catalog |

Usage notices at 70 / 85 / 95 / 100 % (catalog `notify_thresholds_pct`).

## 4. Credit packs (Dodo, TEST mode — Trading Intelligence only)

| Pack | Price | Grant | Bonus | Source |
|---|---|---|---|---|
| pack_10 | $10 | 10,000 UU | none | catalog |
| pack_50 | $50 | 50,000 UU + **2,500 bonus** = 52,500 UU | **+5 %** (founder D-2) | catalog after bonus PR |
| pack_200 | $200 | 200,000 UU + **20,000 bonus** = 220,000 UU | **+10 %** (founder D-2) | catalog after bonus PR |

INR: every plan and pack carries `inr_price: null`; the display path exists (onboarding e2e "India: plans say
rupees, GST included" passes). Values are **FOUNDER** (C7).

## 5. Free tier — one truth (C3)

- **RPC: no free calls.** An anonymous `POST /rpc/polygon` returns **402** with x402 accepts
  (verified 2026-09-27; `FREE_TIER_DAILY_LIMIT=0`). `/v1/pricing` states "No free RPC — a 'free' account must
  deposit; every call is charged."
- The `free` **tier** on an API key (daily_limit 500) is a **rate cap on a funded key**, not free calls.
- The **Free plan** (Pricing V2) is a Trading Intelligence allowance of 100 UU per session / 500 UU per week.
- The V1 console plan table ("Free 300 calls/mo, Pro $19 2,500 calls + $0.008 overage, Max $79 12,000 +
  $0.007") is **obsolete**. It renders only with `CONSOLE_ACCOUNTS_V1` off; the V2 billing page renders from
  the catalog (e2e "Billing renders Pricing V2 from the PlanCatalog (no old plan table)" passes).

## 6. Where each surface gets its numbers today (Wave 2 target: all from the catalog)

| Surface | Reads catalog? | Notes |
|---|---|---|
| Console V2 billing / onboarding | yes (`/v2/plans`) | live only with `CONSOLE_ACCOUNTS_V1` on |
| Web `/pricing`, Home | yes (#433) | |
| `/v1/pricing` | **no** | legacy RPC object (tiers, per-call price); no plans/packs |
| `/.well-known/satelink.json` | **no** | hardcoded `$0.10 = 1,000` and per-call price |
| `/.well-known/x402` | **no** | hardcoded per-route prices |
| Docs | not audited yet | Wave 6 (F7) |

Next (C8): one CI test that fetches the catalog and asserts every row above renders the same numbers.

## 7. What is charged on the RPC rail (founder D-4, 2026-09-28)

| Outcome of the upstream call | HTTP to client | Charged? |
|---|---|---|
| Result (`result` present) | 200 | yes |
| Provider JSON-RPC error (revert, invalid params, method errors — `error` object in a 2xx body) | **200 with the JSON-RPC error body passed through** | **yes** |
| Transport failure (connect/reset/DNS), timeout | 502/504 | no |
| Provider HTTP 5xx | 502 | no |
