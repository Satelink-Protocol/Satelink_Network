# Investment Committee Verdict — Phase 0.3

> **Committee mandate:** allocate (or refuse to allocate) $10M. Protect capital. We do not work for Satelink. If the architecture cannot produce autonomous recurring revenue under the stated constraints, we reject it. If a better architecture exists, we fund that instead. Inputs: the Phase 0.1 canonical architecture and the Phase 0.2 census/kill documents (read, not rewritten).
>
> Evidence tags: `[public YYYY-MM]`, `[measured]`, `[repo]`, `[protocol]`, `UNKNOWN`.

## 1. Does an architecture satisfying ALL primary criteria exist? — No.

The primary question requires **all** of: existing recurring money + existing supply + existing demand **today** + machine settlement + Satelink imports/routes/settles/collects + **no sales, no contracts, no convincing, no speculative growth, revenue begins immediately after integration.**

Phase 0.2 proved this set is **empty at market equilibrium** (Enclosure Theorem): meters with real recurring volume are enclosed by incumbents (OpenAI ACP 4% gatekeeper; Visa/Mastercard networks + Visa's own Agent Score reputation seat; OpenRouter network effect; solver capital moats) [public 2026]; the only permissionless, zero-cost-entry meter (x402) has **no real demand yet** (<$100k/day real, ~half wash-traded) [public 2026]. The two conditions cannot co-occur. **Therefore no BUILD-qualifying candidate exists.** An IC does not deploy $10M into a market that is empty today.

## 2. The 12 questions, applied to the single least-bad candidate

Candidate = permissionless Seat-B router/aggregator on x402-class rails (the only one that even passes the constraint filter). Underwrite:

| # | Question | Answer |
|---|---|---|
| 1 | Where is recurring revenue created? | at the machine-payment settlement event (HTTP 402 / agent payment) [protocol] |
| 2 | Who owns that meter today? | **permissionless** — which is exactly why it is enterable, and exactly why it carries no real volume |
| 3 | Can Satelink legally participate? | YES [protocol] |
| 4 | Can Satelink technically participate? | YES — inbound settlement is live and mainnet-proven [repo] |
| 5 | Can Satelink **economically** participate? | **NO today** — real fee-bearing flow ≈ 0 |
| 6 | Does Satelink improve the system? | Only where supply is fragmented (data/inference); marginal vs. incumbents; UNKNOWN if buyers value it |
| 7 | Survive if incumbents compete? | **LOW** — Coinbase/Stripe/Visa/Mastercard are actively enclosing every seat [public 2026] |
| 8 | Still earn if demand doubles? | YES, proportionally — but 2× ~0 ≈ 0 |
| 9 | Still earn if demand halves? | YES structurally — irrelevant from a ~0 base |
| 10 | Single event that creates revenue? | one real (non-founder, non-wash) agent settling through a Satelink-listed resource |
| 11 | **Can engineering alone activate revenue?** | **NO** — this is the disqualifier |
| 12 | What external dependency blocks it? | **emergence of real, non-wash agent demand on a permissionless rail** — exogenous, outside founder control, may never occur |

Question 11 is fatal for a BUILD decision: **no amount of engineering produces the first dollar.** Revenue is gated on an external market event. Capital spent building before that event is capital at risk of returning zero.

## 3. Most important question: can a solo founder build this?

- **The positioning/option (build the small Seat-B core + x402 adapter, hold it dark):** YES — small surface, inbound already exists [repo], no team required.
- **The only paths with real demand *today* (Phase 0.2's rule-breaking survivors):**
  - *Cross-protocol adapter for fiat agentic commerce* — requires winning merchant/agent integration BD against Stripe, Checkout.com, Gr4vy, PSPs. **A solo founder cannot win distribution/BD against incumbent sales orgs. REJECT (solo-founder gate + "no sales").**
  - *Order-flow / solver spread* — requires inventory capital + latency + quant infra. **A solo founder cannot fund inventory or win a latency arms race. REJECT (solo-founder gate + "no capital").**

So the solo-founder gate independently kills both fundable-looking pivots. What a solo founder *can* do is hold the near-free option — which is not a $10M investment.

## 4. Investment scores (committee underwrite)

| Dimension | Score | Note |
|---|---|---|
| Engineering certainty | **8/10** | loop is small; inbound live [repo] |
| Market certainty | **2/10** | demand unproven; may never emerge [public 2026] |
| Revenue certainty | **1/10** | could be $0 indefinitely (Q11) |
| Profit certainty | **2/10** | fees compress toward zero under competition (OpenRouter 0% markup) [public] |
| Automation certainty | **8/10** | mechanism is genuinely automatable |
| Competitive durability | **2/10** | incumbent enclosure is the base case [public 2026] |
| Capital requirement | **9/10 (favorable)** | ~$0 to position/hold |
| Operational complexity | **7/10 (favorable)** | solo-founder-feasible for the option |
| Time to first revenue | **UNKNOWN** | exogenous; gated on market, not code |

**Probability ladder (real, non-wash revenue; if positioned and held to activation):**

| Milestone | Probability | Basis |
|---|---|---|
| First **$100** | **~50%** | a listed resource can catch a few real dollars even in a thin market |
| First **$1,000** | **~30%** | needs sustained real usage |
| First **$10,000 / month** | **~15%** | requires the market to turn real AND Satelink to win share vs. incumbent aggregators |
| **$100,000 / month** | **~4%** | requires a large market AND a durable un-enclosed seat vs. Coinbase/Stripe/Visa-scale enclosure |

These are sobering by design. The expected value is dominated by a small-probability, market-dependent tail — the signature of an **option**, not a **business**.

## 5. Why not the other three verdicts

- **BUILD — rejected.** Requires a market that does not exist today (§1); Q11 says engineering cannot create revenue. Deploying build capital now is capital destruction. An IC does not fund an empty market on a thesis of future emergence — that is the definition of speculative, which the mandate forbids.
- **PIVOT — rejected.** The only architectures with real demand today break a hard constraint (sales or capital) *and* fail the solo-founder gate (§3). There is no fundable, solo-buildable, revenue-today replacement — because that target is the same empty quadrant.
- **ABANDON — rejected.** ABANDON requires proving the option value is ≤ 0. We cannot: holding cost ≈ $0, and the upside is credible and institutionally backed (Coinbase, Cloudflare, Linux Foundation x402 Foundation, Visa, Mastercard, Stripe, AWS; McKinsey projects ~$1T agent transactions by 2030) [public 2026] with a concrete activation trigger. EV(hold) > EV(abandon) whenever holding cost ≈ 0 and option value > 0. Abandoning a free positive-EV option is itself a capital-protection failure (forfeited upside).

## 6. Committee decision

The disciplined capital-protection decision is to **deploy $0 now, refuse the build, and hold the near-free option against a hard, measurable trigger.** That decision is **WAIT**. The clean, unhedged statement of it — with the trigger, the monitoring protocol, and the conditions that convert it to BUILD or to ABANDON — is in `FINAL_EXECUTION_DECISION.md`.
