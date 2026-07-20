# Seat Validation Matrix — Phase 0.2

> For each surviving-candidate ecosystem, can Satelink occupy *any* of the five seats (router, settlement, reputation, liquidity, supplier-aggregator) and collect fees automatically **without** capital, sales, or marketing? A seat is only "OPEN" if Satelink can enter it with pure permissionless software and start earning on existing flow.

## Legend
- **OPEN** — enterable by permissionless software, earns on existing real flow, no capital/sales.
- **ENCLOSED** — seat exists and earns, but held by an incumbent / requires license or contract (sales).
- **CAPITAL** — enterable but requires capital-at-risk / inventory / liquidity.
- **EMPTY** — seat is un-enclosed and enterable, but no real flow passes through it (earns ~0).

## Matrix

| Ecosystem → Seat ↓ | Fiat agentic retail (ACP/Visa/MC) | LLM inference (OpenRouter) | GPU / spot | DEX order-flow | x402 permissionless |
|---|---|---|---|---|---|
| **Router / aggregator** | ENCLOSED (OpenAI/agent apps own the router seat; Visa building Registry) | ENCLOSED (OpenRouter holds it; new = marketing) | ENCLOSED / CAPITAL | CAPITAL (solver) | **EMPTY** (open, no real flow) |
| **Settlement layer** | ENCLOSED (Stripe/card networks; license) | ENCLOSED | ENCLOSED | on-chain (protocol) | ENCLOSED (CDP facilitator) |
| **Reputation layer** | ENCLOSED (Visa Agent Score, Mastercard trust rails [public 2026]) | ENCLOSED | ENCLOSED | **EMPTY** (open, but scores nothing that trades) | **EMPTY** |
| **Liquidity layer** | CAPITAL (front settlement float) | CAPITAL | CAPITAL | CAPITAL | CAPITAL |
| **Supplier aggregator** | ENCLOSED (merchants gatekept in ACP) / UCP self-publish exists but earning needs PSP path | ENCLOSED | CAPITAL | CAPITAL | **EMPTY** (can aggregate, nothing to aggregate demand for) |

## Reading the matrix

There is not a single **OPEN** cell in the entire grid.

- Every seat that touches **real flow** is **ENCLOSED** or **CAPITAL**.
- Every seat that is **enterable by permissionless software** is **EMPTY** (x402 column, and the x402-analog rows) — open precisely because no real flow passes through it.

The two states never coincide. "Can Satelink become the router / settlement / reputation / liquidity / supplier-aggregator?" answers:
- On rails with real demand: **No** — the seat is taken or gated (sales/capital).
- On rails Satelink can freely enter: **Yes, but the seat is empty** — earning ≈ 0 until demand arrives (waiting = rejected).

## The two secondary questions the mandate asks

- **"Would the ecosystem continue if Satelink disappeared?"** — YES for every ecosystem. Good (no platform risk to them) but also means Satelink is never structurally necessary; it must earn purely on marginal value-add, which the enclosure holders already provide.
- **"Would both sides willingly keep Satelink?"** — Only if Satelink measurably improves economics *net of its fee*. On enclosed rails, the incumbent already captures the aggregation/settlement/reputation value, so Satelink's marginal improvement is ~0. On the empty rail, there are no "both sides" yet to have a preference.

## Conclusion

No seat is OPEN on any real-flow ecosystem. The seat-validation attack confirms the revenue-birth finding from a different angle: **Satelink's constraint set admits only EMPTY seats.** Proceed to `MARKET_KILL_REPORT.md` for why this is structural and permanent under the stated constraints.
