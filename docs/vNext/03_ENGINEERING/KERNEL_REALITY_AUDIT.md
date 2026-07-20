# Kernel Reality Audit

> **Role:** Principal Production Engineer. **Purpose:** prove, by evidence only, what already exists in the repository for each of the 15 constitutional components before writing a line of the Minimum Viable Kernel. Governed by `../00_FOUNDATION/OS_ARCHITECTURE_CONSTITUTION.md` (frozen). **Bias: maximum reuse** — REUSE > WRAP > BUILD NEW; REPLACE only if impossible.
>
> Verdict key: **REUSE** (≥80% compatible, use as-is), **WRAP** (adapt/reshape existing code behind the constitutional interface), **BUILD NEW** (no usable precedent), **REPLACE** (exists but must be discarded). Every finding cites exact files/classes/tables. No production code was written; this is an audit only.

## Evidence base (verified this session)

- Live app entry: `apps/api/app_factory.mjs` (33 mounts); deploy = merge to main only.
- Deps present: `pino`, `pino-pretty`, `prom-client` [`apps/api/package.json`], `ethers`, `@x402/*`.
- Tests: 21 files under `apps/api/test/` incl. `canonical_json.test.js`, `evm_adapter_receipt_status.test.js`, `x402_rail.test.js`, `futures_escrow_settle.test.js`; baseline `known-failures-baseline.txt`.

---

## Per-component audit

### 1. Routing Kernel
- **Current:** No generic orchestrator exists. Closest is `apps/api/src/nodes/node_aware_router.js` → `class NodeAwareRouter.selectExecutionSource(chain, payload)` — RPC-node selection only, explicitly a decorator over an RPC ExecutionRouter. No 5-phase transaction entity, no `RoutingTransaction`, no `class *Kernel` (grep: zero hits).
- **Compatibility: ~10%** · **Verdict: BUILD NEW** · **Risk: M** · **Effort: M** · **Deps:** Saga State Machine, Journal, Idempotency, Adapter SDK contracts.

### 2. Transaction Journal
- **Current:** Strong precedent — `apps/api/src/core/db/sql/layer26_economic_ledger.sql` defines `economic_ledger_chain` (**append-only, hash-linked**: `txn_id`, `hash_prev`, `hash_current = sha256(canonical_json(entry)+hash_prev)`), backed by `economic_ledger_entries` and integrity table `ledger_integrity_runs`. Hashing primitive `apps/api/src/utils/canonical_json.js` exists and is unit-tested (`canonical_json.test.js`). Scope is economics entries, not phase-events.
- **Compatibility: ~60%** · **Verdict: WRAP** (generalize entry shape to per-phase transaction events; reuse hash-chain + canonical_json verbatim) · **Risk: L** · **Effort: M** · **Deps:** `canonical_json.js` (REUSE).

### 3. Discovery Engine
- **Current:** `apps/api/src/nodes/node_registry.js` → `class NodeRegistry.register({node_id,node_type,region,capacity})` / `.list(status)` — node registration + listing, node-specific. No generic `DiscoverySource`, no capability-record normalization, no supply-crawl. Health probing lives separately (see §5).
- **Compatibility: ~35%** · **Verdict: WRAP** (registration/list pattern → generic `DiscoverySource` + `CapabilityRecord`) · **Risk: L** · **Effort: M** · **Deps:** Adapter SDK contracts.

### 4. Policy Engine
- **Current:** Scattered scorers/filters exist but no composable pipeline: `nodes/node_reputation.js` (score), `nodes/node_aware_router.js` (selection), `economics/pricing_intelligence/price_floor.js` + `economics/pricingGuard.js` (floor/guard filters), `economics/marginCalculator.js`. No `PolicyEvaluator` interface, no hard-filter→scorer→selector pipeline, no ROUTE snapshot.
- **Compatibility: ~30%** · **Verdict: WRAP** (assemble existing scorers/filters as evaluators in a new pipeline) · **Risk: M** · **Effort: M** · **Deps:** Routing Kernel, Reputation, Discovery.

