-- 033_dodo_refund_dispute.sql
-- M5 follow-up: Dodo refund & dispute handling (the money-reversing half of the
-- human payment rail). Additive only — no drops, no renames, no mutation of
-- existing rows. The live boot-time runner (apps/api/src/db/migrate.js) applies
-- the same idempotent DDL; this numbered file is the reviewable record, matching
-- the convention established by 031_dodo_payment_source.sql.
--
-- Event names & payload fields are SDK-verified against the installed
-- @dodopayments/core zod schemas (dist/chunk-F4N6VZ2P.js): refund.succeeded /
-- refund.failed (RefundSchema: refund_id, payment_id, is_partial, amount) and
-- dispute.{opened,accepted,cancelled,challenged,expired,won,lost}
-- (DisputeSchema: dispute_id, payment_id, amount, dispute_status).
--
-- WHY is_billable here: 015_revenue_billable_amount_check adds
--   CHECK (is_billable = false OR (amount_usdt IS NOT NULL AND amount_usdt > 0))
-- so a reversal row (negative amount_usdt) is only legal with is_billable=false.
-- We ensure the column exists so the reversal INSERT is portable across a DB
-- provisioned by migrate.js vs. by the numbered database/migrations set.

-- Held (frozen, non-spendable) balance. The RPC serving path reads credits_usdt
-- only, so moving funds into frozen_usdt makes them unspendable without touching
-- the hot authorize/meter path.
ALTER TABLE api_credits
  ADD COLUMN IF NOT EXISTS frozen_usdt NUMERIC(18,6) NOT NULL DEFAULT 0;

ALTER TABLE revenue_events_v2
  ADD COLUMN IF NOT EXISTS is_billable BOOLEAN NOT NULL DEFAULT true;

-- Idempotency gate + freeze-amount tracking for refunds/disputes. event_id is
-- deterministic per webhook event, so a duplicate delivery changes nothing.
-- The dispute.opened row's amount_usd records how much was frozen, so a later
-- dispute.won can unfreeze exactly that amount.
CREATE TABLE IF NOT EXISTS dodo_refund_dispute_log (
  id             BIGSERIAL PRIMARY KEY,
  event_id       TEXT UNIQUE NOT NULL,   -- 'refund:<refund_id>' | 'dispute:<dispute_id>:<event_type>'
  kind           TEXT NOT NULL,          -- 'refund' | 'dispute'
  event_type     TEXT NOT NULL,          -- refund.succeeded | dispute.opened | dispute.won | ...
  dodo_ref       TEXT NOT NULL,          -- refund_id or dispute_id
  payment_id     TEXT,
  api_key        TEXT,
  amount_usd     NUMERIC(18,6) NOT NULL DEFAULT 0,   -- clawed-back or frozen amount actually applied
  shortfall_usd  NUMERIC(18,6) NOT NULL DEFAULT 0,   -- credits already spent, unrecoverable
  is_test_data   BOOLEAN NOT NULL DEFAULT false,
  created_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dodo_rd_log_payment ON dodo_refund_dispute_log(payment_id);
CREATE INDEX IF NOT EXISTS idx_dodo_rd_log_ref ON dodo_refund_dispute_log(dodo_ref);
