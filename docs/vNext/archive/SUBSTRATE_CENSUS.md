# Substrate Census — Phase 0.2

> **Purpose:** market-wide, adversarial census of every production ecosystem that could host Satelink's autonomous-revenue loop. This is an attack document: the goal is to find a substrate that survives, or to prove none does. Scope was widened past the canonical doc's crypto-only framing to include **fiat** machine-settled economies, per the Phase 0.2 mandate (criterion: money is fiat *or* stablecoin).
>
> **Evidence tags:** `[public YYYY-MM]` cited public data, `[measured]` project-internal metric, `[protocol]` spec fact, `UNKNOWN`. Sources listed at end.

## The 10 admission criteria (ALL required)

1 someone already pays · 2 someone already supplies · 3 pricing already exists · 4 machines already settle automatically · 5 **demand already exists today** · 6 supply already exists today · 7 fiat or stablecoin · 8 recurring workloads · 9 no token subsidy · 10 real revenue.

Plus the constraint filter (reject if entry requires any): **sales, marketing, waiting for users, enterprise onboarding, capital deployment, inventory, liquidity provision, speculation, subsidy, or hoping demand comes later.**

## Census table

| Ecosystem | Pays / Supplies | Settles automatically? | Real demand **today**? | Entry cost for a no-capital/no-sales router | Survives? |
|---|---|---|---|---|---|
| **Fiat agentic retail commerce** (OpenAI ACP, Stripe, Shopify, Etsy) | shoppers via AI agents / 1M+ merchants | YES (card rails, Instant Checkout) [public 2026-01] | **YES** — $20.9B AI-referred retail, 1.5% of total, 15× Shopify YoY, 42% better conversion [public 2026] | **Sales/gatekeeping** — ACP is curated, OpenAI vets merchants, OpenAI+Stripe own the 4% fee seat [public 2026] | **NO** (enclosed) |
| **Card-network agent rails** (Visa Intelligent Commerce, Mastercard Agent Pay / AP4M) | agents / merchants | YES (machine settlement, sub-cent) [public 2026] | YES on consumer side | **Licensing/capital** — must be issuer/acquirer/PSP; Visa building Agent Score (reputation seat) + Agentic Registry (discovery seat) itself [public 2026] | **NO** (enclosed by networks) |
| **UCP open catalogue** (self-publish merchants) | agents / merchants | via underlying PSP | partial | Permissionless to *read*, but earning requires being in the money path (PSP) → **sales/capital** | **NO** |
| **x402 / Base + Solana** (stablecoin, permissionless) | agents / API merchants | YES [protocol] | **NO** — real volume tiny, ~half wash/self-dealt, "demand not yet emerged," needs >$100k/day [public 2026] | **~$0 (permissionless)** | **FAILS #5** |
| **LLM inference routing** (OpenRouter model) | developers/agents / model providers | YES (top-up billing) | YES | **Marketing** — a new router needs developers to choose it [public] | **NO** |
| **GPU / cloud spot** (AWS/GCP/Vast.ai) | ML teams / hosts | YES | YES | **Capital/inventory + reseller ToS** | **NO** |
| **Ad exchanges / RTB** | advertisers / publishers | YES (billions of auctions/day) | YES | **Enterprise integration** (publisher + advertiser contracts) | **NO** |
| **Wholesale SMS/voice (LCR routing)** | senders / carriers | YES (least-cost routing, spread capture) | YES | **Capital (interconnect deposits) + sales (traffic customers)** | **NO** |
| **Payment interchange** (Visa/Stripe) | merchants / issuers | YES | YES | **Regulatory license + capital** | **NO** |
| **Energy / spot electricity markets** (PJM, ERCOT) | load / generators | YES (automated bidding) | YES | **Registration + physical assets + capital** | **NO** |
| **DEX order-flow / solver auctions** (CoW, UniswapX) | traders / solvers | YES (on-chain) | YES | **Inventory capital + gas + latency** | **NO** |
| **MEV** | — / searchers | YES | YES | **Capital + latency arms race** | **NO** |
| **Bitcoin mining / ETH staking** | network / miners-validators | YES | YES (but subsidy) | **Capex/energy or 32-ETH stake; fails #9 (subsidy)** | **NO** |

## The single structural finding

Every ecosystem splits into exactly two groups, and the split is total:

- **Real demand today (criterion #5 = YES):** every one has its revenue seat **enclosed** — either by an incumbent that gatekeeps (OpenAI 4%, Visa/Mastercard networks, PSPs) or by a hard entry barrier (capital, license, interconnect, physical assets, latency). Entry violates the constraint filter.
- **Permissionless entry (constraint filter = PASS):** exactly one — x402 permissionless stablecoin rails — and it **fails criterion #5** (real demand has not emerged; the volume that exists is largely wash-traded).

**No ecosystem is simultaneously (a) real-demand-today and (b) permissionless/zero-capital/zero-sales entry.** The census surface is empty in the required quadrant. Detailed proof of *why* this is structural (not a sampling gap) is in `MARKET_KILL_REPORT.md`.

## Sources
- x402 real vs wash volume, "demand not yet emerged": [CoinDesk 2026-03](https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet), [note.com/x402inc](https://note.com/x402inc/n/nfd6227f13b55?hl=en-US)
- Fiat agentic commerce demand: [MetaRouter trends](https://www.metarouter.io/post/agentic-commerce-trends-statistics), [Checkout.com report](https://www.checkout.com/guides-and-reports/agentic-commerce-2026)
- ACP curated / OpenAI gatekeeper / 4% fee: [OpenAI Commerce](https://developers.openai.com/commerce), [ACP GitHub](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol), [eco.com ACP](https://eco.com/support/en/articles/14730440-agentic-commerce-protocol-explained)
- Visa/Mastercard rails, Agent Score, AP4M: [TechTimes 2026-07](https://www.techtimes.com/articles/320813/20260717/visa-mastercard-stripe-back-open-standard-letting-ai-agents-pay-autonomously.htm), [Forbes 2026-03](https://www.forbes.com/sites/boazsobrado/2026/03/19/stripe-visa-and-mastercard-race-to-build-ai-agent-payment-rails/), [agenticplug protocol tracker](https://agenticplug.ai/current-state-of-agentic-commerce)