### 5. Execution Engine
- **Current:** `apps/api/src/nodes/node_circuit_breaker.js` → `class NodeCircuitBreaker` with full **CLOSED→OPEN→HALF_OPEN** state machine (`OPEN_DURATION_MS`, `HALF_OPEN_MAX_TRIALS`, `recordSuccess`/`recordFailure`, `_states` Map) — directly reusable. Retries/backoff/timeouts exist only inline per-domain (`core/control_loop/watchdog.js`, middleware); **no generic retry util** (grep found none in `utils/`). No hedged execution, no `executionSafety` gating.
- **Compatibility: ~40%** · **Verdict: circuit breaker = REUSE; retries/hedging/timeouts = BUILD NEW** · **Risk: M** · **Effort: M** · **Deps:** Routing Kernel, Adapter SDK (`executionSafety`), Circuit Breaker (REUSE).

### 6. Settlement Engine
- **Current:** Real adapter substrate — `apps/api/src/settlement/adapters/` (`ISettlementAdapter`, `BaseSettlementAdapter`, `EvmAdapter`, `PolygonUsdtAdapter`, `ShadowAdapter`, `ShadowEvmAdapter`, `SimulatedAdapter`) + `settlement/adapter_registry.js` (`class AdapterRegistry` Map `register`/`get`/`getActive`) + `settlement/settlement_engine.js` + exactly-once primitive `settlement_evm_nonce_lock` (`layer32_evm_settlement.sql`). **But `ISettlementAdapter` is batch-payout-shaped** (`estimateFee`, `createPayoutBatch`, `getBatchStatus`, `cancelBatch`) — **not** the constitution's `settleIn`/`settleOut`/`verify`/`refund`/`hold`/`release`.
- **Compatibility: ~55%** · **Verdict: WRAP** (reshape interface to §8; reuse registry + EVM/Shadow/Simulated adapters + nonce-lock) · **Risk: M** · **Effort: M** · **Deps:** Adapter SDK contracts.

### 7. Fee Engine
- **Current:** Fee/margin math exists but not generic: `economics/marginCalculator.js`, `economics/pricing_intelligence/price_floor.js`, `economics/pricingGuard.js`, `economics/pricing_engine.js` (`class PricingEngine` — `price * multiplier`, trivial), x402 bundle pricing `payments/x402/config.js`. No `FeeAdapter`, no `FeeInstruction`, no model enum (bps/fixed/spread/…), no default-fee injection.
- **Compatibility: ~40%** · **Verdict: WRAP** (existing floor/margin math becomes inputs to a new `FeeAdapter`/`FeeInstruction`) · **Risk: L** · **Effort: M** · **Deps:** Settlement Engine, Adapter SDK.

### 8. Reputation Engine
- **Current:** `apps/api/src/nodes/node_reputation.js` → `class NodeReputation` composite 0–100 from uptime/success/latency with `breakdown`; plus `nodes/reputation_engine.js`. **Node-scoped, not cross-workload/portable**, no `(identity, capability)` keying, no `IdentityResolver`.
- **Compatibility: ~45%** · **Verdict: WRAP** (generalize scoring to `(identity,capability)`; add `IdentityResolver`) · **Risk: L** · **Effort: M** · **Deps:** Journal (outcome signals). *Not required for M1.*

### 9. Plugin Framework
- **Current:** `settlement/adapter_registry.js` `class AdapterRegistry` is a real Map-based register/get registry (REUSE-grade for wiring). No manifest loading, no conformance suite, no versioning (semver N/N-1), no per-plugin isolation/quotas.
- **Compatibility: ~30%** · **Verdict: registry = WRAP; conformance/isolation/versioning = BUILD NEW** · **Risk: M** · **Effort: L** · **Deps:** Adapter SDK contracts. *Not required for M1.*

### 10. Observability
- **Current:** `apps/api/src/monitoring/logger.js` (pino, structured) + `prom-client` dep + `monitoring/snapshot_service.js` + `monitoring/audit_service.js` + `monitoring/network_metrics.js`. Strong logging/metrics base; no per-transaction trace spanning 5 phases, no decision-provenance-by-txId endpoint.
- **Compatibility: ~55%** · **Verdict: logging/metrics = REUSE; per-tx trace/provenance = WRAP** · **Risk: L** · **Effort: S** · **Deps:** Journal (provenance source).

