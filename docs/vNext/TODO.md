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
