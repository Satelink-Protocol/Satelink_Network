# Stage 18 — Portfolio, P&L and broker reconciliation

**Branch:** `trading-agent/stage-18-portfolio`, stacked on Stage 17 (#473).

**Principle:** *the broker is authoritative.* Positions and P&L come only from venue fills, and they are continuously checked against the broker's own positions. A persistent disagreement auto-pauses the account until a human looks.

**Code:** `apps/api/src/trading_agent/portfolio/` (module table in its `README.md`).

**DB:** additive migration `028_portfolio.sql`. Its down file is `database/migrations-down/028_portfolio.down.sql` (local/ephemeral only).

**API:** internal only. Nothing is mounted, and nothing is scheduled.

## Inspection

- **OMS events (Stage 17):** `order_events` rows of type `broker_status` / `broker_update` are written whenever the OMS records a venue status or fill-quantity change, from the dispatcher (submit result) or the reconciler. These are the consumer's trigger.
- **Fills:** the Stage 10 `adapter.listFills(account, { clientOrderId })` returns normalised fills (fill id, quantity, price, `feeMinor` + currency + decimals, `executedAt`). The 021 `fills` table is append-only and `UNIQUE (order_id, broker_fill_id)`. **`ledger_txn_id` is left NULL**: nothing here touches the ledger (brief §7).
- **Positions:** 021 `positions` is unique per `(broker_account_id, instrument, mode)`.
- **Broker positions:** the Stage 10 `BrokerAdapter` has **no positions or balances call**, so broker snapshots come through an injected port (`brokerPositions.snapshot`). Real adapters must implement it; this stage does not change `brokers/`.
- **STOP:** none beyond the standard ones; nothing triggered.

## P&L method (`pnl.mjs`)

**Average cost**, computed as a deterministic **fold over all fills** of one (account, instrument, mode), sorted by `(executedAt, fillId)`. That makes it independent of arrival order and immune to redelivered fills (deduped by fill id). All arithmetic is 18-dp fixed-point bigint.

| Event | Effect |
|---|---|
| Fill in the position's direction (or from flat) | `avg = (|q|·avg + f·price) / (|q| + f)`; `q += f` |
| Fill against the position | realised += `closed · (price − avg) · sign(q)`; `q` shrinks; flat ⇒ avg = null |
| Fill larger than the position | closes it, then opens the remainder at the fill price (a flip) |
| Fee in the quote currency | realised −= fee; fees += fee |
| Fee in another currency (e.g. BNB) | tracked per currency in `unconvertedFees`; **never** silently converted into P&L |
| Valuation at mark *m* | unrealised = `q · (m − avg)`; net exposure = `q · m`; gross = `|q · m|` |

Amounts are reported as decimals and as integer minor units (half-even).

## Flow

1. **`FillConsumer.runOnce`** reads OMS events after a durable cursor (`portfolio_consumer_cursors`). For each order:
   1. `listFills` from the venue;
   2. idempotent insert into `fills`;
   3. if anything is new, the position is recomputed from all its fills, **in the same transaction** as the inserts.

   If the venue errors, it stops **at** that event: the cursor never skips past a failed event, even when later events would succeed. A crash re-processes harmlessly next run.
2. **`PortfolioSnapshotter.take`** values positions at marks (`marks.mark`, e.g. the Stage 11 mid with purpose `internal_use`). It writes an append-only, hashed `portfolio_snapshots` row. **A stale or missing mark makes that line and the snapshot's unrealised / exposure totals null** (`marks_complete = false`), never a guess.
3. **`PortfolioReconciler.runOnce`** checks tenancy, then compares internal positions with `brokerPositions.snapshot` over the union of instruments:
   - **Tolerance:** max(per-instrument or default absolute quantity, relative bps of the broker quantity).
   - **Outcome:** within tolerance is `match`; otherwise `mismatch`. A broker read error is `error`, since it cannot be confirmed.
   - **Auto-pause:** when `mismatchesToPause` consecutive non-matching checks occur (default 2, because a single read can race an in-flight fill), the account is paused **once per streak**:
     1. **Stage 15 kill switch**, scope `broker_account`, platform actor: every new order on the account is rejected at risk check 1;
     2. **`strategy.auto_paused`** emitted to `trading_outbox` (aggregate `strategy`, idempotency key per event; the OMS dispatcher only claims `order` events, verified in Postgres) and to `audit_events`;
     3. an optional `strategyPauser` hook (e.g. move bound Stage 13 versions to PAUSED).

     If engaging the kill switch fails, the check is recorded as `pause_failed`.
   - **Recording:** every check is appended to `reconciliation_events` (status, streak, action, per-instrument diffs, tolerance).
   - **Releasing is a human decision:** the books agreeing again doesn't release the pause (Stage 15 release rules).
4. **`PortfolioReadService`:** every read takes the caller's `principalId` and filters on it. Another tenant's account is `NOT_FOUND` (no existence leak).

## Migration 028

- **`positions`** (021), additive: `fees_minor`, `fill_count`, `last_fill_at`, `unconverted_fees`; CHECK flat ⇔ `avg_entry_price IS NULL`; a principal index.
- **`portfolio_snapshots`** (NEW, append-only): positions JSONB, realised / unrealised / exposure / fees in minor units, `marks_complete` (⇔ unrealised present), `snapshot_hash`.
- **`reconciliation_events`** (NEW, append-only): status `match` / `mismatch` / `error`, `consecutive_mismatches` (0 ⇔ match), action `none` / `paused` / `already_paused` / `pause_failed` (match ⇒ none), tolerance, details.
- **`portfolio_consumer_cursors`** (NEW): the cursor only moves forward (`GREATEST`).
- **Rollback order:** 028 alters `positions` and references 021 tables, so the 021 round trip now rolls back `028 → 027 → 026 → 025 → 024 → 021`.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-06 (no staging) | yes (migration 028) | applied only to local ephemeral Postgres; nothing deployed or scheduled |
| B-07 (migration tooling) | yes | additive 028 via the canonical runner; rollback order documented |
| B-09 (scope) | constrains | broker positions only through an injected port; no real venue integration |
| B-08 | no | no credentials, no broker calls beyond the MockBroker in tests |
| Ledger / real book (brief §7) | **not touched** | `fills.ledger_txn_id` stays NULL; a static test forbids ledger, billing and settlement imports and writes |
| B-01–B-05, B-10, B-11 | no | — |

No blocker changes status. The Stage 18 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-05)

