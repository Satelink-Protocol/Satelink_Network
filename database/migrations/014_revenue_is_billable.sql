-- 014_revenue_is_billable — free-tier semantics get their OWN column.
--
-- Context (2026-08-27): the free tier is being removed from the money path.
-- Historically, "was this a paid/billable event?" was inferred from is_test_data,
-- which is unreliable: the free-tier RPC path wrote is_test_data=false rows for
-- $0 calls (345,820 of them, reclassified to is_test_data=true in the 2026-08-27
-- backfill — see docs/incidents/2026-08-27-freetier-backfill/). Overloading
-- is_test_data to mean BOTH "founder/synthetic test data" AND "non-billable
-- free-tier traffic" is the source of that confusion.
--
-- is_billable makes the billing dimension explicit and independent:
--   is_billable = true  -> a real charge was collected (credit deducted or x402
--                          settled). This is what revenue metrics SHOULD sum.
--   is_billable = false -> no charge collected (free tier, promo, internal).
--   is_test_data        -> orthogonal: founder/synthetic rows excluded from
--                          external metrics regardless of billing.
--
-- Default true is deliberately conservative: every EXISTING row keeps its current
-- meaning, and the 2026-08-27 is_test_data backfill is NOT re-touched here (those
-- rows stay is_test_data=true / is_billable=true — historically they were "billed"
-- at $0.00003 even though nothing was collected; that history is frozen, not
-- rewritten, per the append-only fact-stream rule). NEW writes set is_billable
-- from the actual deduction result. ADD COLUMN with a constant default is a
-- metadata-only change in PostgreSQL 11+ (no table rewrite of the 345k rows).

ALTER TABLE revenue_events_v2
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN revenue_events_v2.is_billable IS
  'True iff a real charge was collected (credit deducted or x402 settled). '
  'Independent of is_test_data. Revenue metrics should sum WHERE is_billable AND NOT is_test_data. '
  'Added 2026-08-27 when the free tier was removed from the money path.';

-- Partial index for the common "real revenue" aggregation.
CREATE INDEX IF NOT EXISTS idx_rev2_billable_real
  ON revenue_events_v2 (created_at)
  WHERE is_billable AND NOT is_test_data;
