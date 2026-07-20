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
