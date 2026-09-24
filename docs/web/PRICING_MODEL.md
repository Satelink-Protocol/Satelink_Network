# Pricing model — economics behind the plans

The numbers on `/pricing` come from `apps/web/src/lib/plans.ts` (the single source; no
figures are hardcoded in JSX). This file records the economics used to set them so the
founder can adjust with the reasoning intact. **Last updated: 2026-09-23.**

## Payment costs (Dodo Payments, Merchant of Record)
Dodo is the seller of record for card/UPI; it handles tax and remits net. Fee schedule
used for these prices:

| Item | Cost |
| --- | --- |
| Base card fee | 4% + $0.40 |
| International cards / APMs | +1.5% |
| Subscriptions | +0.5% |
| India domestic cards / UPI | 4% + $0.15 |
| Refund | $1 per refund (Satelink's cost — never charged to the customer) |
| Dispute | $30 per dispute |

The **fixed $0.40 base fee** is why the minimum pay-as-you-go pack is **≥ $10**: at $10 the
base fee is 4% of the pack, so total Dodo take stays < ~8.4% and the fee never dominates a
small top-up.

## Marginal & fixed cost
- **Trading-Intelligence marginal cost ≈ $0** — metrics are derived from cached public
  market data, so the per-call compute cost is negligible. Margin is governed by **payment
  fees + fixed infrastructure**, not per-call compute.
- **Fixed monthly infra assumption: `FIXED_MONTHLY_INFRA_USD = 80`** (Railway + Vercel Pro +
  Apple Developer $99/yr amortised + email + domain). Single editable constant in
  `lib/plans.ts` — the founder edits one number.
- **RPC margin** depends on the upstream provider's per-request cost. It is read from config
  `RPC_UPSTREAM_COST_PER_CALL`. **If unset, no new RPC discount tiers are shown** and the
  absence is logged (per §4.1) — we never invent an RPC margin.

## Plan structure (individuals)
| | Free | Pro | Max |
| --- | --- | --- | --- |
| Price | $0 | $19/mo · $190/yr | $79/mo · $790/yr |
| Included TI calls / mo | 300 | 2,500 | 12,000 |
| Effective per-call | — | ~$0.0076 | ~$0.0066 |
| Overage / call (from credits) | upgrade or top up | $0.008 | $0.007 |
| API keys | 1 | 5 | 20 |
| Rate limit | Low | Standard | High |
| Usage alerts & spend caps | — | ✓ | ✓ |
| Priority email support | — | — | ✓ |
| Pay-as-you-go packs | ✓ | ✓ | ✓ |

Yearly is ~17% off (2 months free): $190 vs $228, $790 vs $948.

### Margin check (Pro, monthly, India UPI)
Revenue $19; Dodo take on a subscription ≈ 4% + 0.5% + $0.15 ≈ $1.01 → net ≈ $17.99. With
TI marginal cost ≈ 0, the plan's contribution to the $80 fixed base is ~$18/subscriber/mo;
break-even is ~5 Pro subscribers (or a mix). Overage prices ($0.008 / $0.007) sit below the
$0.01 list rate as a plan benefit while staying well above marginal cost.

## Pay-as-you-go packs (no plan)
| Pack | Price | Bonus | Live today |
| --- | --- | --- | --- |
| Starter Pack | $9.99 | — | ✓ (the only live one) |
| $50 pack | $50 | +5% credit | P3.B |
| $200 pack | $200 | +10% credit | P3.B |

Bonus packs and the recurring plans are **not in the backend yet**. Until `PLANS_ENABLED` is
true in production, only Free + the $9.99 Starter Pack + x402 are purchasable; Pro/Max/bonus
packs render "Available soon — notify me". See `docs/web/DECISIONS.md` (P2/P3).

## Machines & agents (API) — rate card
| Product | Unit | Price | Rail |
| --- | --- | --- | --- |
| Funding-rate heatmap | call | $0.01 | credits or x402 |
| Open-interest shifts | call | $0.01 | credits or x402 |
| Market microstructure | call | $0.01 | credits or x402 |
| Liquidation clusters (model) | call | $0.01 | credits or x402 |
| Polygon RPC | call | $0.00003 | credits or x402 / USDT |

x402 stays list price (keyless, crypto-native, not billed through Dodo). Enterprise is shown
only as "Coming later — contact sales" — no price.

## The Dodo-bucket rule (§4.5, enforced in P3.B backend)
Dodo-funded value (plans, packs) is spendable **only on Trading-Intelligence endpoints** (the
"Dodo bucket"). RPC/x402 spend draws from crypto-funded credits only. The web today discloses
this via the two-rails diagram; the entitlement split is enforced in the Track B backend.