### 11. Event Store
- **Current:** Same substrate as §2 plus replay: `monitoring/replay_engine.js` → `class ReplayEngine.replayWindow({from_ts,to_ts,...})` replays `revenue_events_v2` and recomputes. Tables `revenue_events`, `revenue_events_v2`. **DRIFT (recorded, not fixed):** `revenue_events_v2` is pruned by a retention job (per prior finding, memory: revenue-events-wipe-root-cause) — so it is **not** a valid append-only store; the constitutional Event Store must be genuinely append-only (the `economic_ledger_chain` hash-chain model is the correct precedent, not `revenue_events_v2`).
- **Compatibility: ~55%** · **Verdict: WRAP** (reuse `ReplayEngine` replay pattern + hash-chain; generalize event schema; enforce no-prune) · **Risk: M** · **Effort: M** · **Deps:** Journal.

### 12. Adapter SDK
- **Current:** `ISettlementAdapter` + `BaseSettlementAdapter` + `AdapterRegistry` demonstrate the base-class + registry pattern. **No universal `WorkloadAdapter`** (5-phase: `capabilities/discover/probe/quote/execute`), no conformance test suite, no `settlementMode`/`executionSafety` declarations.
- **Compatibility: ~20%** · **Verdict: pattern = WRAP; WorkloadAdapter contract + conformance suite = BUILD NEW** · **Risk: M** · **Effort: M** · **Deps:** none (contracts are the root).

### 13. Recovery Worker
- **Current:** Worker/cron precedent exists — `core/control_loop/watchdog.js`, `economics/epoch_scheduler.js`, integrity table `ledger_integrity_runs`. **No saga-recovery worker** that replays incomplete transactions from a journal to a terminal state.
- **Compatibility: ~15%** · **Verdict: BUILD NEW** (worker scaffolding reusable; recovery logic new) · **Risk: M** · **Effort: M** · **Deps:** Journal, Saga State Machine. *Not required for M1 happy-path.*

### 14. Saga State Machine
- **Current:** A state machine exists but for a different domain: `apps/api/src/realtime/deployment-state-machine.ts` (deployment lifecycle). Settlement/withdraw status transitions in `settlement/withdraw_service.js`, `settlement/batch_creator.js`. **No transaction saga** with forward+compensating actions over the 5 phases.
- **Compatibility: ~15%** · **Verdict: BUILD NEW** (deployment-state-machine is a structural reference only) · **Risk: M** · **Effort: M** · **Deps:** Journal, Idempotency.

### 15. Idempotency
- **Current:** Per-domain only: `payments/x402/settlement.js` ("x402 settlement already recorded" guard + `ON CONFLICT DO NOTHING`), `settlement_evm_nonce_lock` (per-chain nonce, exactly-once broadcast), `settlement/user_settlement.js` dedup. **No generic kernel idempotency** (`idemKey = H(txId, phase)`) mechanism.
- **Compatibility: ~30%** · **Verdict: WRAP** (existing `ON CONFLICT`/nonce patterns → generic idemKey + dedup store) · **Risk: M** · **Effort: S** · **Deps:** Journal.

---

## Summary table

| # | Component | Compat | Verdict | Risk | Effort |
|---|---|---|---|---|---|
| 1 | Routing Kernel | 10% | BUILD NEW | M | M |
| 2 | Transaction Journal | 60% | WRAP | L | M |
| 3 | Discovery Engine | 35% | WRAP | L | M |
| 4 | Policy Engine | 30% | WRAP | M | M |
| 5 | Execution Engine | 40% | REUSE (breaker) + BUILD NEW | M | M |
| 6 | Settlement Engine | 55% | WRAP | M | M |
| 7 | Fee Engine | 40% | WRAP | L | M |
| 8 | Reputation Engine | 45% | WRAP | L | M |
| 9 | Plugin Framework | 30% | WRAP + BUILD NEW | M | L |
| 10 | Observability | 55% | REUSE + WRAP | L | S |
| 11 | Event Store | 55% | WRAP | M | M |
| 12 | Adapter SDK | 20% | WRAP + BUILD NEW | M | M |
| 13 | Recovery Worker | 15% | BUILD NEW | M | M |
| 14 | Saga State Machine | 15% | BUILD NEW | M | M |
| 15 | Idempotency | 30% | WRAP | M | S |

**Reuse posture:** 0 pure REUSE-whole; strong REUSE parts (circuit breaker, canonical_json, pino/prom, AdapterRegistry, EVM/Shadow settlement adapters, hash-chain ledger). 9 WRAP, 4 BUILD NEW. Nothing marked REPLACE — no existing code must be discarded.

