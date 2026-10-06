# Stage 17 — Order management system

**Branch:** `trading-agent/stage-17-oms`, stacked on Stage 16 (#472).

**Principle:** *never blindly resend; exactly-once intent.* An approved order is written together with its outbox event in one transaction. A single dispatcher sends it with one deterministic client order id. Anything uncertain becomes `UNKNOWN`, which only reconciliation against the venue's order **history** may resolve.

**Code:** `apps/api/src/trading_agent/oms/` (module table in its `README.md`).

**DB:** additive migration `027_oms.sql`. Its down file is `database/migrations-down/027_oms.down.sql` (local/ephemeral only).

**API:** internal only. Nothing is mounted, and nothing runs the dispatcher or reconciler.

## Inspection and STOP evaluation

> STOP if: the existing queue lacks at-least-once + dedupe capability.

**Not triggered.** Re-read audit 02 §3, then the code:

| Candidate | At-least-once | Dedupe | In production? |
|---|---|---|---|
| **Financial-OS transactional outbox**: `outbox` (migration 011) drained by `workers/reconciler/src/outbox-publisher/publish.ts` | **yes**: marked published only after delivery; a crash redelivers | **yes**: deterministic primary key `event_id`, so re-emission is a no-op | **yes** (`satelink-reconciler` on Railway) |
| BullMQ (`apps/api/src/queue/*`, `services/scheduler`) | yes (by library) | `jobId` | **no**: unreachable / no deploy config; would need the shared production Redis |
| In-process timers (`setInterval`, node-cron) | no | no | yes |

**Decision:** reuse the **existing outbox pattern** (at-least-once delivery, dedupe by a unique key, published-after-delivery) on the trading module's **own** `trading_outbox` (021: `idempotency_key UNIQUE`, `status`, `attempts`, `next_attempt_at`).

The Financial-OS `outbox` and its publisher are **untouched**, so existing queue semantics are unchanged (brief §7). No BullMQ and no Redis are used. The claim is `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, which also pushes `next_attempt_at` forward as a **lease**, so a crashed worker's event is re-claimed after the lease.

**Transaction helpers:** the repo has a `pg_adapter.js` transaction wrapper and per-module `BEGIN` / `COMMIT` blocks. To stay self-contained, like Stages 13–16, the OMS store owns its transactions (`PgOmsStore.transaction`, and an atomic in-memory equivalent for tests).

## States and transitions

| OMS state | `orders.status` | Meaning |
|---|---|---|
| NEW | `approved` | accepted (mandate + risk); outbox event pending |
| SENT | `submitted` | **written before** the broker call (write-ahead); may or may not be at the venue |
| ACK | `acknowledged` | the venue has it (`pending_new` / `acknowledged`) |
| PARTIAL | `partially_filled` | partial fills; repeated updates allowed |
| FILLED | `filled` | terminal |
| CANCELLED | `cancelled` | terminal (venue cancel / expiry, refused at dispatch, or mandate revoked) |
| REJECTED | `rejected` | terminal (definitively not placed, or the venue rejected it) |
| UNKNOWN | `unknown` (new in 027) | outcome unknowable (timeout, AMBIGUOUS, unexpected error); **never resent by the dispatcher** |
| CANCEL_REQUESTED | `cancel_requested` | Stage 16 revoked the mandate while the order was at a broker; the reconciler sends the cancel |

| From | Legal next states | Why |
|---|---|---|
| NEW | SENT · CANCELLED · REJECTED | dispatch · authority gone at dispatch / Stage 16 revoke · never sendable |
| SENT | ACK · PARTIAL · FILLED · CANCELLED · REJECTED · UNKNOWN · NEW · CANCEL_REQUESTED | submit result · timeout / ambiguous · **definitive** NOT_PLACED (retry) or proven absent · Stage 16 |
| UNKNOWN | ACK · PARTIAL · FILLED · CANCELLED · REJECTED · NEW · CANCEL_REQUESTED | reconciliation found it · proven absent after the grace window (re-queued, same client id) |
| ACK | PARTIAL · FILLED · CANCELLED · REJECTED · CANCEL_REQUESTED · UNKNOWN | venue progress · vanished at the venue after grace (manual review) |
| PARTIAL | PARTIAL · FILLED · CANCELLED · CANCEL_REQUESTED · UNKNOWN | more fills · … |
| CANCEL_REQUESTED | CANCEL_REQUESTED · CANCELLED · FILLED | cancel pending / done · filled first |
| FILLED / CANCELLED / REJECTED | — | terminal, frozen |

**Broker → OMS mapping:**

| Broker status | OMS state |
|---|---|
| `pending_new`, `acknowledged` | ACK |
| `partially_filled` | PARTIAL |
| `filled` | FILLED |
| `pending_cancel` | CANCEL_REQUESTED |
| `cancelled`, `expired` | CANCELLED |
| `rejected` | REJECTED |
| `unknown` | UNKNOWN |

Snapshots apply **forward-only** and **idempotently**: re-applying the same snapshot writes nothing, and a stale one is ignored.

**The same table is enforced in Postgres** by the 027 trigger `oms_orders_guard`, plus the Stage 16 cancellation edges and pre-OMS `proposed` edges. A unit test parses the SQL block and asserts it equals the JS table (no drift).

The trigger also keeps identity immutable (including `client_order_id`, so a resend can never get a new id), freezes terminal orders, forbids filled quantity going down, and blocks DELETE.

## Flow

1. **Acceptance** (`OrderAcceptanceService.accept`):
   1. an existing idempotency key returns the same order (no second risk decision, no second event; a concurrent race returns the winner);
   2. **mandate** (`verifyForOrder`, Stage 16);
   3. **risk APPROVE that was recorded** (Stage 15);
   4. the venue must be exactly-once capable (`IDEMPOTENT`, client order id, query by client id);
   5. **one transaction:** order (NEW) + `order_events` 'accepted' + `trading_outbox` 'order.place'.

   It never calls a broker.
2. **Dispatcher** (`OrderDispatcher.runOnce`), the **only `adapter.placeOrder` caller** (static test: exactly one call site in `trading_agent/**`):
   1. **Claim** one event with a lease. If the order is no longer NEW / SENT → complete it as a no-op (duplicate events are idempotent).
   2. **Re-delivery or already SENT** → **reconcile first**: look the client id up in venue history.
      - Found → record it, done.
      - Not found, and the order *may have been sent* (SENT) → wait until `notFoundGraceMs` after `sentAt` (eventual consistency).
      - Lookup error → defer.
   3. **Re-check authority:** the mandate still verifies with the same terms hash, plus an optional guard (e.g. a kill switch). If not → CANCELLED, nothing sent.
   4. **Write-ahead SENT**, compare-and-set on status **and send generation** (`dispatch_count`).
   5. **Exactly one `placeOrder`** with a dispatcher timeout, then:
      - PLACED → record;
      - `DUPLICATE_CLIENT_ORDER_ID` → *it exists*: look it up and record;
      - retryable NOT_PLACED → NEW, backoff retry with the **same client id** (after `maxAttempts` → REJECTED);
      - other NOT_PLACED → REJECTED;
      - AMBIGUOUS / timeout / unexpected → **UNKNOWN**.
3. **Reconciler** (`OrderReconciler.runOnce`), over SENT (past `sentGraceMs`), UNKNOWN, ACK, PARTIAL and CANCEL_REQUESTED, by client id from **history** (a filled order is not "open" but still exists):
   - Found → apply the snapshot.
   - Not found → absent only after `notFoundGraceMs`. The order is then re-queued as NEW with a new outbox event and the **same client id**, compare-and-set on the send generation.
   - An order the venue **ever acknowledged** is **never** re-queued if it vanishes: it stays UNKNOWN for manual review.
   - CANCEL_REQUESTED orders still working at the venue get one cancel request per cycle.

**No SDK auto-retry on order POST:** there's exactly one `placeOrder` per dispatch attempt and no retry around it (static test: one call site). The adapter contract (README) requires real venue HTTP / SDK clients to disable automatic retries for order POSTs. Only MockBroker and test venues exist today; real adapters are a later, B-08 / B-09-gated stage.

**Timing invariants**, checked in the constructor: `leaseMs > 2 × submitTimeoutMs` (a claim outlives the call it guards) and `notFoundGraceMs > submitTimeoutMs`. Defaults are 30 s / 10 s / 120 s. **Assumption:** the venue's lookup visibility lag and in-flight latency are below `notFoundGraceMs`.

## Venue client-order-id rules

`clientOrderIdFor(orderId, venue, capabilities)` = `sl` + sha256(order id) as hex, deterministic, so every resend reuses it. Length = min(venue rule, adapter `clientOrderIdMaxLength`, 32):

| Venue | Rule | Length used |
|---|---|---|
| Binance (newClientOrderId) | ≤ 36 | 32 |
| Upstox (order tag) | ≤ 20 | 20 |
| Alpaca (conservative) | ≤ 48 | 32 |
| mock | ≤ 64 | 32 |

Venues allowing fewer than 18 characters are refused. 20,000 ids at 20 chars produced no collisions, and every id passes the Stage 10 request validator.

## Migration 027

- **orders:**
  - `status` CHECK widened with `unknown`;
  - new columns: `risk_decision_id`, `mandate_terms_hash`, `venue`, `filled_quantity` (≤ quantity, never decreasing), `avg_fill_price`, `sent_at`, `acknowledged_at`, `unknown_since` (required for `unknown`), `last_reconciled_at`, `reconcile_attempts`, `dispatch_count`, `last_error`;
  - a reconcile index and the `oms_orders_guard` trigger.
- **trading_outbox:** `last_error`, plus an aggregate index.
- **Rollback order:** 027 alters 021 tables, so the 021 round trip now rolls back `027 → 026 → 025 → 024 → 021`. The 027 down migration fails while any order is `unknown` (resolve those first).

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-06 (no staging) | yes (migration 027) | applied only to local ephemeral Postgres; nothing deployed or scheduled |
| B-07 (migration tooling) | yes | additive 027 via the canonical runner; rollback order documented |
| B-08 (KMS / isolated execution / static egress) | **constrains** | the dispatcher only runs against MockBroker / test venues. A real adapter needs an isolated execution service with KMS-held credentials and static egress |
| B-09 (scope / legal) | **constrains** | no venue integration; live orders still blocked upstream (risk check 3 `LIVE_TRADING` LOCKED; Stage 16 mandates) |
| B-03 / B-10 | no | not mounted |
| B-01, B-02, B-04, B-05, B-11 | no | — |

No blocker changes status. The Stage 17 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-05)

| Suite | Result |
|---|---|
| `apps/api/test/trading_oms.test.js` (mocha) | **28 passing** (includes the 1,000-run acceptance) |
| Integration, local Postgres 16 (guard-DB recipe): `trading-oms` (6 new) + mandates + risk + backtests + strategy DSL + agent traces + market data + foundation (021 round trip rolls back 027 → 026 → 025 → 024) | **32 passing**; temporary DBs dropped, none left behind |
| `scripts/ci-baseline-check.sh` (×2) | **746 tests / 626 pass / 2 known failures / 118 pending**, both runs clean (+28/+28 vs Stage 16) |

### Brief acceptance mapping (§11–12)

**Acceptance: zero duplicate broker orders across 1,000 randomized injected-failure runs.** The test venue is deliberately **unforgiving**, with Binance-like semantics:
- a duplicate client id is rejected **only while the earlier order is open**, so a blind resend after a fill creates a real second order;
- orders become visible to lookups only after a random lag (up to 80 % of the grace window).

Each run has 1–4 orders and some duplicate submissions and outbox events. 120 random steps then mix:
- single and **concurrent** dispatchers, and dispatchers racing the reconciler;
- crashes at 4 points (12 %);
- per call: 15 % timeout-after-accept, 10 % timeout-before-accept, 8 % rate limit, 5 % reject, 15 % immediate fill;
- 10 % lookup errors;
- venue-side fills;
- clock jumps up to lease + grace.

A chaos-free drain follows. Results:
- **0 duplicates.**
- **Every order converged:** its OMS state equals the venue's, or it is REJECTED when the venue never had it.
- The chaos really forced re-sends: `placeOrder` calls outnumbered orders.

**The randomized runs found a real bug, which is fixed.** The first full run found **3 duplicates** (seeds 15, 647, 688):
- **What happened:** two dispatchers held *different* outbox events for one `SENT` order. Both saw "not found" after the grace window and both re-marked it `SENT → SENT`. That compare-and-set checked only the status, so both sent; the first send filled at once, and the venue accepted the second.
- **Fix:** every send-enabling compare-and-set (dispatcher resend, re-queue to NEW, NOT_PLACED retry) also pins `dispatch_count`.
- **Proof:** the three seeds pass, there's a dedicated regression test, and removing the pin fails the suite.

**MockBroker failure injection (§11):**
- **timeout-after-accept → a single order:** UNKNOWN, never resent by the dispatcher; the reconciler finds it, for exactly 1 broker order. With MockBroker's own scenario too.
- **Crash between the write and the send → recovered:** crashes after claim and after write-ahead SENT; after the lease, sent exactly once. For SENT, only after the grace window.
- **Crash after the venue accepted but before recording:** reconciled, `placeCalls = 1`.
- **Duplicate event is idempotent:** a duplicate outbox key is refused; a second event is a no-op; repeated broker snapshots write nothing; stale snapshots never move an order backwards.
- **Also covered:**
  - happy paths (ACK / FILLED / PARTIAL / REJECT);
  - three racing dispatchers on one event;
  - retryable NOT_PLACED backoff with the same client id, ending REJECTED at `maxAttempts`;
  - a hung broker call ends UNKNOWN (`DISPATCH_TIMEOUT`);
  - a revoked mandate or engaged guard at dispatch ends CANCELLED with nothing sent;
  - `DUPLICATE_CLIENT_ORDER_ID` is recorded as existing;
  - the reconciler's grace window then re-queue with the same id;
  - history lookup finds a filled order;
  - a vanished acknowledged order is never resent;
  - CANCEL_REQUESTED orders are cancelled at the venue.
- **Acceptance:** one transaction (an injected failure leaves neither order nor event), idempotent keys including a concurrent race, refusals for mandate / risk / unrecorded approval / non-exactly-once venue / mismatched mandate.

**Security (§10):** a static test confirms the dispatcher is the **only** `placeOrder` caller in `trading_agent/**`, with exactly one call site; `oms/**` has no queue library, Redis, `process.env` or network.

**Postgres:**
- acceptance writes order, events and outbox atomically;
- 12 concurrent dispatchers on separate connections send 6 orders exactly once each (`SKIP LOCKED`; duplicate events are no-ops);
- crash recovery through the lease, and UNKNOWN resolved from history;
- every trigger rule, including the Stage 16 edges;
- the down migration.

**Mutation checks** (each change temporarily applied, then reverted). These made the suite fail:
- the race pin removed;
- resend without grace;
- no reconcile before resend;
- UNKNOWN treated as sendable;
- duplicate-id not treated as existing (initially undetected, so a targeted test was added);
- re-queue not pinned;
- re-queue without grace;
- a vanished acknowledged order re-sent.

One mutant ("stale snapshots move backwards") is **equivalent**: the forward-only rank is redundant with the transition table and kept as defence in depth, with an explicit stale-snapshot test.

## Follow-ups (not in this stage)

- **Scheduling** the dispatcher and reconciler (flag-gated, in the isolated execution service, B-08). Real adapters must disable SDK order-POST retries.
- **Fills:** ingest venue fills into `fills` / `positions` (021) from reconciler snapshots (the positions / ledger stage).
- **Stage 16 revocation** doesn't touch `unknown` orders. The reconciler should cancel UNKNOWN orders whose mandate is revoked, once they resolve.
- **Alerting** for failed outbox events, orders stuck UNKNOWN (manual review) and lookup error rates.
- **Venue specifics:** confirm each venue's duplicate-id semantics, visibility lag and client-id limits when real adapters land.

## Rollback

Revert the commit. On a local database, apply `027_oms.down.sql` (before 026 / 025 / 024 / 021 downs).
