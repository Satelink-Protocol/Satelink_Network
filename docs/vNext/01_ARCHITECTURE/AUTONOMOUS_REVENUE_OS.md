# Autonomous Revenue OS — Master Architecture

> The one-page system view. Every other document in `01_ARCHITECTURE/` details one box on this page.

## System diagram

```
                    ┌──────────────────────────────────────────────────┐
                    │              ADAPTER LAYER (06_ADAPTERS)         │
                    │  workload adapters: RPC, AI inference, search…   │
                    │  rail adapters:     x402/Base, ERC-20/Polygon    │
                    └───────┬──────────────────────────────┬───────────┘
                            │ demand side                  │ supply side
┌───────────┐   ┌───────────▼───────────┐      ┌───────────▼───────────┐
│  paying   │──▶│  DEMAND IMPORT ENGINE │      │  SUPPLY IMPORT ENGINE │◀── existing
│  machines │   │  offers, discovery,   │      │  crawl listings,      │    suppliers
│ (agents)  │   │  402 challenges       │      │  probe, price, index  │
└───────────┘   └───────────┬───────────┘      └───────────┬───────────┘
                            │ priced request                │ supplier index
                            ▼                               ▼
                ┌───────────────────────────────────────────────────────┐
                │                    ROUTING ENGINE                     │
                │   per-request supplier selection: price × health ×    │
                │   latency × reputation; self-supply has no privilege  │
                └───────────┬───────────────────────────────────────────┘
                            │ chosen supplier + quoted prices
              ┌─────────────┼─────────────────┐
              ▼             ▼                 ▼
     ┌───────────────┐ ┌──────────────┐ ┌──────────────────┐
     │ PRICING ENGINE│ │ SETTLEMENT   │ │ REPUTATION ENGINE│
     │ P = C + spread│ │ ENGINE       │ │ probe + outcome  │
     │ floor-clamped │ │ in: merchant │ │ scoring feeds    │
     │               │ │ out: payer   │ │ routing          │
     └───────────────┘ └──────┬───────┘ └──────────────────┘
                              │ settled pairs (in, out)
                              ▼
                     ┌────────────────┐
                     │  SPREAD ENGINE │  ledger: spread = in − out
                     │  (the P&L)     │  per unit of work, on-chain
                     └────────────────┘  verifiable, is_test_data-clean
```

## Request lifecycle (normative)

1. **Discover** — a machine finds a Satelink resource (Bazaar listing, `.well-known`, or direct 402 challenge). No account, no signup. [protocol: x402 v2]
2. **Quote** — Pricing Engine computes P = supplier cost C (from supply index) + spread; Demand Import Engine answers HTTP 402 with payment requirements for P.
3. **Pay in** — machine retries with `X-PAYMENT`; Settlement Engine (inbound role) verifies/settles via the rail adapter. [code: `apps/api/src/payments/x402/middleware.js` — exists, live]
4. **Route** — Routing Engine picks the supplier for this unit of work from the supply index (self-supply included as an ordinary row).
5. **Pay out + execute** — Settlement Engine (outbound role) pays the supplier via *its* rail and executes the request against it. [gap: outbound payer does not exist in `apps/api` yet — build item #1, see `../03_ENGINEERING/BUILD_SEQUENCE.md`]
6. **Record** — Spread Engine writes one ledger row: request id, in-amount, in-tx, out-amount, out-tx, spread, supplier, adapter, `is_test_data`.
7. **Learn** — Reputation Engine updates the supplier's score from the outcome (success, latency, correctness).

Failure at step 4/5 → refund-or-no-charge per rail semantics; never charge for undelivered work (Non-Negotiable Rule #14).

## Where each requirement is satisfied

| Success criterion | Satisfied by |
|---|---|
| Autonomous recurring revenue | steps 1–7 have no human; recurrence measured per `../02_MARKET_VALIDATION/AUTONOMY_TESTS.md` |
| Existing paying ecosystem | adapter admission test (13 questions) in `../02_MARKET_VALIDATION/PAYING_ECOSYSTEM_SCORECARD.md` |
| Existing suppliers / settlement | Supply Import Engine only indexes already-listed, already-settling suppliers |
| Machine-to-machine execution | x402 challenge/response; no dashboards in the money path |
| No manual routing | Routing Engine is the only router; no per-customer config |
| Adapter-based expansion / reusable core | `CORE_ENGINE.md` + `ADAPTER_SYSTEM.md` interfaces |
| No dependency on RPC success | RPC is supplier row #1, deletable (ADR-002) |
| No dependency on x402 success | rail adapters behind `ISettlementAdapter`-style interface (ADR-001); second rail = ERC-20/RevenueVaultV2 [code: vault live at `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`] |

## Honest constraints (do not delete this section)

- **Phase-1 volume risk is real.** The only ecosystem passing the admission test today is the x402 machine-payment ecosystem, whose measured volume for Satelink is 3 paid calls total [measured, Bazaar activity]. Ecosystem-wide x402 volume: UNKNOWN. The architecture is justified by mechanism-completeness, not by current volume. See `../02_MARKET_VALIDATION/MARKET_REJECTION_LOG.md` for everything rejected.
- **Spread margins on commodity workloads are thin.** Spread per RPC-class call is sub-cent; recurring revenue at meaningful scale requires either volume (UNKNOWN) or higher-value workloads (AI inference adapters, as those merchants appear on machine rails).
- **The core is one Express monolith** [code: `apps/api`]. That is fine for Phase 1–2 and is a deliberate choice (small surface, additive mounts). Extraction into services is a Phase-3 decision made only under measured load.
