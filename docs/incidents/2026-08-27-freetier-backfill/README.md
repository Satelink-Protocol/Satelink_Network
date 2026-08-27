# 2026-08-27 — Backfill `is_test_data=true` on free-tier revenue rows

Follow-up to `docs/incidents/2026-08-27-volume-exhaustion.md` (§2, §8 open risk). The RPC
free-tier path wrote `revenue_events_v2` rows with `status='success'`, empty `source`, and
`is_test_data=false` for calls that collected $0 — inflating "real revenue" and making the
`is_test_data` flag meaningless. This backfill reclassifies those historical rows as test data.

## What ran (prod, via `railway run --service Postgres-iQeW` + psql)

- **Frozen cutoff:** `created_at <= 1787396771` (max `created_at` at decision time) so live inserts
  after the decision are never touched.
- **Predicate (exact):**
  `is_test_data = false AND status = 'success' AND COALESCE(source,'') = '' AND created_at <= 1787396771`
- **Batched:** 10,000-row batches, `FOR UPDATE SKIP LOCKED`, per-batch commit (autocommit) — no
  single mega-transaction, per the volume-exhaustion WAL lesson.
- **Rows updated:** **345,820** (34×10,000 + 1×5,820). Target count matched exactly.

## Before → After (psql)

| Metric | Before | After |
|---|--:|--:|
| `revenue_events_v2` `is_test_data=false` count | 345,822 | **2** |
| real-revenue `sum(amount_usdt)` | $0.5458 | **$0.20** (2 × x402 bundle) |
| `is_test_data=true` count | 62 | 345,882 |
| ledger parity (real revenue vs ledger, fixed query) | 99.95% (masked) | **50%** (2 vs 1) |

The 2 remaining real rows are both `source='x402'` — the only genuine external rail.

## Coupled code change (required — same PR)

`apps/api/src/internal/ledger_parity.js`: the ledger side now `LEFT JOIN`s `revenue_events_v2` and
excludes `is_test_data=true` rows. Without this, parity would compare a test-filtered revenue count
(2) against an unfiltered ledger count (345,653) and report a nonsensical −345,651 drift, because the
345,652 ledger txns backing the reclassified rows are **append-only (invariant #5) and cannot be
removed**. The `LEFT JOIN … IS NOT TRUE` keeps ledger txns with no matching revenue row, preserving
prior semantics for every non-backfilled row.

The honest post-backfill parity of **50%** (2 real revenue events, 1 in the shadow ledger) exposes a
**pre-existing gap**: x402 payment `0x485035ad…` (request_id `x402:0x4850…`) was never shadow-ledgered,
while `0x7bc6…` was. This was previously masked by 345K free-tier rows. Tracked as an open item, not
introduced here.

## Reversal (fully reversible)

The operation is idempotent and reversible. To revert, run (batched, same pattern):

```sql
UPDATE revenue_events_v2 SET is_test_data = false
 WHERE is_test_data = true AND status = 'success'
   AND COALESCE(source,'') = '' AND created_at <= 1787396771;
```

This predicate uniquely identifies the backfilled set: the 62 original test rows all have non-empty
`source` (edge_cache, ankr-base, …), so they are not matched. The full affected id list was also
captured at backfill time to `affected_ids.txt` (345,820 ids, git-ignored due to size; regenerable
from the predicate above).

## Not fixed here (still open)

- **App-side root cause:** the free-tier RPC path still writes `is_test_data=false` for new $0 calls.
  This backfill only fixes history. The forward fix touches the FROZEN money-path / `free_tier_gate.js`
  (forbidden to modify) → founder decision.
- **x402 `0x4850…` not shadow-ledgered** — pre-existing ledger gap, now visible in parity.
</content>
