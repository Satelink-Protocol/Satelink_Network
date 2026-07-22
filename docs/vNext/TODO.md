# vNext TODO (build-mode issue log)

Deferred refinements found during BUILD MODE. Logged, not acted on — building continues; the constitution/kernel are not edited to chase these.

- **M2 / kernel contract:** the kernel passes only `(cost, unit, payer, idemKey)` to `settleIn` and only `(request, supplier, {idemKey})` to `execute`; it does not thread the full quote (payTo/network/resource) or the SETTLE_IN payment proof into EXECUTE. The x402 adapter pair works around this with a shared `X402Context` keyed by txId, and the x402 settlement target is adapter-configured (from `getX402Config()`), validated against the quote. This is sufficient for single-merchant purchase. If per-transaction multi-merchant targeting is ever needed, prefer a quote-context passing convention at the adapter layer — do NOT edit `kernel.js`.

- **M3 / DecisionEngine kernel seam:** ~~deferred~~ **RESOLVED** — the kernel was intentionally unfrozen and now injects an optional `decisionEngine` + `policy`. QUOTE quotes all candidates; ROUTE calls `decisionEngine.select()` (rules stay only in M3); winner drives EXECUTE/SETTLE. Absent the engine, the kernel keeps the M1 single-candidate path (backward compatible). See `test/vnext_wired_m3_m5.test.js`.

- **M5 / FeeEngine kernel seam:** **RESOLVED** — the kernel injects an optional `feeEngine` + `feePolicy` and, post-execution on success, runs a FEE phase computing the `FeeInstruction` (journaled once in the tx timeline via `_phase`, idempotent on replay). The kernel still computes no revenue itself. Absent the engine, the legacy `fee.computeFee(quote, ctx)` path at ROUTE is unchanged.

## Review findings (M1-M5 hostile review)

