# Adapter System

> How Satelink expands to new ecosystems without touching the core. An adapter is admitted by passing a test, not by being interesting.

## Two adapter kinds, deliberately orthogonal

1. **Workload adapters** (`06_ADAPTERS/`): what work is bought and resold (RPC, AI inference, search…). They know request/response schemas, upstream endpoints, and unit economics.
2. **Rail adapters**: how money moves (x402-on-Base today; ERC-20-on-Polygon second). They know challenges, settlement, and verification.

A workload adapter declares which rails its suppliers accept; the core matches. This is what makes "no dependency on x402 success" achievable: if a future supplier class settles via a different machine rail, only a rail adapter is added.

## Admission: the 13-question gate

An ecosystem becomes an adapter ONLY if all thirteen questions in `../02_MARKET_VALIDATION/PAYING_ECOSYSTEM_SCORECARD.md` answer YES with evidence. One NO → entry in `MARKET_REJECTION_LOG.md` instead. No exceptions, including for ecosystems Satelink has already built code for (this gate is why RPC-as-a-product was demoted — it fails Q5, demand cannot import itself through human signup funnels [measured: ~zero conversion despite 8 funnel PRs]).

## Adapter lifecycle

```
PROPOSED → scorecard filled, all 13 evidence-tagged
SHADOW   → discoverSuppliers + probe running; no money moves; quality data accumulates
LIVE     → outbound caps configured, kill switch wired, resource listed for discovery
PAUSED   → kill switch thrown (auto on: error rate, margin breach, cap breach)
RETIRED  → resource delisted; ledger retained forever
```

Every adapter ships with, or does not ship:
- a kill switch env var (default off),
- outbound spend caps (Rule #1),
- a probe that costs ≤ $0.001/run or is free,
- a scorecard document in `06_ADAPTERS/`,
- a measurement plan (which number proves it earns, read on which date).

## Contract with the core

Adapters implement `WorkloadAdapter` (see `CORE_ENGINE.md`). Hard boundaries:

- Adapters never touch the spread ledger, pricing floors, or caps — core-owned.
- Adapters never persuade: `discoverSuppliers()` reads **existing machine-readable listings only** (a Bazaar index, an on-chain registry, a published price sheet). If supply discovery requires emailing someone, the ecosystem fails Q6 and is rejected.
- Adapters never see raw payer identity beyond what the rail exposes (an address). No CRM. (The legacy `machine_crm_core.js` / outreach stack is the anti-pattern [code: archived class].)

## Current adapter roster (2026-07-20)

| Adapter | State | Doc |
|---|---|---|
| RPC (self-supply) | PROPOSED → target SHADOW in Phase 1 | `../06_ADAPTERS/RPC.md` |
| x402 Bazaar resale (generic HTTP resources) | PROPOSED → target LIVE in Phase 1 (this is M1) | `../06_ADAPTERS/CUSTOM_ADAPTER.md` |
| AI inference | REJECTED today, revisit trigger defined | `../06_ADAPTERS/AI_INFERENCE.md` |
| GPU, Storage, Search, Indexing, Compute, Browser automation, Video | REJECTED today, triggers defined | respective docs |

The rejections are the point: the gate must demonstrably reject things, or it is decoration.
