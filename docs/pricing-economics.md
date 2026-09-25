# Pricing V2 — worst-case economics per plan

_Generated from `apps/api/config/plan_catalog.v2.json` version **2026-09-25.2** by `apps/api/scripts/pricing/economics_report.mjs`. Do not edit by hand — change the catalog and regenerate._

## Rule
A plan or pack is **purchasable only if its worst-case contribution per charge is ≥ $0** (`publicCatalog().purchasable`; checkout refuses otherwise). Worst case = the most expensive Dodo fee path (base + international + subscription surcharge + fixed fee) **and** the full allowance of the longest month consumed at the configured marginal cost per UU.

## Inputs
- Dodo fees: base 4% + $0.40 · international +1.5% · subscriptions +0.5% · India domestic cards/UPI 4% + $0.15 · refund $1.00 · dispute $30.00 (source: `docs/web/PRICING_MODEL.md`, `docs/pricing-v2/02_USAGE_UNIT_MODEL.md`).
- 1 UU = $0.001 list; a Trading Intelligence request = 10 UU.
- Marginal cost per UU: **$0** — docs/web/PRICING_MODEL.md — Trading Intelligence is served from cached derived snapshots; per-call marginal cost ≈ $0. Sensitivity (break-even cost per UU) is reported alongside.
- Longest month = 4.43 weeks of the weekly allowance.

## Per charge
| Item | Charge | Price | Worst fee | India UPI fee | UU / cycle | UU cost | **Worst contribution** | Break-even cost / UU | Refund loss | Dispute loss (lost) | Gate |
|---|---|---|---|---|---|---|---|---|---|---|---|
| free | free | $0.00 | $0.00 | $0.00 | 2,215 | $0.00 | **$0.00** | $0.000000 | $0.00 | $0.00 | pass |
| launch | intro cycle | $5.00 | $0.70 | $0.38 | 33,225 | $0.00 | **$4.30** | $0.000129 | −$6.00 | −$35.00 | pass |
| launch | renewal | $19.00 | $1.54 | $1.00 | 33,225 | $0.00 | **$17.46** | $0.000526 | −$20.00 | −$49.00 | pass |
| pro | monthly | $19.00 | $1.54 | $1.00 | 33,225 | $0.00 | **$17.46** | $0.000526 | −$20.00 | −$49.00 | pass |
| max | monthly | $79.00 | $5.14 | $3.70 | 132,900 | $0.00 | **$73.86** | $0.000556 | −$80.00 | −$109.00 | pass |
| pro_yearly | yearly | $190.00 | $11.80 | $8.70 | 397,500 | $0.00 | **$178.20** | $0.000448 | −$191.00 | −$220.00 | pass |
| max_yearly | yearly | $790.00 | $47.80 | $35.70 | 1,590,000 | $0.00 | **$742.20** | $0.000467 | −$791.00 | −$820.00 | pass |
| pack_10 | one-time | $10.00 | $0.95 | $0.55 | 10,000 | $0.00 | **$9.05** | $0.000905 | −$11.00 | −$40.00 | pass |
| pack_50 | one-time | $50.00 | $3.15 | $2.15 | 50,000 | $0.00 | **$46.85** | $0.000937 | −$51.00 | −$80.00 | pass |
| pack_200 | one-time | $200.00 | $11.40 | $8.15 | 200,000 | $0.00 | **$188.60** | $0.000943 | −$201.00 | −$230.00 | pass |

## Reading it
- **Every paid plan and pack passes** at the configured marginal cost. The binding risk is not steady state but **loss events**: a lost dispute costs the price **plus $30**, which on the $5 Launch intro erases ~8 intro payments (see `docs/pricing-v2/02_USAGE_UNIT_MODEL.md` §59). Mitigations there (UPI-first, velocity limits on $5 checkouts, email verification before the charge) are founder decisions.
- **Break-even cost / UU** is the marginal cost at which the worst case hits $0. If Trading Intelligence ever gains a real per-call cost above it, the gate flips that item to non-purchasable automatically.
- INR prices are `null` in the catalog until the founder sets round rupee amounts (Dodo localized pricing). No PPP discounts at launch.
- **Live mode stays off** — a founder decision after Dodo business verification.