| Suite | Result |
|---|---|
| `apps/api/test/trading_portfolio.test.js` (mocha) | **19 passing** |
| Integration, local Postgres 16 (guard-DB recipe): `trading-portfolio` (3 new) + OMS + mandates + risk + backtests + strategy DSL + agent traces + market data + foundation (021 round trip rolls back 028 → … → 024) | **35 passing**, stable on 3 consecutive runs; temporary DBs dropped, none left behind |
| `scripts/ci-baseline-check.sh` | clean run: **765 tests / 645 pass / 2 known failures / 118 pending** (+19 tests vs Stage 17) |

**Baseline flakiness, reported honestly:** two other full runs failed timing-sensitive suites outside the known list: `api_keys_security` (rate-limit window and the deposits route) and `identity_rate_limit`. `api_keys_security` passes 19/19 on its own three times. These suites sort before `trading_*`, so they run before any Stage 18 code loads. Full-suite timing flakes have now appeared at Stages 12, 14, 16 and 18, and are worth a separate fix (they are not in this program's scope).

**Integration-test fix carried in this PR:** the Stage 17 concurrency test (`trading-oms.integration.test.ts`) was too strict about how a *losing* dispatcher reports. With real Postgres concurrency, a loser holding a duplicate event may also report `reconciled` or `awaiting_grace` (the order is mid-flight under another worker); neither sends. The safety assertions (6 placed, `dispatch_count = 1`) are unchanged.

### Brief acceptance mapping

- **P&L maths fixtures (§11):** six hand-computed cases:
  - a long build, partial close and flip to short with quote fees: realised 14.52, short 0.5 @ 90, unrealised +5 at a mark of 80;
  - a short partial cover;
  - a round trip to flat (avg null);
  - a weighted-average loss;
  - a BNB fee tracked but never mixed into USDT P&L;
  - half-even rounding of tiny quantities.

  Plus order independence, a redelivered fill counted once, and malformed-fill rejection.
- **Mismatch → pause (§11):**
  - within tolerance → no pause;
  - a single mismatch → recorded, no pause;
  - a second → **paused**: kill switch on `broker_account`, `strategy.auto_paused` in the outbox and audit, hook called, and risk check 1 then stops orders;
  - a third → `already_paused` (not re-engaged);
  - the books agreeing again → `match`, but the pause stays until a human releases it;
  - broker read errors pause after the streak;
  - relative tolerance in both directions, `pause_failed`, and the tenant check.
- **Fill consumer (end to end with the real Stage 17 OMS + MockBroker):**
  - OMS events → fills → position: 0.003 BTC, avg 30000, MockBroker's 10 bps fees → realised −0.09;
  - an idempotent re-run;
  - later fills (partial → more fills via the OMS reconciler);
  - a venue error on the *first* of two orders leaves the cursor at 0 and processes nothing past it;
  - a crash mid-transaction rolls back the fill insert;
  - recovery ingests both orders' fills.
- **Snapshots:** valuation (unrealised 3.00 USDT), hashing, and stale or missing marks → null.
- **Tenant filters (§10):** positions, snapshots and reconciliation events are isolated per principal; another tenant's account is `NOT_FOUND`; a malformed principal is `INVALID`.
- **Not the real book:** a static test confirms `portfolio/**` has no ledger, journal, accounts or revenue writes, no `ledger_txn_id` assignment, and no ledger, billing, settlement or economics imports. In Postgres, every fill has `ledger_txn_id = NULL`.
- **Postgres:**
  - the PgOmsStore + MockBroker → PgPortfolioStore flow (fills, positions, snapshot, reconciliation);
  - PgRiskStore kill switch;
  - the `strategy.auto_paused` outbox row, **ignored by the OMS dispatcher**;
  - audit rows, tenant-filtered queries, append-only grants, CHECKs, and the down migration.
- **Mutation checks** (each change temporarily applied, then reverted). All 12 made the suite fail:
  - short P&L sign;
  - flip keeps the old average;
  - fees not deducted;
  - foreign fees dropped;
  - redelivered fill double-counted;
  - minor rounding;
  - never pauses;
  - streak not accumulated;
  - re-pausing every check;
  - the cursor skipping a failed event (initially undetected, so the test now has a failure followed by a success);
  - stale marks used;
  - tenant filter dropped.

## Follow-ups (not in this stage)

- **A `positions` / balances call on the broker adapter contract** (real adapters), wired as `brokerPositions`.
- **Scheduling** the consumer, snapshotter and reconciler (flag-gated, in the isolated execution service, B-08).
- **A `strategyPauser`** that moves bound Stage 13 versions to PAUSED, a consumer for `strategy.auto_paused` (notifications), and a UI to review and release.
- **FX:** conversion for non-quote fees (e.g. BNB) once a reference-price source is approved.
- **Ledger posting** of realised trading P&L belongs to the revenue / ledger stage, behind its own gates (B-07).

## Rollback

Revert the commit. On a local database, apply `028_portfolio.down.sql` (before the 027 … 021 downs).
