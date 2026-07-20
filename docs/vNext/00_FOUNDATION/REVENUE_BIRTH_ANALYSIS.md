# Revenue Birth Analysis — Phase 0.2

> **The most important question, isolated:** not where money moves, not who spends it — **where is new recurring revenue *born*?** Then: can Satelink insert itself **without changing that birth event**? If no → reject.

## Where recurring money is born (per ecosystem)

Money is always born at a **metered event** — the atomic unit that a meter counts and a rail charges for. Whoever controls the meter controls the revenue.

| Ecosystem | Birth event (the meter) | Who owns the meter | Can Satelink insert without changing the birth event? |
|---|---|---|---|
| Bitcoin | block found | the protocol | NO — to earn you must *produce* blocks (Seat A, capex+subsidy) |
| Visa | card authorization | the card network | NO — meter is the network; insertion needs a license |
| AWS | metered resource-hour | AWS's billing system | NO — meter is proprietary; you can't read or intercept it without being AWS |
| OpenRouter | model API call | OpenRouter's gateway | NO — the meter is *their* gateway; to own a meter you must *be* the gateway (demand chooses you = marketing) |
| DEX | trade filled | the AMM/auction contract | Only by being a solver (capital) — the meter is on-chain but capture needs inventory |
| **Fiat agentic retail** (ACP) | **completed checkout** | **OpenAI + Stripe** (ACP owns checkout + the 4% meter) [public 2026] | **NO** — the meter is gatekept; OpenAI vets who plugs in |
| **Card agent rails** (AP4M / Visa) | **agent transaction authorization** | **Mastercard / Visa** | **NO** — meter is the network; Visa is even building the *reputation* meter (Agent Score) itself |
| **x402** | **HTTP 402 settlement** | **permissionless** — anyone can post a 402 meter [protocol] | **YES mechanically** — but the meter counts ~nothing real today (birth events are wash trades) |

## The decisive pattern

**A revenue meter is valuable exactly in proportion to how enclosed it is.** This is not incidental — it is causal:

- If a meter is **permissionless and carries real volume**, competitors flood in, fee → 0, and the meter stops being a business. So this state is transient and self-erasing.
- Therefore any meter that **still carries real recurring volume** is one that has been **enclosed** — by a license (Visa), a gatekeeper (OpenAI ACP), a network effect (OpenRouter), or a capital/latency moat (solvers). Enclosure is *why* the revenue persists.
- The only **un-enclosed** meters are the ones **no real volume flows through yet** (x402). They are un-enclosed precisely *because* there is nothing worth enclosing.

**Consequence for Satelink:** the success property requires Satelink to sit at a revenue-birth meter with zero capital and zero sales. Zero-capital/zero-sales access is possible *only* at un-enclosed meters. Un-enclosed meters have no real recurring revenue. Therefore **the set of {meters Satelink can access} ∩ {meters with real recurring revenue} is empty.**

## Can Satelink create its *own* meter instead?

Yes — Satelink can post its own 402 endpoints / list its own aggregated resources (this is the vNext plan). But then Satelink is not *inserting into* existing recurring revenue; it is *originating* a new meter, whose volume is zero until someone routes through it. Getting volume to a new meter is exactly demand-acquisition (marketing) or waiting (hoping demand comes later) — both rejected by the mandate. So "create your own meter" collapses back into the forbidden inputs.

## Verdict of this analysis

Satelink cannot insert into any existing revenue-birth event that carries real recurring revenue **without** either (a) an enclosure-holder's permission (sales) or (b) capital, and cannot originate a new meter without demand-acquisition. **No insertion path satisfies the constraints.** This is the economic core of the NO-GO in `GO_NO_GO_DECISION.md`.