Fixed (were defects):
- **C1 (CRITICAL) idempotency TOCTOU / double charge:** `IdempotencyStore.once()` checked `has()` then `await fn()` then `set()` — two concurrent same-txId callers both ran `fn` (proven: `settleOut` ran twice). Fixed by caching the in-flight promise synchronously, evicting on rejection. Regression: `test/vnext_kernel_concurrency.test.js`.
- **C2 (state corruption) default txId collision:** `tx_${clock}` merged two distinct no-txId requests in the same ms (proven: B received A's result). Fixed with a per-instance monotonic counter.
- **C3 (operational) heartbeat reviving operator-disabled supplier:** `heartbeat()` revived ANY offline supplier; now only `offlineReason==='stale'` auto-recovers.

Open risks (non-blocking, in-memory MVP scope — not defects to fix now):
- Unbounded in-memory growth: Journal `_events`/`_byTx`, IdempotencyStore `_results`, registry/ledger indexes grow without bound. Acceptable for MVP; the pg-backed journal binding (audit) must add retention/compaction before long-running production.
- Journal records full phase payloads (execute response bodies, etc.) — size/PII exposure; redact or store digests when binding to durable storage.
- Failure path under concurrency may append duplicate terminal (COMPENSATING/FAILED) journal markers (no financial impact — compensations are `fresh`-gated so refunds run once).

## M6 Production Reliability — status + residual risks

Delivered (all tested; PG tests run against a local throwaway `vnext_m6_test`, never prod `DATABASE_URL`):
- Persistent hash-linked journal (`vnext_journal`) with deterministic replay across restart.
- Persistent exactly-once idempotency (`vnext_idempotency`, PK/ON CONFLICT) surviving restart.
- Durable supplier registry (`vnext_suppliers`) via composition wrapper (M4 logic unmodified) + rehydrate on load.
- Recovery worker: resumes SUBMITted-but-non-terminal transactions; idempotent phases mean settled effects never repeat.
- Dead Letter Queue (`vnext_dlq`) for transactions that can't terminate within retry limits.
- Retry policy: exponential backoff + jitter + capped attempts (deterministic via injectable rng).
- Crash-recovery proven at DISCOVER/QUOTE/EXECUTE and PRE-mode settle-in; single settlement across crash+recovery.

Justified kernel changes (reliability, not business logic): `_phase` now uses `idempotency.run()` (atomic freshness, no check-then-act gap) and awaits the journal append so a durable write commits before the phase returns; terminal journal writes in the catch block are awaited. All 67 vnext tests green.

Residual production risks (not yet addressed):
- **Registry mutation durability under HealthMonitor:** `HealthMonitor.evaluate()` calls `registry.updateHealth()` without awaiting; with the durable wrapper the in-memory state is correct immediately but the DB snapshot write is fire-and-forget. Health is recomputed each sweep, so this self-heals, but a crash in the write window loses only the last health transition (re-derived on next evaluate). Acceptable; revisit if health history must be durable.
- **Journal growth/compaction:** `vnext_journal` is append-only and unbounded; needs retention/partitioning before long-running production (same note as M1 open risks).
- **Full-payload journaling:** execute response bodies persisted verbatim (size/PII); store digests when hardening.
- **Recovery worker is pull-based** (call `recover()` on boot / timer); no leader election, so running it in >1 process concurrently could double-resume — safe (idempotent) but wasteful. Add an advisory lock (`pg_advisory_lock`) before multi-instance deployment.
- **No real fsync/power-loss test:** "crash" is simulated by abandoning in-flight promises + rebuilding from the durable store; true OS-level power-loss durability relies on PostgreSQL's own guarantees (not independently tested here).

## Reliability-wiring (DurableKernel) — defects found & fixed

Wiring the M6 reliability layer into the kernel path (DurableKernel.boot) exposed two real defects, both fixed:
- **ROUTE phase side-effects were lost on replay/recovery.** The DecisionEngine ROUTE branch set `tx.supplier`/`tx.quote`/`tx.decision` INSIDE the memoized phase closure; on a resumed transaction (cache hit) the closure doesn't run, so those fields were undefined and EXECUTE failed. Fixed: the closure now returns `{engine, chosen, decision|fee}` and the kernel derives `tx` fields OUTSIDE it from the (possibly cached) result — replay-safe. Proven by `test/vnext_durable_kernel_m6.test.js` boot-recovery.
- **Hash-chain corruption under concurrent appends.** `HealthMonitor.evaluate()` (sync, fire-and-forget) triggered the durable registry's async `updateHealth` -> an un-awaited `journal.append` that raced the transaction's phase appends; both hashed against the same tail and broke the chain. Fixed by an append-serialization lock in `PersistentJournal.append` (a hash chain is order-dependent and must serialize appends at the source, independent of caller). verifyChain now holds under the full durable path.

`DurableKernel.boot()` is the single durable entry point: rehydrates journal (+ optional supplier registry), refuses to start on an invalid chain, runs one recovery pass BEFORE serving new traffic, then exposes submit()/recover(). Zero kernel edits were needed to inject the durable components; the ROUTE fix is a correctness fix (replay), not a business-logic change.

## Recovery worker on a timer (RecoveryScheduler)

`RecoveryScheduler` runs the RecoveryWorker on a self-rescheduling setTimeout loop:
- Non-overlapping by construction (next sweep scheduled only after the previous settles; concurrent runOnce() dedupes to one in-flight sweep).
- Timer is `unref()`'d, so it never keeps the process alive on its own.
- A failing sweep is captured (onError) and swallowed so the loop continues.
- Injectable timers + `runOnce()` for deterministic tests.

Wired into `DurableKernel`: `startRecoveryTimer({intervalMs})` / `stopRecoveryTimer()` (drains in-flight sweep). `DurableKernel.boot({recoveryIntervalMs})` opts in at boot. Default OFF (caller opts in). Tests: `vnext_recovery_scheduler_m6.test.js` + a DurableKernel timer integration test — a transaction that goes stuck AFTER boot is recovered to CLOSED by a periodic sweep.

Note: this does NOT resolve the multi-instance leader-election risk — running the timer in >1 process still double-sweeps (safe via idempotency, wasteful). `pg_advisory_lock` around a sweep is still the recommended guard before multi-instance deploy.

## Multi-instance double-sweep — RESOLVED (pg_advisory_lock)

`DurableStore.withAdvisoryLock(key, fn)` runs a critical section under a Postgres
session-level advisory lock (`pg_try_advisory_lock` / `pg_advisory_unlock` on ONE
dedicated client; non-blocking — a peer that can't acquire returns {ran:false}
and skips rather than queueing). Memory store models the same via a lock set on
the shared backing. The RecoveryScheduler takes an optional `withLock` and skips
(increments `skipped`) when a peer holds the lock; `DurableKernel.startRecoveryTimer`
auto-enables it whenever the store supports advisory locks (default lockKey 4021).

Proven: two separate pg Pools (two instances) contending on the same key run the
critical section exactly once (maxConcurrent==1), the loser skips cleanly, and the
lock is released afterward. Earlier note about needing this guard before
multi-instance deploy is now addressed.

## DurableKernel wired into app_factory.mjs (gated, additive)

`app_factory.mjs` mounts `/vnext` (admin-gated) via `createVnextKernelRouter(pool)` — 2 additive edits (1 import + 1 mount block), zero existing lines changed, live money path untouched.

Gating (defaults OFF; enabling is a human decision per the non-negotiable rules):
- `VNEXT_KERNEL_ENABLED` (default off): when off the router is fully inert — every route 503s, NO pool access / DDL / kernel boot (proven with an exploding pool in tests).
- `VNEXT_RECOVERY_TIMER_ENABLED` (default off): starts the advisory-lock-guarded recovery timer when on.
- `VNEXT_RECOVERY_INTERVAL_MS` (default 30000).

When enabled: lazily boots a DurableKernel over the app's pool (creates additive `vnext_*` tables via store.init()), rehydrates durable suppliers, and serves `GET /vnext/health` (enabled state, supplier/journal counts, chainValid, recovery-timer status) and `GET /vnext/journal/:txId` (phase timeline). Boot failures are contained (503 on /vnext, never crashes the host app). NO workload adapters and NO submit endpoint yet — money cannot move through this surface; it is lifecycle + observability only. Real adapters + a submit surface are the next deliberate wiring step.

## x402 adapter + /vnext/submit wired (gated, SSRF-safe)

`createVnextKernelRouter` now registers the M2 x402 purchase adapter and exposes `POST /vnext/submit` when `VNEXT_SUBMIT_ENABLED=true` (default off) AND `VNEXT_X402_RESOURCES` (JSON allowlist) is non-empty. Full path: DISCOVER (allowlisted resources) -> QUOTE (real 402 parse) -> ROUTE (M3 cheapest) -> SETTLE_IN (x402 payload) -> EXECUTE (real fetch w/ X-PAYMENT) -> FEE (M5 bps) -> SETTLE -> CLOSED, durable + idempotent.

New env (all default off/zero):
- `VNEXT_SUBMIT_ENABLED` — enables the /submit money path (else 403).
- `VNEXT_X402_RESOURCES` — JSON `[{url,method,supplierId}]` allowlist (only http/https URLs; malformed => empty => x402 path inactive).
- `VNEXT_FEE_BPS` — spread fee in basis points (default 0).

Safety:
- **SSRF-safe:** request `resource` only SELECTS among the allowlist; URLs are never fetched from the request. Off-allowlist -> no_supply/REJECTED, nothing fetched (proven, incl. a 169.254.169.254 attempt).
- **No real broadcast:** X402SettlementAdapter constructs x402 payloads but holds no wallet/keys; real outbound settlement still needs a funded wallet + the outbound flag (M2 residual, NOT wired).
- Admin-gated, idempotent by client key, result body never echoed (only status/paidWith).

Tests: `vnext_submit_endpoint.test.js` (3) — disabled->403, end-to-end buy against a local mock x402 merchant (CLOSED, fee 25 = 2.5% of 1000, full phase timeline), SSRF rejection. Full vnext suite 81/81; app_factory loads clean.

## Outbound settlement wired with wallet + cap flags (OutboundGuard)

`OutboundGuard` is the hard financial safety rail for outbound payments — enforced in code:
- **Kill switch** `VNEXT_OUTBOUND_ENABLED` (default OFF) — disabled => dry-run, no money.
- **Caps** (minor-unit ints, optional): `VNEXT_OUTBOUND_MAX_PER_TX`, `_MAX_PER_HOUR`, `_MAX_PER_DAY` (rolling windows from the durable `vnext_outbound` ledger — survive restart), `_WALLET_FLOOR`.
- **Wallet floor** enforced only with a `balanceReader`; a floor set without one => refuse (never pay blind).
- **Exactly-once** per idemKey (durable ledger, no double-spend on retry).
- **Atomic spend()** — authorize→sign→commit under an internal mutex, so concurrent near-limit spends cannot overshoot a rolling cap (TOCTOU closed; proven: 3×60 against a 100 cap => 1 spent, 2 blocked).

Wired into `X402SettlementAdapter.settleIn` (the outbound leg of x402 purchase) and into the router's x402 submit path via `buildOutboundGuard(store)`.

**Fail-safe by design — SHIPS UNABLE TO MOVE MONEY:** the router constructs the guard from env caps but does NOT construct a key-holding signer. So with `VNEXT_OUTBOUND_ENABLED=true` and no signer, `settleIn` throws `outbound_no_signer` and the tx FAILS before EXECUTE (proven: FAILED, zero rows in `vnext_outbound`). Moving real money requires an operator to (1) fund a dedicated hot wallet (NEVER treasury/legacy signer), (2) inject a signer that holds `VNEXT_OUTBOUND_PRIVATE_KEY`, (3) set the kill switch + caps. No private key is read, logged, or committed anywhere in this code.

Remaining before real mainnet outbound: implement + inject the real x402 signer (port x402-kit client) behind the guard; wire a real `balanceReader` for the wallet floor. The guard/caps/ledger/kill-switch are done and tested (11 guard tests + fail-safe submit test).

## Inbound revenue leg built (fixes audit Blockers 1, 2-partial, 3)

The audit's #1 blocker (no inbound leg / no treasury) is resolved.

- `TreasuryLedger` (durable `vnext_treasury`): THE revenue record. One row per fulfilled resale, exactly-once by txId, revenue = amount_in - cost (spread). `balance('USDC')` = sum of spreads = net revenue. Refuses to book a loss (inbound < cost). Survives restart.
- `InboundSettlement`: issues the x402 402 challenge for price P and verifies the caller's X-PAYMENT. Verifier is injectable (facilitator in prod; mock in tests). No verifier => cannot settle (fail-safe: never serve paid work for free). Underpaid => rejected.
- `POST /vnext/resell` (PUBLIC, payment-gated — the 402 IS the auth; addresses Blocker 3): resolve allowlisted resource -> quote supplier cost C -> price P = C + spread(VNEXT_FEE_BPS) -> no X-PAYMENT: 402 for P -> with X-PAYMENT: verify, CREDIT TREASURY (P-C), then buy upstream (outbound, guarded) + return goods. Idempotent by key.
- app_factory: auth moved to per-route inside the router (/health,/journal,/submit,/treasury admin-gated; /resell public). Live money path untouched.
- New env: VNEXT_INBOUND_PAYTO (Satelink receiving address), VNEXT_FEE_BPS (spread; default 0 = no revenue).

Proven end-to-end (real PG + mock merchant/verifier/signer): 402 for 1025 (cost 1000 + 25 spread) -> caller pays -> treasury books 25 net revenue -> supplier paid -> goods served -> idempotent replay books nothing new. Fail-safe: no verifier -> 402 re-challenge, 0 treasury rows.

Still required for REAL mainnet revenue (operator/eng, not wired — same fail-safe pattern as outbound):
- Inject a real inbound verifier (CDP facilitator verify+settle) so caller USDC actually moves to VNEXT_INBOUND_PAYTO.
- Inject a real outbound signer + fund the wallet (Blocker 4) so the upstream buy actually settles.
- Un-gate /resell is already done; set the enable flags. bps>0 for non-zero spread.
Full vnext suite 102/102; app_factory loads clean.

## Commercial settlement layer — 4 real components built (B1-B4)

All money-boundary code is real; the external service (facilitator/wallet/RPC/token) is the injected boundary (stub in tests, built-from-env in prod, null when unconfigured => fail-safe).

- B1 inboundVerifier (cdp_inbound_verifier.js): real CDP HTTPFacilitatorClient verify+settle. Pins payTo/price/network; underpay/forged/fail-closed guarded. Env: CDP_API_KEY_ID/SECRET.
- B2 outboundSigner (eip3009_outbound_signer.js): real ethers EIP-3009 signature (recovers to wallet, proven). Deterministic nonce from idemKey => on-chain single-use. Env: VNEXT_OUTBOUND_PRIVATE_KEY.
- B3 balanceReader (usdc_balance_reader.js): real ethers balanceOf; enables OutboundGuard wallet-floor; read-error => refuse. Env: VNEXT_OUTBOUND_RPC_URL, VNEXT_OUTBOUND_WALLET_ADDRESS.
- B4 withdrawal (withdrawal.js): real ERC-20 transfer to FIXED VNEXT_WITHDRAW_TO; admin-only POST /vnext/withdraw; capped (VNEXT_WITHDRAW_MAX); exactly-once (claim-before-send). Env: VNEXT_WITHDRAW_TO + outbound key/rpc.

All four wired env-driven into the router; injected overrides for tests. 128/128 vnext tests; app_factory loads clean. No architecture change; kernel frozen.

## GO-LIVE (operator actions to earn the first dollar)
1. Fund a DEDICATED hot wallet with USDC + gas on Base (never treasury/legacy signer).
2. Secrets: CDP_API_KEY_ID, CDP_API_KEY_SECRET, VNEXT_OUTBOUND_PRIVATE_KEY, VNEXT_OUTBOUND_RPC_URL.
3. Config: VNEXT_INBOUND_PAYTO (dedicated receiving addr), VNEXT_FEE_BPS>0, VNEXT_X402_RESOURCES (real merchants), VNEXT_OUTBOUND_MAX_PER_TX/HOUR/DAY, VNEXT_OUTBOUND_WALLET_FLOOR, VNEXT_OUTBOUND_WALLET_ADDRESS, VNEXT_WITHDRAW_TO, VNEXT_WITHDRAW_MAX.
4. Flags: VNEXT_KERNEL_ENABLED, VNEXT_SUBMIT_ENABLED, VNEXT_OUTBOUND_ENABLED = true.
5. Merge PR #278 to main -> Railway deploy.
6. Execute one real POST /vnext/resell; observe vnext_treasury.spread increase; verify recovery after restart.

## M8 — Global Supplier Intelligence Engine (production-readiness report)

Reuses SupplierRegistry (routable state -> findCandidates feeds M3 DecisionEngine unchanged), Journal (deterministic replay), DecisionEngine + Policies (unmodified). Kernel + routing engine: ZERO changes (git diff empty). Registry: +27 additive lines (updateReputation, updateMetadata) — existing methods/behavior untouched; M4 tests still 8/8.

Components (src/vnext/market/):
- health_scorer.js: pure computeHealthScore (availability/success/latency/price-competitiveness), decayReputation (EMA), idleDecay. Deterministic -> replay-safe.
- sources.js: 5 discovery source adapters (Agentic Market, x402scan, Ampersend, Pay.sh, MCP registry) + normalize + createAllSources. Network is the injected fetchFn boundary; defensive parsing skips malformed rows.
- discovery_agent.js: discoverOnce() across all sources; registers into SupplierRegistry (upsert -> routable), records discovery history, journals; one source failing never aborts the round.
- benchmark_agent.js: benchmarkOnce() probes each supplier (injected prober), folds price/latency/availability/reputation-decay back into the registry so DecisionEngine auto-adapts; failed probe degrades + decays. MarketStore is the single journaler (no double-write).
- market_store.js: append-only price/latency/benchmark/discovery history (bounded ring buffers) journaled to `market:<id>`; MarketStore.replay(journal) rebuilds state deterministically.
- market_admin_router.js: GET /market/rankings, /price-history/:id, /latency-history/:id, /benchmark-history/:id, /discovery-history (read-only; mount behind adminAuth).

Integration: discovery -> registry -> findCandidates -> DecisionEngine picks the cheapest/fastest discovered supplier; benchmark changes routing live. Proven in tests.

Metrics:
- LOC added: ~304 (market/) + 28 (registry additive) + 250 (tests) = ~582.
- Reuse: ~292 LOC of reused infra (registry/journal/decision/policies) leveraged unchanged; ~49% reuse ratio for the M8 unit; DecisionEngine/kernel/routing 100% unchanged.
- Tests added: 11 (unit x4, integration x2, replay x1, failure x2, admin x1, compat x1). Full vnext suite 139/139.
- Architecture compliance: PASS — no kernel edits, no routing-engine edits, registry additive-only, DecisionEngine consumes updated candidates with no change.

Remaining risks:
- Source endpoints/response shapes are best-effort (DEFAULT_ENDPOINTS + generic extractors); real Agentic Market / x402scan / Ampersend / Pay.sh / MCP schemas UNVERIFIED against live APIs — normalize() is defensive but per-source field mapping may need tuning against real payloads.
- benchmark prober is injected; a real prober (cheap probe / merchant 402 read, latency measurement) is not wired to a network transport yet.
- MarketStore history is in-memory (bounded ring); durable persistence beyond the journal (pg-backed history table) not added — replay reconstructs from the journal, but long-run history retention needs the pg binding.
- No scheduler wired: discoverOnce()/benchmarkOnce() are call-driven; a timer (reuse RecoveryScheduler pattern) is not mounted — intentional, to keep this call-driven and testable.
- Not mounted into app_factory; admin router + agents are library-only until an operator wires them (same gated pattern as the rest of vNext).

## RPC self-supply workload adapter (revenue activation, Step 1)

`RpcWorkloadAdapter` (src/vnext/adapters/rpc/) makes Satelink's OWN RPC gateway a vNext resale supplier (ADR-002 supplier #1) so the existing RPC firehose can be metered through the vNext x402 rail. settlementMode=POST (self-supply -> no upstream payment leg); executionSafety=AT_MOST_ONCE. discover() = one candidate per supported chain; quote() = non-zero internal cost; execute() proxies the caller's JSON-RPC body to the SAME upstream node the live gateway uses (getPrimaryProvider reused from workloads/rpc_gateway/providers.js), injectable fetch for tests. Write methods (eth_sendRawTransaction) blocked unless allowWrites.

Wired into kernel_router: registered in the x402Active block, gated by VNEXT_RPC_ENABLED (default OFF; VNEXT_RPC_UNIT_PRICE/CURRENCY), injectable (rpcAdapter) for tests. Kernel + routing engine UNTOUCHED (git diff empty). Tests +7 (capabilities/discover/quote/execute/safety/kernel-integration). Full vnext suite 146/146; app_factory loads clean.

Next to fully "meter the firehose": a public payment-gated metered-RPC endpoint (like /resell but passing the JSON-RPC body + chain, workload 'rpc'), + the P0 settle/credit atomicity fix, + lower FREE_TIER_DAILY_LIMIT + advertise x402 in .well-known. The adapter + kernel path are ready.
