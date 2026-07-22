# Satelink vNext — Operating System Architecture (Constitution)

> **Status: CANONICAL / FROZEN.** This is the single source of truth for Satelink vNext. Research is closed. Every future engineering task traces to this document. Where any earlier `docs/vNext/` document conflicts, this one wins; superseded documents are archived under `docs/vNext/archive/` (see Supersession Register, §13).
>
> **What Satelink is:** the embedded routing layer for machine commerce — the operating system beneath workloads. RPC, x402, AI inference, DEX routing, storage, bandwidth are **adapters**, not the product. The routing kernel never changes when a workload is added. That invariant is the whole architecture.
>
> **No code.** This is a production-grade architectural specification. Interface sketches are language-neutral contracts, not implementations.

---

## 1. Constitutional invariants (the laws the kernel enforces)

These hold for every transaction, every workload, forever. A design that violates one is rejected.

1. **Kernel depends only on interfaces.** The kernel imports no workload, protocol, rail, or fee concept. Dependency inversion is the structural guarantee behind "add a workload = add an adapter, change no kernel code."
2. **Five phases, nothing else.** Every machine transaction is `DISCOVER → QUOTE → ROUTE → EXECUTE → SETTLE`. Fee capture rides inside SETTLE; reputation update rides in CLOSE. No sixth phase is ever added.
3. **Exactly-once settlement.** Every value movement is idempotent and journaled. A crash, retry, or replay never double-charges or double-pays.
4. **No delivery, no charge; no charge without the option to deliver.** Settlement-in without successful execution is compensated. Fee is captured only on a completed, settled unit.
5. **Fee ≥ 0 by construction; spread ≥ floor by construction.** The kernel refuses any transaction whose fee/spread cannot be non-negative.
6. **Every transaction is reconstructable and every routing decision is explainable** from an append-only journal. No decision-relevant state lives only in memory.
7. **Determinism at ROUTE.** Given the frozen candidate set + policies + context snapshot, the routing decision is reproducible. Live state changes never rewrite a past decision.
8. **Per-adapter isolation.** Every adapter has its own circuit breaker, timeout, rate limit, cap, and kill switch. One failing adapter cannot stall the kernel or another adapter.

---

## 2. The transaction lifecycle (state machine)

The kernel owns one entity — the **RoutingTransaction** — and moves it through a deterministic state machine. Each phase is a guarded transition with a forward action and a compensating action (saga pattern).

```
                     ┌────────────── REJECTED (pre-charge, no money moved)
                     │
CREATED → DISCOVERING → DISCOVERED → QUOTING → QUOTED → ROUTING → ROUTED
                                                                     │
        settlementMode = PRE ┌───────────────────────────────────────┤
                             ▼                                        │ POST / ESCROW
                        SETTLING_IN → SETTLED_IN → EXECUTING → EXECUTED → SETTLING_OUT
                             │              │           │                    │
                        (fail)│         (exec fail → COMPENSATING → refunded) │
                             ▼              ▼                                 ▼
                          FAILED ◄──────────┘                            SETTLED → CLOSED
```

- **Settlement mode is declared by the adapter, not hardcoded.** `PRE` (collect before execute — e.g. pay-to-call rails), `POST` (execute then bill — e.g. metered), `ESCROW` (hold, release on success). The kernel branches generically on the declared mode; it never contains workload-specific ordering.
- **Terminal states:** `CLOSED` (success), `REJECTED` (filtered before any money moved — free), `FAILED` (execution failed after settle-in → compensated to whole), `ABANDONED` (deadline exceeded → compensated). Every terminal state is journaled with a machine-readable reason.
- **Recovery:** a reconciliation worker replays incomplete sagas from the journal after any crash, driving each transaction to a terminal state exactly once.

---

## 3. Routing Kernel — the immutable core

**Responsibilities (and hard boundaries):** own the state machine; orchestrate the five phases by invoking adapter interfaces; enforce all §1 invariants; snapshot decision inputs; emit events. It contains **zero** workload, protocol, rail, or fee logic.