## Recorded architectural drift (do NOT fix — architecture frozen, implementation-only note)

1. `ISettlementAdapter` is batch-payout-shaped, not `settleIn/settleOut/verify/refund` (§8). Reshape at wrap time.
2. Idempotency is per-domain, not kernel-generic (§1.3/§15).
3. `revenue_events_v2` is retention-pruned → violates append-only journal semantics (§11). The Journal must use the `economic_ledger_chain` hash-chain model, never a prunable table.
4. Ledger fragmentation: `economic_ledger_entries`, `ledger_entries`, `reward_ledger`, `epoch_ledger` — multiple stores; the constitutional Journal is one.

---

## THE BUILD ORDER (dependency DAG, not architecture order)

```
        canonical_json.js (REUSE) ┐
                                   ├──► [2] Journal / [11] Event Store (WRAP, append-only hash-chain)
   economic_ledger_chain (WRAP) ──┘                │
                                                    ├──► [15] Idempotency (WRAP: idemKey + dedup)
   [12] Adapter SDK contracts (BUILD NEW) ──┐       │
   (WorkloadAdapter/Settlement/Fee ifaces)  │       ▼
                                            ├──► [14] Saga State Machine (BUILD NEW)
                                            │       │
                                            └──────►├──► [1] Routing Kernel (BUILD NEW)
                                                    │        │ invokes via interfaces:
                                                    │        ├─ [3] Discovery (WRAP, stub for M1)
                                                    │        ├─ [4] Policy (WRAP, trivial single-candidate for M1)
                                                    │        ├─ [5] Execution (REUSE breaker; stub exec for M1)
                                                    │        ├─ [6] Settlement (WRAP; reuse ShadowAdapter for M1)
                                                    │        └─ [7] Fee (WRAP; fixed FeeInstruction for M1)
                                                    ▼
   [10] Observability (REUSE pino/prom) ◄── Journal
   [13] Recovery Worker (BUILD NEW) ◄── Journal + Saga         (post-M1)
   [8]  Reputation (WRAP) ◄── Journal outcomes                 (post-M1)
   [9]  Plugin Framework (WRAP+NEW) ◄── Adapter SDK            (post-M1)
```

**Critical path to a running transaction:** `canonical_json → Journal → Idempotency → Adapter SDK contracts → Saga State Machine → Routing Kernel → (5 phase stubs)`. Nothing on the critical path depends on Reputation, Recovery Worker, or Plugin Framework — those are post-M1.

---

## Milestone M1 — smallest code change to execute ONE complete machine transaction through the kernel

**Question answered:** the minimum is a kernel that drives a single `RoutingTransaction` through `DISCOVER → QUOTE → ROUTE → EXECUTE → SETTLE` to `CLOSED`, journaled, idempotent, saga-guarded — using only kernel scaffolding and existing REUSE parts, **no workload/rail-specific code** (per rules).

**Smallest change set (all new files under `apps/api/src/vnext/kernel/`; zero change to existing kernel-external code):**
1. **Adapter SDK contracts** — define `WorkloadAdapter`, `SettlementAdapter`, `FeeAdapter` interfaces (contracts only).
2. **Journal** — one append-only table + append/read, reusing `utils/canonical_json.js` for `hash_current` (adapt the `economic_ledger_chain` shape to per-phase events).
3. **Idempotency** — `idemKey = H(txId, phase)` + a dedup guard (adapt the existing `ON CONFLICT DO NOTHING` pattern).
4. **Saga + Kernel** — the 5-phase state machine that journals each transition and compensates on failure.
5. **Three reference test doubles (kernel scaffolding, NOT workload adapters):** an echo `WorkloadAdapter` (discover→1 candidate, quote→fixed cost, execute→echo), the existing `ShadowAdapter`/`SimulatedAdapter` as the `SettlementAdapter` (no money moves), and a fixed `FeeInstruction`.
6. **One test** (sibling to `apps/api/test/`): drive one transaction to `CLOSED`; assert the journal contains all five phase events, exactly-once settlement, and a reconstructable decision.

**Definition of done:** the test passes, the baseline `known-failures-baseline.txt` count is unchanged, and adding a *second* (hypothetical) echo adapter would require **zero** kernel edits — the structural proof of the constitution's success criterion. M1 touches no x402/RPC/AI/DEX code and ships no real workload.
