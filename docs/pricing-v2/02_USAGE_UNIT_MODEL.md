# A3 — Usage Unit conversion (verified) + §59 economic validation

**Status: audit/docs only.** This file specifies the model precisely enough to
become a versioned `PlanCatalog` constant later; it does not implement one.
Implementing it (code + pricing-parity tests) is Pricing V2 build work, gated
behind the merge chain (see `00_SEQUENCING_AND_GATE.md`).

## The conversion
**1 Usage Unit (UU) = $0.001 of Satelink list price**, derived from the
existing tariff:

| Native meter | List price | UU per unit |
|---|---|---|
| Trading Intelligence request | $0.01 | 10 UU |
| RPC request (crypto rail) | $0.00003 | 0.03 UU |
| x402 request | per product list price | same as product |
| AI tokens / compute / external providers | no product exists | **do not build; `COST_UNKNOWN`** |

## Plan allowances → monthly Trading-Intelligence requests (independently verified)

Formula: `monthly_requests = (weekly_UU / 10) × 4.3 weeks/month`. Recomputed
independently (not copied from the brief) — the founder's figures check out:

| Plan | Price | Session (5h) | Weekly | Monthly TI requests (computed) | List value/mo (computed) |
|---|---|---|---|---|---|
| Free | $0 | 100 UU = 10 req | 500 UU = 50 req | **215.0** (matches "~215" exactly) | **$2.15** (matches "~$2") |
| Launch | $5 first mo → $19 | 300 UU = 30 req | 1,500 UU = 150 req | **645.0** (brief said "~650" — within rounding) | **$6.45** (brief said "~$6.50" — within rounding) |
| Pro | $19/mo | 1,500 UU = 150 req | 7,500 UU = 750 req | **3,225.0** (brief said "~3,250") | **$32.25** (brief said "~$32") |
| Max | $79/mo | 5,000 UU = 500 req | 30,000 UU = 3,000 req | **12,900.0** (brief said "~13,000") | **$129.00** (brief said "~$130") |

No math errors found. The small discrepancies (645 vs 650, etc.) are exactly
what rounding `4.3 weeks/month` up in the brief's mental math would produce —
not an error, just informal rounding. **Recommendation:** when this becomes
code, compute `monthly_requests` from the formula above rather than
hand-rounded constants, so the pricing-parity test has one source of truth.

This keeps pay-per-call ($0.01) and plans in the same economy: Pro's effective
$0.0059/request ($19/3,225) and Max's $0.0061/request ($79/12,900) are a
**40–60% discount for committing monthly**, not the 17× discount that would
make per-call pricing worthless in comparison. Confirmed: the ratios hold.

## §59 economic validation (Dodo fees)

Dodo fee facts used (as given): 4% + $0.40 base; +1.5% international
cards/APMs; +0.5% subscriptions; India domestic cards/UPI 4% + $0.15; $1 per
refund; $30 per dispute.

### Steady-state net margin per successful payment (India UPI, domestic)
| Plan payment | Dodo fee | Net to Satelink |
|---|---|---|
| Launch $5 (first cycle) | $0.375 (4.5% + $0.15) | **$4.625** |
| Pro $19/mo | $1.005 | **$17.995** |
| Max $79/mo | $3.705 | **$75.295** |

### Worst case: one dispute, lost (original amount clawed back + $30 flat fee)
| Plan | Loss on that transaction | Successful payments' worth of margin needed to offset | Breakeven dispute rate (1 in N zeroes the cohort's aggregate margin) |
|---|---|---|---|
| **Launch $5** | **−$35.00** | **7.6 payments** | **1 in 7.6 ≈ 13.2%** |
| Pro $19 | −$49.00 | 2.7 payments | 1 in 2.7 ≈ 36.7% |
| Max $79 | −$109.00 | 1.4 payments | 1 in 1.4 ≈ 69.1% |

### Worst case: one refund ($1 flat fee + clawed-back amount)
| Plan | Loss | Payments' worth of margin to offset |
|---|---|---|
| Launch $5 | −$6.00 | 1.3 payments |
| Pro $19 | −$20.00 | 1.1 payments |
| Max $79 | −$80.00 | 1.06 payments |

## The finding: Launch's $5 intro price is structurally the most fragile point in the ladder
The $30 dispute fee is **flat regardless of transaction size** — so its
damage-to-revenue ratio is worst at the smallest price point. A single lost
dispute on a $5 Launch payment (**−$35**) erases the entire net margin of
**~7.6 other successful $5 payments**. The equivalent ratio at Pro is 2.7
payments, at Max only 1.4 — Launch is **~2.7× more exposed than Pro** and
**~5.4× more exposed than Max**, purely from the flat-fee asymmetry, before
even accounting for the fact that a $5 charge is exactly the profile most
prone to "I don't recognize this" friendly-fraud disputes and stolen-card
testing (fraudsters test small amounts first — $5 is an attractive test
amount, more so than $19 or $79).

**Is 13.2% a realistic dispute rate?** No — and that's the good news. Card
network dispute-monitoring programs (Visa/Mastercard) flag merchants around
0.65–1% dispute-to-transaction ratio as "excessive," and a healthy subscription
business targets well under 1%. At a realistic ~0.5–1% dispute rate, Launch
remains net-positive on average. **The real risk isn't the average rate — it's
concentration:** a single fraud ring running a burst of stolen-card tests
through the cheapest available price point could disproportionately hit
Launch specifically, and because the fee is flat, even a handful of concentrated
disputes cost far more than they would against Pro/Max. This is a tail-risk
problem, not an average-case problem — mitigations should target *concentration
detection*, not just the average rate.

## Mitigations (evaluated)
1. **UPI-first for Indian creator traffic** (founder's suggestion) — **sound.**
   UPI Autopay's mandate-based flow (bank-app confirmation, pre-debit
   notification) produces fewer "I don't recognize this" disputes than
   card-not-present charges, because the customer actively authorizes via
   their own banking app rather than just entering card digits once.
2. **Dodo fraud-prevention settings** — recommended, but **I could not confirm
   the exact dashboard toggles from Dodo's public docs** in this pass (see
   `03_DODO_CAPABILITY_VERIFICATION.md`). Founder should check Dodo's
   dashboard directly for velocity/risk-scoring controls before launch.
3. **Velocity limits on $5 checkouts per device/IP/card** (founder's
   suggestion) — **sound**, and directly targets the concentration risk
   identified above (a fraud ring hitting many $5 charges from overlapping
   infrastructure).
4. **Additional mitigations worth considering** (not in the original brief,
   flagged here for the founder to weigh):
   - Require **email verification before** the $5 charge completes, reducing
     disposable/burner-account signups.
   - Bot/fraud detection on the $5 checkout specifically (Vercel BotID is
     already available on this stack and is a natural fit if the checkout is
     served from Vercel).
   - Treat a bounded rate of Launch disputes as a **budgeted CAC (customer
     acquisition cost)**, not a surprise — i.e., decide up front how many
     disputed $5 signups per month is an acceptable marketing cost, and alert
     if the actual rate exceeds it, rather than trying to reach zero.

## Not resolved here (needs founder decision, not analysis)
Whether $5 is the right intro price given this asymmetry, or whether a
somewhat higher intro price (e.g. $7–9) would meaningfully improve the ratio
while keeping the "$5" marketing hook — that's a product/marketing call, not
something this audit can settle. The math above is what's needed to make that
call with real numbers.