**Consumed interfaces (the only things the kernel knows):**
`WorkloadAdapter`, `DiscoverySource`, `PolicyEvaluator`, `SettlementAdapter`, `FeeAdapter`, `ReputationProvider`, `IdentityResolver`, plus infrastructure ports `Clock`, `IdGenerator`, `Journal`, `EventSink`, `Registry`, `Cache`.

**Idempotency model:** each transaction has a kernel-issued `txId` (monotonic, sortable). A client-supplied idempotency key maps 1:1 to a `txId`, so a retried request re-attaches to the same transaction rather than creating a new one. Every side-effecting adapter call carries `idemKey = H(txId, phase, attempt-invariant-nonce)`; settlement adapters must treat `idemKey` as an exactly-once token.

**Failure handling:** every phase transition is `try-forward → on-success advance → on-failure compensate`. Compensations are themselves idempotent and journaled. The kernel never leaves a transaction in a non-terminal state after its deadline.

**Statelessness:** kernel workers hold no durable state; all state is in the Journal + shared stores. Workers scale horizontally; transactions are partitioned by `txId`. This removes the kernel as a single point of failure or a scaling bottleneck (the Journal store's partitioning is the scaling unit).

---

## 4. Adapter SDK — the universal workload interface

Exactly **one** interface every workload implements. No workload-specific code ever enters the kernel.

```
interface WorkloadAdapter {
  capabilities(): {
     key, resourceTypes[], requestSchema, responseSchema,
     settlementMode: PRE | POST | ESCROW,
     executionSafety: IDEMPOTENT | AT_MOST_ONCE,
     requiredPolicies[], defaultFeePlanRef
  }
  discover(query): CandidateSupplier[]          // DISCOVER
  probe(supplier): HealthSample                  // feeds Discovery/Reputation
  quote(request, supplier): Quote                // QUOTE  {cost, unit, expiry, settlementMode}
  execute(request, supplier, ctx): Result        // EXECUTE (ctx = idemKey, deadline, cancel signal)
}
```

The SDK ships: base classes, schema validation, a **conformance test suite** (an adapter is admissible only if it passes idempotency, failure-compensation, and settlement-mode tests), and registration glue. Building an adapter never requires reading kernel code — only satisfying this contract. `executionSafety` is what lets the Execution Engine decide safely between hedging and sequential failover (§6).

---

## 5. Discovery Layer

**Demand discovery (inbound):** the kernel exposes a single generic ingress; a workload's demand arrives as a normalized request and is matched to a capability. "Discovering demand" = advertising Satelink's routable capabilities (via `.well-known`/manifests) so machines and frameworks embed and call it. Satelink imports demand by being embedded, not by acquiring it.

**Supply discovery (outbound):** `DiscoverySource` adapters pull supplier listings from external registries/indexes or accept push-registration. Each candidate is normalized into a `CapabilityRecord {supplierId, capability, price, region, limits, rail, lastSeen}`.

**Caching & health:** a two-tier cache (L1 in-process hot set, L2 shared store) keyed by capability, with **health as a first-class dimension** — probe results continuously update availability/latency and gate a supplier's routability. Stale or unhealthy records are excluded from routing regardless of price. TTL + health-gating together prevent routing to dead supply.

---

## 6. Policy Engine

Routing decisions are a **composable pipeline of pure evaluators** over the candidate set — no imperative per-workload logic.

```
candidates
  → HARD FILTERS  (capability match, jurisdiction, health, caps, loss-prevention: cost+feeFloor ≤ quotedPrice)
  → SCORERS       (price, latency, availability, reputation, cost, custom…)
  → SELECTOR      (strategy: cheapest | fastest | most-reliable | weighted-composite)
→ RankedDecision {winner, rankedCandidates, scores, rationale}
```

Every dimension the mission names — price, latency, availability, jurisdiction, capability, reputation, health, cost, custom — is a `PolicyEvaluator` plugged into this pipeline. Policies are declarative and hot-swappable. **Loss-prevention is a hard filter, not a preference:** a candidate whose cost exceeds quoted price minus the fee floor is removed, so §1.5 holds structurally. At ROUTE, the candidate set + policy config + context are **snapshotted and journaled**, giving §1.7 determinism and full explainability even as live prices/health move.

---

## 7. Execution Engine

Bounded, safe execution of the chosen route.

- **Retries:** bounded count, jittered exponential backoff, only for retryable errors.
- **Parallel / hedged execution:** race N candidates for latency-critical work, first success wins, losers cancelled — **permitted only when `executionSafety = IDEMPOTENT`**; otherwise strictly sequential failover.
- **Fallback:** on failure, fail over to the next-ranked candidate **within a cost budget** so margin/spread can compress to zero but never go negative (§1.5).
- **Circuit breaker:** per `(supplier, adapter)`, closed → open → half-open, driven by the health store.
- **Rate limits & timeouts:** per supplier, per resource, and global; per-phase deadlines with hard cancellation.
- **Replay prevention:** the execution journal + `idemKey` guarantee a retried transaction never double-executes a non-idempotent upstream.

---

## 8. Settlement Engine

A **generic** value-movement interface. The kernel never assumes blockchain, fiat, or any specific rail.

```
interface SettlementAdapter {
  capabilities(): { modes:[PRE,POST,ESCROW], units[], finality: INSTANT|PROBABILISTIC|DELAYED }
  settleIn(amount, unit, payer, idemKey): SettlementRef
  settleOut(amount, unit, payee, idemKey): SettlementRef
  hold(amount, unit, idemKey) / release(ref, idemKey) / refund(ref, idemKey)   // ESCROW
  verify(ref): SettlementStatus
}
```

- **Both directions, exactly once:** `idemKey` + a settlement journal + a reconciliation pass make every settlement exactly-once across crashes.
- **Finality-aware:** the SETTLE phase waits according to the adapter's declared finality model; the kernel does not hardcode confirmation logic.
- **Compensation:** a `PRE` settle-in with a later failed execute triggers `refund`/reversal — the compensating action of the saga.
- x402, ERC-20, a card PSP, or an internal ledger are each **just a settlement adapter**. Adding a new rail changes no kernel code.

---

## 9. Fee Engine — Satelink's business, made generic

Fee logic is **entirely** in `FeeAdapter`s. The kernel executes a fee, it never computes one.

```
interface FeeAdapter {
  plan(): { model: BPS | FIXED | PERCENTAGE | SPREAD | HYBRID | SUBSCRIPTION | DYNAMIC }
  computeFee(quote, context): FeeInstruction {
     amount, unit, recipient,
     capture: IN_MARKUP | OUT_SKIM | SEPARATE | SPREAD
  }
}
```

- The `FeeInstruction` is a **declarative object** the kernel hands to the Settlement Engine — this keeps Fee adapters and Settlement adapters orthogonal (a fee model works over any rail).
- **The embedded routing toll (the business):** the Adapter SDK injects a default protocol-level fee recipient (a "powered-by-Satelink" bps) unless an integrator overrides it — this is exactly the mechanism that pays 0x/Jupiter/OpenRouter, made kernel-generic. Because it settles inside the same atomic settlement as the transaction, capture is automatic and needs no human.
- **Invariant enforcement:** the kernel validates every `FeeInstruction` against §1.5 (fee ≥ 0; SPREAD ⇒ `amount_in ≥ cost_out + floor`) before executing it, and captures it idempotently (§1.3).

---

## 10. Reputation Engine

Cross-workload, portable, protocol-independent scoring — an underwriting function that protects fee and delivery quality, consumed by the Policy Engine.

- **Identity:** scores key on a normalized `SupplierIdentity` resolved by a pluggable `IdentityResolver`, scoped per `(identity, capability)` to prevent cross-domain leakage while allowing portability where identities genuinely link.
- **Signals:** probe outcomes, execution success/latency/correctness, **settlement honesty** (settled == quoted), refund/dispute events. Contributors are pluggable; the scoring model sits behind a `ReputationProvider` interface with rolling windows and a confidence measure.
- **Portability:** the reputation store is independent of any protocol; a supplier that appears under two adapters shares reputation only insofar as the `IdentityResolver` links them, with confidence-weighting for uncertain links.

---

## 11. Observability

The event-sourced spine that makes §1.6 real.

- **Append-only journal:** every state transition, adapter call, decision snapshot, and settlement is an event `{txId, phase, ts, inputsHash, outputsHash, payloadRef}`. Any transaction is fully reconstructable by replay (event sourcing) — this is also the anti-fabrication guarantee: reported numbers derive from the journal, never from a rendered dashboard.
- **Decision provenance:** the ROUTE snapshot (candidates + scores + rationale) is queryable by `txId` — every routing decision is explainable on demand.
- **Metrics & traces:** RED metrics per phase/adapter/supplier; fee captured and margin per transaction; a distributed trace spanning all five phases.
- **Financial truth surface:** spread/fee totals are journal-derived sums with on-rail references, reproducible independently — no metric may exceed what the journal proves.

---

## 12. Plugin System

How an entirely new ecosystem joins with **zero kernel changes**.

- A **plugin** bundles a `WorkloadAdapter` and, as needed, its own `SettlementAdapter`, `FeeAdapter`, `DiscoverySource`, `PolicyEvaluator`s, and `ReputationContributor` — all behind the §3 interfaces.
- **Registration by manifest:** the kernel discovers capabilities at runtime through the `Registry`, not at compile time. Admission is gated by the conformance suite (§4).
- **Isolation & versioning:** per-plugin timeouts, circuit breakers, resource quotas, and an out-of-process option for untrusted plugins; the adapter API is semver'd and the kernel supports version N and N-1.
- **Success criterion (restated precisely and honestly):** adding a workload requires **only adapters** — one `WorkloadAdapter`, plus a settlement/fee adapter only if the workload introduces a genuinely new rail or fee model. **In no case does the kernel change.** If a workload ever forces a kernel change, the architecture has failed and must be corrected, not the kernel patched.

---

## 13. Supersession Register

| Prior document | New status | Why |
|---|---|---|
| `archive/CANONICAL_AUTONOMOUS_REVENUE_ARCHITECTURE.md` | **SUPERSEDED** by this constitution | It was the correct *shape* (Seat B, adapters) but declared itself sole source of truth; this document replaces it and formalizes the kernel. |
| `archive/SUBSTRATE_CENSUS / REVENUE_BIRTH_ANALYSIS / SEAT_VALIDATION_MATRIX / MARKET_KILL_REPORT / GO_NO_GO_DECISION` (Phase 0.2) | **ARCHIVED — obsolete conclusion** | Reached NO-GO under an over-strict "supply nothing" constraint later falsified by `UNIVERSAL_MAP_OF_RECURRING_SOFTWARE_REVENUE.md`. Retained as history only. |
| `archive/INVESTMENT_COMMITTEE_VERDICT / FINAL_EXECUTION_DECISION` (Phase 0.3) | **ARCHIVED — obsolete conclusion** | WAIT verdict, overturned by the same falsification. |
| `archive/REVENUE_ADAPTER_DISCOVERY / TOP_ADAPTER_VERDICT / PRODUCTION_INTEGRATION_PLAN` (Phase 0.4) | **ARCHIVED — obsolete conclusion** | Impossibility proof whose corollary was self-imposed and broke once distribution-by-adoption was allowed. |
| `00_FOUNDATION/UNIVERSAL_MAP_OF_RECURRING_SOFTWARE_REVENUE.md` | **VALID — rationale of record** | The falsification and the "Embedded Routing Toll" derivation that justify this constitution. Kept live. |
| `00_FOUNDATION/MISSION / FIRST_PRINCIPLES / NON_NEGOTIABLE_RULES` | **VALID — subordinate** | Compatible; where they conflict with this document, this document wins. |
| `01_ARCHITECTURE/*` … `06_ADAPTERS/*`, `02–05/*` | **SUPERSEDED — subordinate/illustrative** | Earlier engine designs. This constitution is the architecture; those docs are non-authoritative detail. Where they conflict, this document wins. Not physically archived to bound churn. |

---

## 14. Brutally honest architecture audit

Scored /10. The mission requires iterating until no **structural** weakness remains; the iteration log below is real.

### Iteration log (weaknesses found → resolved)
- **W1 — settlement ordering diversity** (pre/post/escrow) risked kernel branching per workload → resolved: adapter-**declared** `settlementMode`; kernel branches generically (§2).
- **W2 — fee logic leaking into settlement** → resolved: `FeeInstruction` is declarative; Fee and Settlement adapters are orthogonal (§9).
- **W3 — double-execution under hedging on non-idempotent upstreams** → resolved: `executionSafety` gates hedging vs sequential failover (§4, §7).
- **W4 — crash between execute and settle** → resolved: event-sourced journal + idempotent settlement + reconciliation worker replays incomplete sagas (§2, §8).
- **W5 — non-deterministic/unexplainable routing under live price/health drift** → resolved: ROUTE-time snapshot journaling (§6).
- **W6 — kernel as bottleneck / SPOF** → resolved: stateless workers, state in journal, partition by `txId` (§3).
- **W7 — malicious/slow plugin stalling kernel** → resolved: per-plugin isolation, quotas, out-of-process option (§12).
- **W8 — "one adapter" claim overstated** → resolved by honest restatement: only *adapters* ever change, **never the kernel**; a new rail may need a settlement adapter too (§12).

### Scores (post-iteration)
| Dimension | Score | Note |
|---|---|---|
| Extensibility | **10** | adapters all the way down; dependency inversion is structural |
| Revenue capture | **9** | generic Fee Engine + default-fee injection; −1: capture requires being in the settlement path (adapter-provided) |
| Autonomous operation | **9** | saga state machine + reconciliation + breakers; −1: cap/kill-switch changes are deliberate human acts |
| Maintainability | **8** | clean separation, versioned API, conformance suite; −2: event-sourcing + sagas carry real cognitive load |
| Performance | **8** | hedging, caching, stateless scale; −2: per-event journal writes + settlement finality are inherent latency costs (fine for machine commerce, not HFT) |
| Failure isolation | **9** | per-adapter breakers, plugin isolation, saga compensation; −1: shared journal store blast radius, mitigated by partitioning |
| Protocol independence | **10** | kernel knows no protocol; workload/rail/fee all adapters |
| Future-proofing | **9** | the 5-phase model held across every economic event studied; −1: unknown-unknowns |
| Engineering complexity | **7** | inherent to correct settlement; mitigated by the **Minimal Viable Kernel** profile below; honestly the highest-cost dimension |
| Market adaptability | **9** | new ecosystem = plugin; −1: embedding/distribution is go-to-market, not architecture |

### Remaining limitations — and why none is *structural*
- **L1 — cross-protocol identity resolution is best-effort.** Reputation portability is only as good as the `IdentityResolver`. This is a data limitation, not a kernel flaw; the architecture already scopes and confidence-weights it (§10).
- **L2 — settlement latency is bounded by the slowest rail.** Inherent to reality, contained by finality-aware waiting (§8).
- **L3 — engineering complexity.** Mitigated structurally by the **Minimal Viable Kernel**: the kernel is a small state machine + interfaces; event-sourcing may launch as one append-only table, sagas as one recovery worker, with exactly one workload + one settlement + one fee adapter. Complexity is progressive (opt-in via adapters), not upfront — so it is a cost, not a structural weakness.

**Convergence statement:** after the iteration above, no weakness remains that forces a kernel change to add a workload, breaks exactly-once settlement, or makes a decision unexplainable. The three residual items (L1–L3) are inherent-cost or data limitations with contained blast radius, not structural defects. The architecture is declared converged and frozen.
