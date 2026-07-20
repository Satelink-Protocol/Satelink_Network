# CANONICAL — Autonomous Revenue Architecture

> **Status:** CANONICAL. Single source of truth for Satelink vNext. Produced by Phase 0.1 first-principles validation (2026-07-20). Every other vNext document is subordinate to this one and, where it conflicts, this document wins. This file does not describe an implementation; it defines the only architecture Satelink is permitted to build toward and the exact conditions under which it may be built.
>
> **Evidence discipline:** every load-bearing claim is tagged `[repo]` (this codebase), `[measured <date>]` (verified production metric, project-internal), `[protocol]` (protocol/spec fact), `[public <YYYY-MM>]` (public market data, cited inline), or `UNKNOWN`. Untagged assertion = defect.

---

## 0. The invariant (verbatim, non-negotiable)

Satelink is an **Autonomous Revenue Operating System**: an autonomous intermediary that continuously captures recurring revenue from **existing** paid machine economies. Revenue originates from economic activity that already happens — never from sales, marketing, grants, token inflation, mining subsidies, or speculation.

The loop:

```
existing paying ecosystem
  → import demand automatically
  → import supply automatically
  → machine-to-machine execution
  → automatic settlement
  → automatic revenue capture (spread or fee)
  → repeat, forever, with zero human action per unit
```

**The success property (the only metric that matters):**

> Every time an existing external ecosystem generates a paid workload, Satelink automatically has an *opportunity to earn*, with no additional human action from Satelink.

An architecture that fails this property is rejected regardless of engineering quality. Note the word *opportunity*: the property does not promise Satelink wins every unit — it promises Satelink is **structurally in the earning path** for every unit, without a human placing it there each time.

---

## 1. First principles: the three seats

Any machine economy has exactly three revenue seats. Value accrues to one of them per unit of work.

| Seat | Definition | You earn by | Capital profile | Autonomy ceiling |
|---|---|---|---|---|
| **A — Supplier** | produce and sell capacity (compute, hashpower, stake, storage) | selling capacity you own | **capex + opex** (hardware/energy/stake-at-risk) | high once running, but you only earn when demand *picks you* |
| **B — Router / aggregator / fee-taker** | sit between demand and supply; route, aggregate, settle | fee or spread on flow you route | **~zero capital**, marginal cost ≈ compute | earns on *every routed unit*; no owned capacity to utilize |
| **C — Settlement rail / facilitator** | own the payment/discovery substrate | protocol fee on all volume | network-effect + trust + regulatory capital | highest, but requires *being* the incumbent |

Satelink's hard constraints — **no capex, no capital-at-risk, no sales, no marketing, no subsidy, software-only** — mechanically eliminate two of the three seats:

- **Seat A is eliminated by "no capex / no capital-at-risk."** Being a supplier means owning hardware, energy contracts, or staked capital. Satelink's own attempt at supplier economics (RPC gateway) produced 496k req/day at **~$0 real revenue** [measured 2026-07-16] — and even a *working* supplier only earns when demand chooses it, which violates the success property (the opportunity is not automatic; it is contingent on selection).
- **Seat C is eliminated by "software-only / no incumbency."** Owning the rail means being Coinbase/Stripe/Cloudflare/a base-layer protocol. Not attainable by integration; it is a decade-and-a-balance-sheet position.

**Seat B is the only seat consistent with the constraints.** This is not a preference; it is what remains after the constraints delete A and C. The rest of this document re-proves that Seat B is *viable* (not merely permitted), identifies its exact failure modes, and defines the conditions under which Satelink may occupy it.

---

## 2. The 15-question gate, applied to the *category*, not one ecosystem

The Phase 0.1 mandate asks the 15 questions per candidate workload. Running them reveals that the questions do **not** discriminate between workloads (RPC vs inference vs data vs GPU) — they discriminate on **one structural condition** shared across all of them:

> **A workload ecosystem can host Seat B if and only if it already has a machine-readable discovery+settlement substrate carrying pre-existing paid, machine-initiated demand and machine-listed supply.**

Questions 5, 6, 8, 9, 10, 14 (import demand automatically, import supply automatically, execute automatically, settle automatically, capture spread every execution, run without human decisions) are all `YES` *only* on such a substrate and all `NO` without one. So the gate collapses: **the substrate is the thing being selected, and the workload is merely what flows through it.**

This is the single most important finding of Phase 0.1 and it corrects a latent assumption in the prior vNext docs (which reasoned per-workload). **Satelink does not choose a workload. It chooses a substrate.** Workloads become adapters *on* a chosen substrate.

