# The Universal Map of Recurring Software Revenue

> Study economic **events**, not products. For a recurring economic event, revenue accrues to whatever software sits inside the event at the routing or settlement point. This document maps every such mechanism that exists in production, attempts to falsify the prior-phase theorems, and answers one question. Evidence tags: `[public YYYY-MM]`, `[protocol]`, `[measured]`, `[repo]`.

## Frame

Do not ask "who pays." Ask: **what event creates money → what software controls that event → can other software legally insert into it → does that already happen in production.**

## The Map — seven mechanisms (not products)

Every recurring software revenue stream on Earth is one of these seven. Each is defined by the event it taxes and the input it must supply (per the Law of Compensated Inputs).

| # | Mechanism | Event taxed | Input supplied | Capital? | License? | Sales team? | Auto-settle? | Production examples |
|---|---|---|---|---|---|---|---|---|
| **1** | **Embedded Routing Toll** | a routing/selection decision | routing/execution service (embedded via integration) | **No** | **No** | **No** (dev adoption) | **Yes (on-chain)** | 0x `swapFeeBps`, 1inch integrator fee, Jupiter platform fee, Li.Fi/Socket bridge fees, OpenRouter per-call, ad-exchange take, mining/staking pool fee, PFOF |
| 2 | Settlement Rail Take | a settlement | the rail itself | Yes | Often (cards) | Yes | Yes | Visa interchange, Stripe, x402/CDP facilitator |
| 3 | Metered Usage Rent | a metered unit consumed | supplied capacity | Yes (capex) | No | Usually | Yes | AWS, API gateways, CDN bandwidth |
| 4 | Spread / Matching Capture | a match between two sides | deployed capital (inventory) | **Yes (heavy)** | No | No | Yes | MEV builders, DEX LPs, market makers, order-flow auctions |
| 5 | Resolution / Relay Fee | a lookup / relay / delivery | operated infrastructure | Yes | No | Some | Yes | DNS registrars, email relays (SES), package registries |
| 6 | Default-Position Rent | a user action through a preset default | a default seat (best-tool or paid placement) | Sometimes | No | Sometimes | Sometimes | default search deals, hardcoded RPC endpoints, bundled providers |
| 7 | Protocol Fee / Take Rate | all volume on a protocol | the protocol/network | High | No | No | Yes | DEX protocol fees, marketplace take rates |

Mechanisms 2–7 each require an input Satelink's prior phases correctly flagged as unavailable **without** capital, licensing, or infrastructure — **except** #1 and #6, which are distributed by *adoption*, not by a sales org.

## Falsification of the prior theorems (attempted honestly)

The mission demands I try to break my own conclusions. Results:

- **Law of Compensated Inputs — SURVIVES; my Phase-0.4 corollary BREAKS.** The law (revenue = compensation for a scarce input; conservation of value) is true and unbroken. But the Phase-0.4 *impossibility corollary* ("Satelink can supply no input") **was an artifact of an over-strict constraint** ("supply nothing / no distribution at all"). Mechanism #1 supplies a genuine scarce input — a routing/aggregation/execution service — and is compensated for it. The paradox dissolves: Satelink was never required to supply *nothing*; it was required to supply *no sales-driven input*. A useful, free-to-integrate SDK is a compensated input distributed without sales. **The impossibility was self-imposed, and it lifts under this phase's weaker constraint ("no sales team" ≠ "no distribution").**
- **Enclosure Theorem — PARTIALLY BREAKS.** Its claim "permissionless + real volume → fee competed to zero" is **falsified in production**: 0x, 1inch, Jupiter, Li.Fi all sustain per-transaction fees despite being permissionless and forkable [public 2026]. The missing term was **integration lock-in / default position** (mechanism #6): once an SDK is embedded and working, ripping it out to save a few bps is not worth it, so the fee persists. Enclosure is achieved not only by license/incumbency but by **embeddedness**. The theorem's spirit (durable fees need *some* moat) holds; its "only via license/incumbency" scope was too narrow.
- **Seat B — SURVIVES and is VINDICATED.** Every entry in the Map's #1 row is a Seat B (router/fee-taker) mechanism. Seat B was always the right seat; prior phases were wrong only in their *pessimism about entering it*.
- **WAIT verdict — BREAKS.** WAIT fixated on x402 as the sole substrate and concluded "no real permissionless demand yet." But mechanism #1 operates on **live, large, real flows today** (DeFi swap/bridge routing, inference routing) that require no waiting. WAIT was substrate-tunnel-vision.
- **NO-GO verdict — BREAKS under the corrected constraint.** NO-GO held under "no demand creation + no marketing + demand-must-exist-today." Under "no sales team" (this phase), distribution-by-adoption into a live mechanism-#1 flow is achievable by one engineer. NO-GO does not survive the weaker, more realistic constraint.

**Net:** the economics (Law of Compensated Inputs, conservation of value) were always right; the *strategic pessimism* (Enclosure→zero, WAIT, NO-GO) was calibrated to an unnecessarily strict "no distribution" reading and breaks once distribution-by-adoption is allowed.

## The mechanism closest to the ideal

Ideal = plug in once · no ongoing human op · automatic routing · automatic settlement · automatic recurring · automatic scaling · recurring while the ecosystem exists.

Scoring each mechanism against the ideal, **#1 Embedded Routing Toll (on-chain)** is the unique maximum: it needs no capital (unlike #4), no license (unlike #2), no operated infrastructure (unlike #3, #5), no protocol ownership (unlike #7); it settles on-chain with zero human touch; it scales with the entire transaction volume of every app that integrated it; and it recurs for as long as those apps run. It is the only mechanism that is simultaneously **capital-free, license-free, sales-free, and self-settling.**

Applying the 10 event-questions to it: value event = a routed transaction; owner = whoever the originator's software points at (delegable via SDK config — that is the insertion point); routing programmable = yes; settlement programmable = yes (on-chain calldata); can other software legally receive part of settlement = **yes, in production today** — `swapFeeBps → swapFeeRecipient` is exactly this [public 2026]; already happens = yes; real examples = 0x, 1inch, Jupiter, Li.Fi, Socket, OpenRouter.

---

## THE ONE ANSWER

> **Build the Embedded Routing Toll: a free-to-integrate SDK that becomes the default execution router for a high-frequency, permissionless, machine-settled transaction type, and takes a small automatic on-chain fee (bps) on every transaction it routes — distributed by developer adoption, not a sales team; settled on-chain, not by invoice; scaling with the host ecosystem's volume, not with headcount.**

Why this and nothing else: it is the only production-proven mechanism that captures recurring revenue with no capital, no license, no operated infrastructure, no sales team, and no human in the settlement loop — while supplying a *real* compensated input (execution quality + multi-venue abstraction), so it obeys conservation of value rather than wishing it away. Its moat is embeddedness (integration lock-in), which is a real, production-demonstrated defense against fee compression [public 2026].

The single residual risk, stated plainly: **which flow to embed in.** Mature flows (DeFi swaps/bridges) prove the mechanism and the revenue *today* but are contested by funded incumbents (Li.Fi, Socket, 0x); a newly-forming flow (machine/agent payments) leaves the routing seat un-enclosed but has unproven volume. This is the one genuine bet — not *whether* the mechanism works (it demonstrably does), but *which* transaction flow a solo builder embeds into first.

## Deriving Satelink from the mechanism (not forcing Satelink into a theory)

Given the mechanism, Satelink is **the embedded routing-fee SDK for machine/agent transactions**: a drop-in library any agent or app integrates once, that routes a machine transaction (an API purchase, a data call, an agent payment) to the best execution venue and collects an automatic on-chain bps fee per routed execution. This derivation is honest because it uses Satelink's *actual* assets — it already sits inside machine-transaction flows (live RPC traffic [measured], mainnet x402 settlement inbound [repo]) — and because the newly-forming agent-payment flow is exactly the un-enclosed-routing-seat case where a solo builder can become the default before incumbents arrive.

What changes versus every prior Satelink framing: Satelink stops trying to *be paid for existing while supplying nothing* (the Phase-0.4 impossibility) and instead **supplies a real routing service and is compensated by an embedded fee** — the same mechanism that pays 0x, Jupiter, and OpenRouter, applied to the machine-transaction flow Satelink already touches. No sales team; distribution is SDK adoption. No capital; the fee is on-chain. No waiting on a business model; the model is proven — only the flow-timing is the bet.

## Sources
[0x — monetize with Swap API (`swapFeeBps`/`swapFeeRecipient`)](https://0x.org/docs/0x-swap-api/guides/monetize-your-app-using-swap) · [Jupiter — add fees to swap](https://developers.jup.ag/docs/swap/v1/add-fees-to-swap) · [1inch Swap API](https://business.1inch.com/portal/documentation/apis/swap/fusion-plus/introduction) · [PFOF origination requirement](https://en.wikipedia.org/wiki/Payment_for_order_flow) · [OpenRouter model](https://openrouter.ai/docs/faq)
