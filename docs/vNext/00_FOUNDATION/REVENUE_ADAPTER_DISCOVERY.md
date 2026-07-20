# Revenue Adapter Discovery — Phase 0.4

> **Team:** M&A Integration. **Mission:** find ONE existing profitable machine economy Satelink can plug into immediately and earn automatically — or prove none exists. **Absolute rule under test:** Satelink must not create demand, recruit suppliers, become a marketplace, wait for growth, do enterprise sales, or market. Revenue must already exist.
>
> This document challenges (does not defend) all prior-phase conclusions. Evidence tags: `[public YYYY-MM]`, `[protocol]`, `[measured]`, `[repo]`.

## Method

For each economy: what creates recurring money, who owns the four control points (demand / supply / dispatch / settlement), and can Satelink insert a **pure-software** adapter that earns automatically while **only revenue routing changes** (the Adapter Test), buildable by one engineer in <8 weeks with immediate revenue (the Implementation Test).

## The strongest real candidates (the ones that nearly pass) — with production evidence

These are the best "insert-and-earn" mechanisms that actually exist. They are ranked highest because they are **permissionless, one-parameter, on-chain-instant** — they pass the Implementation Test outright.

| Adapter | How it earns (production mechanism) | Passes Implementation Test? | Where it dies |
|---|---|---|---|
| **0x Swap API affiliate fee** | integrator sets `swapFeeBps` + `swapFeeRecipient`; fee charged on-chain during the swap, no manual payout [public 2026, 0x docs] | **YES** — one engineer, an afternoon | Earns **only on swaps routed through your app**. No app/users → $0 |
| **1inch integrator fee** | "swap flow becomes a revenue line **inside your product**" [public 2026] | YES | Requires *your product* with *your users* |
| **Jupiter platform fee** | integrator adds platform-fee bps on swaps through their integration [public 2026, Jupiter docs] | YES | Requires your integration to carry the swap flow |
| **PFOF (equities)** | market makers rebate brokers for routed order flow [public] | NO (needs broker-dealer license + capital) | "the **retail broker-dealer must originate and route** the customer orders to earn" [public] — no owned order flow → $0 |
| **Referral/affiliate (exchanges, clouds, SaaS)** | standing programmatic commission for referred volume | YES (join is permissionless) | Pays for **referred demand** — you must be the referrer/source |

## The universal pattern (this is the finding)

Every economy scanned — Web3 and beyond: DEX aggregators, PFOF, cloud reseller/rebate, payment orchestration/LCR, telecom least-cost routing, CDN/bandwidth resale, RapidAPI-class marketplaces, ad RTB, MEV/order-flow auctions, inference routers, agentic-commerce rails (ACP/AP2/MPP/x402) — resolves to the **same settlement**:

> **A revenue-share/skim mechanism pays you for supplying exactly one scarce input to the flow: routed demand, supplied capacity, deployed capital, or an embedded/chosen service seat.**

- **DEX affiliate fees, PFOF, referral programs** → pay for **routed demand** (you must own the surface the flow passes through).
- **Cloud/GPU/marketplace supply, bandwidth resale** → pay for **supplied capacity** (capex/inventory).
- **MEV, solvers, market-making** → pay for **deployed capital** (+ latency).
- **Payment orchestration, API gateways** → pay for an **embedded seat** the merchant/platform *chose* (enterprise BD).

There is no observed economy that pays an integrator who supplies **none** of these. That is not a sampling gap; it is conservation of value — payment is compensation for a scarce input provided, and an entity providing nothing scarce is paid nothing.

## Mapping to Satelink's absolute rules

Satelink's absolute rules forbid supplying **every** scarce input:

| Scarce input the market pays for | Satelink's rule |
|---|---|
| routed demand | "must not create demand," "no marketing" |
| supplied capacity | (self-supply RPC converts at ~$0 [measured]) |
| deployed capital | prior constraints forbid capital |
| an embedded/chosen seat | "must not recruit," "no enterprise sales," "no convincing" |

The one real adapter that passes the Implementation Test (0x affiliate fee) requires the single input — routed demand through an owned surface — that Satelink's first rule forbids. Satelink owns no external demand surface; its only owned flow is RPC traffic, which cannot carry a swap-affiliate fee and converts at ~$0 [measured].

## The Adapter Test, applied honestly

"Imagine Satelink is added. Exactly one thing should change: revenue routing." For the 0x adapter, adding Satelink changes revenue routing **only if swaps already flow through a Satelink-controlled surface**. Since none do, activating it requires *also* creating a demand surface (an app, an adopted framework, users) — a **second change**, and the one the absolute rule forbids. **Fails the Adapter Test** for a non-incumbent with no demand surface.

## Conclusion of the scan

No economy scanned yields an adapter that earns for Satelink while respecting all absolute rules. The best real adapter on Earth (0x affiliate fee) is buildable in an afternoon and still returns **$0** for Satelink, for a production-verifiable reason: it pays for demand, and Satelink has none and forbids acquiring any. The formal verdict and the economic law are in `TOP_ADAPTER_VERDICT.md`; the concrete, production-grounded proof (the actual adapter and its exact $0 point) is in `PRODUCTION_INTEGRATION_PLAN.md`.

## Sources
[0x — monetize with Swap API](https://0x.org/docs/0x-swap-api/guides/monetize-your-app-using-swap) · [0x multi-fee](https://webflow.internal.0x.org/post/multi-fee-support) · [1inch Swap API](https://business.1inch.com/portal/documentation/apis/swap/fusion-plus/introduction) · [Jupiter — add fees to swap](https://developers.jup.ag/docs/swap/v1/add-fees-to-swap) · [PFOF — Wikipedia](https://en.wikipedia.org/wiki/Payment_for_order_flow) · [PFOF — Congress/CRS](https://www.congress.gov/crs-product/IF11800)