### Which ecosystems have such a substrate (production evidence only)

| Candidate | Machine-settlement substrate exists? | Verdict |
|---|---|---|
| **x402 / Base agentic payments** | YES — HTTP 402 + CDP facilitator + Bazaar/Agent.market discovery [protocol; public 2026] | **SURVIVES** |
| **DEX order-flow / solver auctions** (CoW, UniswapX, 1inch Fusion) | YES — on-chain intents + solver auctions + on-chain settlement [protocol] | **SURVIVES the substrate test, fails the capital test** (see §4) |
| Blockchain RPC as a *product* | NO — fiat signup, card billing [measured: ~$0 conversion] | REJECT |
| AI inference (OpenRouter-native), search, browser automation, CI/CD, edge compute | NO — fiat API keys, not machine-settled [public 2026] | REJECT (until they appear on a machine substrate) |
| GPU (Akash, Vast.ai, io.net), storage (Filecoin/Arweave), indexing (The Graph), video (Livepeer) | Routing/settlement is **protocol-internal**; entry requires capex/ops [protocol] | REJECT (Seat B is already occupied by the protocol) |
| Bitcoin mining, Ethereum staking | Revenue is **subsidy/issuance** (rejected) + fees; and the seat is Seat A (capital) | REJECT for Satelink |

Only **two** ecosystems survive the substrate test with production evidence. One of them (DEX order-flow) fails a *different* Satelink constraint. That leaves the question of whether the surviving substrate is good enough — answered in §5.

---

## 3. Mathematical re-proof of Seat B (no assumption of the answer)

Let a substrate process, per period, a set of paid units \(U\), each unit \(u\) with buyer-price \(P_u\) and best supplier-cost \(C_u\).

- **Seat A (supplier) profit:** \( \pi_A = \sum_{u \in W} (P_u - c^{own}_u) - (\text{capex amortization} + \text{opex}) \), where \(W \subseteq U\) is only the units where demand *selected you*, and \(c^{own}_u\) is your marginal production cost. Requires \(|W|>0\) (selection, not automatic) and a capital base. Margin is competed toward opex by other suppliers. **Fails "automatic opportunity" (contingent on \(W\)) and "no capex."**
- **Seat B (router) profit:** \( \pi_B = \sum_{u \in R} f_u - I \), where \(R \subseteq U\) is units routed through Satelink, \(f_u\) is the per-unit fee or spread \((P_u - C_u)\), and \(I\) is fixed infrastructure cost. Marginal cost per unit ≈ 0. No capital at risk. **The success property holds iff Satelink is structurally in the path for every \(u\), i.e. \(R \to U\) is achievable by discovery, not by sales.**
- **Seat C (rail) profit:** \( \pi_C = \phi \sum_{u \in U} P_u \), \(\phi\) = protocol fee. Captures *all* units but requires owning the substrate. Unattainable.

**Seat B dominates for a zero-capital software entity** because: (i) it earns on the whole substrate flow \(U\), not owned-capacity utilization; (ii) \(I\) is fixed, so gross margin → high as flow grows (software scaling); (iii) zero capital at risk. Seat A's dependence on \(W\) (selection) and capital makes \(\pi_A\) both smaller and non-autonomous; Seat C is not reachable.

**The three failure modes of \(\pi_B\), stated honestly:**

1. **\(f_u \to 0\) (fee competed to zero).** If routers proliferate, per-unit spread compresses. **Evidence this is real:** OpenRouter runs a **0% inference markup** and monetizes a **~5% credit-purchase / top-up fee** instead [public 2026]. **Consequence (binding architectural correction):** the durable capture is a **fee on prepaid balance / float**, not per-call buy-low-sell-high arbitrage. Arbitrage spread is a bonus, not the model.
2. **\(R \ll U\) (not in the path — disintermediation).** In a transparent discovery index, a buyer can route directly to the supplier it can also see. **Evidence the fee survives anyway:** NiceHash, mining pools, OpenRouter, and Vast.ai all take a fee despite buyers being able to go direct — because **aggregation, failover, and single-endpoint convenience over fragmented supply are worth the fee** [public]. **Consequence:** Seat B is defensible **only where supply is fragmented and unreliable** (data/inference/hashpower/GPU) and **worthless where supply is a reliable commodity** (single RPC endpoint). This kills "resell RPC" as a beachhead and redirects to fragmented, value-dense supply.
3. **\(U \approx 0\) (no real demand on the substrate).** If the ecosystem has infrastructure but no real paid flow, \(\pi_B \to -I\). **Evidence this is the live risk:** x402 shows ~$50M cumulative volume / 165M tx by April 2026 [public], but recent real daily volume is tiny (~$28k/day) with **~half wash-traded/self-dealt**, and analysts state real demand *"has not yet emerged"* and would need **>$100k/day** real volume to validate [public 2026]. **This is the dominant risk and it is exogenous to Satelink.**

The re-proof therefore yields Seat B **conditionally**: mathematically dominant for Satelink's constraints, but live only where supply is fragmented (mode 2), captured via a float/top-up fee (mode 1), and gated on a substrate reaching real demand (mode 3).

---

## 4. Comparison against production infrastructure economies

Each comparator is scored on: does it prove Seat B works, and can *Satelink* occupy that seat under its constraints?

| Economy | Seat | Proves Seat B is real? | Can Satelink be it? | Why / why not |
|---|---|---|---|---|
| **Bitcoin mining** | A | — | **NO** | ~all revenue is block subsidy (inflation, rejected); capex + energy [protocol] |
| **Ethereum staking** | A | — | **NO** | 32-ETH capital at risk + issuance component (speculation/subsidy) [protocol] |
| **Mining pools** | **B** | **YES** — takes ~1–2% fee off every block, miners join by pointing hashrate at a URL, fully autonomous [public] | NO (won't run a pool) | **Strong Seat-B existence proof**, but its economy rests on subsidy and pools compete on brand for hashpower |
| **NiceHash** | **B** | **YES** — two-sided hashpower marketplace, spread on every rental, machine-to-machine [public] | NO (distinct market) | Proves autonomous two-sided spread capture is durable; but liquidity was bootstrapped (marketing) |
| **OpenRouter** | **B** | **YES** — one API over 400+ models, **0% markup + ~5% top-up fee**, per-call autonomous [public 2026] | Partially (model, not the market) | **Closest analog.** Proves the float-fee model. But demand is fiat-rail and **acquired via developer mindshare (marketing)** — a constraint Satelink forbids |
| **AWS Marketplace** | C | — | **NO** | Must be AWS (own the platform) |
| **Cloudflare** | A/C | — | **NO** | Infrastructure incumbent; is itself becoming an x402 *facilitator* (Seat C) [public] |
| **Vast.ai** | **B** | **YES** — GPU rental marketplace, takes a cut, hosts self-list [public] | NO | Proves Seat-B marketplace works; supply side is capex hosts; liquidity bootstrapped |
| **DEX solvers / order-flow auctions** (CoW, UniswapX, 1inch Fusion) | **B++** | **YES — the purest autonomous spread machine in production**: solvers compete, capture surplus on every trade, on-chain settlement, zero humans [protocol] | **NO** | Requires **inventory capital + gas + latency + quant sophistication**; margins competed to near-zero by capital-rich competitors. Fails Satelink's "no capital" constraint |
| **MEV (searchers/builders)** | B++ | YES (extractive) | **NO** | Capital + extreme-latency arms race; zero-sum; not "importing demand/supply" |
| **Bandwidth exchanges, CI/CD capacity, edge compute** | B (nascent) | Weak — thin/immature markets, mostly fiat [public/UNKNOWN] | Not yet | No machine-settlement substrate with real flow yet |
| **Storage networks / inference routers (fiat)** | A / B-fiat | Inference routers = OpenRouter (covered) | NO (fiat) | Storage = Seat A capex; fiat inference = no machine rail |

**What the comparison proves, honestly:**

1. **Seat B is unambiguously a real, durable, autonomous business model.** Mining pools, NiceHash, OpenRouter, Vast.ai, and DEX solvers are all live Seat-B economies capturing recurring machine-settled fees. Seat B is not a theory. ✔
2. **Every one of them solved the liquidity problem with either capital (solvers/MEV) or demand-acquisition (pools/NiceHash/OpenRouter/Vast.ai bootstrapped their two-sided markets).** **None was built with simultaneously zero capital AND zero demand-acquisition.** ✘ for Satelink's exact constraint set.
3. **The only way to occupy Seat B with neither capital nor demand-acquisition is to attach to a *pre-existing* discovery+settlement substrate that already carries both sides** — so Satelink inherits liquidity instead of bootstrapping it. That substrate is the entire bet. It exists (x402, order-flow auctions) but with real demand only where capital is also required (order-flow), or without capital only where real demand has **not yet emerged** (x402).

This is the brutal core: **Satelink's constraint set describes a business that no comparator has actually built, and it becomes buildable only in the exact window where a zero-capital machine substrate reaches real demand.** x402 is the first substrate that could open that window. It has not opened it yet.

---

## 5. The canonical architecture

Satelink is a **substrate-agnostic autonomous routing and fee-capture layer (Seat B) that attaches to machine-settlement substrates carrying pre-existing paid workloads.** It is *not* an x402 product, *not* an RPC product, *not* a marketplace Satelink bootstraps.

```
        ┌───────────────── SUBSTRATE ADAPTERS ─────────────────┐
        │  x402/Base (adapter #1)   |  order-flow (future)  ... │
        │  discovery feed + settle-in + settle-out primitives   │
        └───────────────┬───────────────────────┬──────────────┘
                        │ import supply          │ import demand
                        ▼                        ▼
             ┌──────────────────────────────────────────────┐
             │           SATELINK CORE (Seat B)             │
             │  supply index ← crawl substrate discovery    │
             │  demand entry ← expose routable resources    │
             │  route: fragmented supply → best unit        │
             │  settle: via substrate rail, both directions │
             │  capture: FLOAT/TOP-UP FEE (primary)         │
             │           + per-unit spread (secondary)      │
             │  ledger: append-only, chain-verifiable       │
             └──────────────────────────────────────────────┘
```

**Load-bearing design commitments (each corrects a prior-vNext assumption where Phase 0/0.1 evidence forced it):**

- **Substrate-agnostic, not x402-specific.** x402 is substrate adapter #1 because it is the only zero-capital machine substrate with a live discovery layer today [protocol; public 2026]. The core must not encode x402 assumptions; order-flow auctions, AWS Bedrock AgentCore payments, and Cloudflare/Stripe agentic rails [public 2026] are future adapters. *(Corrects: "optimize around x402.")*
- **Target fragmented, value-dense supply — never commodities.** Seat B earns only where aggregation adds value (failure mode 2). Real x402 demand is concentrated in **agent-consumed data APIs and LLM/inference/execution gateways** [public 2026]; RPC is the worthless-to-resell commodity end. *(Corrects: the M1 "generic HTTP / RPC-like" first-proof target.)*
- **Primary capture is a float/top-up fee, secondary is per-unit spread.** Per-call arbitrage compresses to zero under competition (failure mode 1; OpenRouter evidence). *(Corrects: ADR-003's merchant-of-record-spread framing — spread is retained as a mechanism but demoted below the fee-on-balance model.)*
- **Reuse only what accelerates the loop.** From `[repo]`: the live x402 inbound settlement, wallet/treasury, credit/idempotent-deposit path, cron host, circuit-breaker, price-floor logic, admin/observability, and the RPC gateway **as supplier #1 only**. Everything else is optional and non-blocking (the additive-mount, nothing-deleted discipline stands).

---

## 6. Does this satisfy the success property? (exact conditions)

The property — *every paid workload = an automatic earning opportunity* — is satisfied **if and only if** all three hold on the chosen substrate:

1. **Substrate liquidity is inherited, not bootstrapped** → so demand/supply import is automatic (no sales). ✔ by construction on a discovery substrate.
2. **Satelink is structurally in the routing path** → so \(R \to U\). ✔ where Satelink lists aggregated resources that are the convenient single endpoint over fragmented supply; ✘ for commodities buyers route around.
3. **The substrate carries real paid flow** → so \(U > 0\). **Currently UNPROVEN on x402** [public 2026: real demand "not yet emerged," <$100k/day, ~half wash]; proven on order-flow (but capital-gated).

**Therefore:** the architecture *can* satisfy the property, but **does not satisfy it today**, because condition 3 is not met on the only substrate Satelink can afford to occupy. The architecture is admitted as canonical; its **activation is gated on condition 3 being measured true.**

---

## 7. Activation gate and kill criteria

Satelink builds the substrate-agnostic core + x402 adapter **to be positioned**, but scales spend only when the substrate proves real demand. No capital, no marketing, spend bounded to infrastructure + capped outbound floats.

**Activation gate (all required before scaling beyond a capped pilot):**
- **G1 — Real flow:** substrate real (non-wash) daily volume trends toward or above **$100k/day** in fragmentable, value-dense categories (data/inference), measured by crawl + on-chain analysis, not headline numbers [public threshold].
- **G2 — In-path defensibility:** in a capped pilot, aggregated Satelink resources capture a **non-zero, measurable share** against incumbent x402 aggregators (Agentcash, AgenticMarket, Monid, Pay.sh, ekailabs/x402-openrouter, Tempo) [public 2026] — proving buyers pay the fee rather than route direct.
- **G3 — Capital-free positivity:** pilot ledger shows fee revenue ≥ infrastructure cost with **zero capital at risk beyond capped floats**, and **no negative-spread and no cap breach**.

**Kill criteria (any → re-PARK or REJECT this substrate, re-run §2 for the next one):**
- Substrate real demand stays flat/below threshold with no upward trend over the measurement window.
- Achieving \(R>0\) *requires* marketing/sales/mindshare (violates the invariant — this is the OpenRouter trap; if the only way to get flow is to market, Seat B on this substrate is not autonomous for Satelink).
- Aggregation adds no measurable value (buyers systematically route direct).
- Any capital-at-risk requirement emerges (would make it Seat B++ / solver economics Satelink cannot fund).

**First proof (zero-cost, precedes all building):** a **substrate census** — crawl the live x402 Bazaar/Agent.market index, categorize resources, estimate real vs wash volume per category, and identify resale-permissive, fragmented, value-dense supply. This resolves conditions 2 and 3 for x402 before a single production file is written. If the census fails G1/G2 preconditions, the correct action is to **not build** and to watch order-flow / AWS / Cloudflare rails for the next qualifying substrate.

---

## 8. Verdict (brutally honest)

- **Seat, re-proven from scratch:** **Seat B** (router / fee-taker on a machine-settlement substrate). Not assumed — derived: Satelink's constraints delete Seat A (capex) and Seat C (incumbency); Seat B is what remains, and it is model-proven durable by mining pools, NiceHash, OpenRouter, and Vast.ai. **Seat B++ (solvers/MEV) is the mathematically purest version and is rejected for Satelink because it requires capital Satelink does not have.**
- **The architecture is correct and is the strongest available for Satelink's constraints.** It is substrate-agnostic Seat B, float-fee-primary, fragmented-supply-targeted, x402-as-first-adapter.
- **It is not yet a business.** The one condition that makes it a business — real paid flow on a zero-capital substrate — is **exogenous, currently unmet on x402, and met only on capital-gated substrates**. No comparator ever built Seat B with both zero capital and zero demand-acquisition; Satelink is betting that a machine-settlement substrate removes the need for both. That bet is *reasonable* (the substrate exists and is backed by Coinbase, Cloudflare, the Linux Foundation x402 Foundation, and AWS Bedrock [public 2026]) and *unproven* (real demand has not emerged).
- **Confidence:**
  - Seat B is the right seat and this is the right architecture for the constraints: **~90%.**
  - The loop can run autonomously once flow exists (mechanism): **~90%.**
  - This becomes a **durable autonomous recurring-revenue business within 3 years**: **~30–35% (LOW).** The cap is entirely the exogenous demand-emergence risk plus the contested-seat risk — neither of which more engineering can fix.

**Recommendation:** Adopt this architecture as canonical. Build **nothing** for production until the zero-cost substrate census clears G1/G2 preconditions. Treat the whole system as a **cheap, capital-free option on machine-native commerce reaching real demand** — an option that costs almost nothing to hold and pays off only if the substrate market becomes real. If it never does, Satelink loses only infrastructure cost, having correctly refused to fund a market that did not exist.

---

## 9. What derives from this document

Everything else in `docs/vNext/` is now subordinate and must be read through this file:

- `01_ARCHITECTURE/*` — valid as engine designs, but re-scoped: "Routing/Pricing/Settlement/Spread/Reputation" engines are the **Seat B core**; the "Adapter System" is generalized to **substrate adapters + workload adapters**, x402 being substrate #1.
- `SEAT_ANALYSIS.md` — corrected: the router seat is **contested, not vacant** [public 2026]; Seat B is chosen on constraint-elimination + model-proof, not on vacancy.
- `PAYING_ECOSYSTEM_SCORECARD.md` / `MARKET_REJECTION_LOG.md` — the 15-question gate collapses to the **substrate test** (§2); workloads are filtered by fragmentation + value-density on a live substrate.
- `04_EXECUTION/*` — the first milestone is redefined: **not** "first spread event on RPC" but the **substrate census + gate G1–G3**, before any production build.
- `ADR-003` — spread demoted below the float/top-up fee as primary capture.

No other canonical document exists. If a future decision conflicts with this file, this file is amended by an ADR that cites new evidence — it is not silently overridden.
