-- 036_dodo_unmatched_payments.sql
-- M5 follow-up: identity mapping for the Dodo human payment rail. A checkout
-- session now embeds metadata.satelink_account_id (the api_key being funded)
-- so the webhook can credit an EXACT, pre-resolved account instead of
-- guessing from customer email or auto-provisioning a fresh one. Any payment
-- whose metadata is missing/unknown (e.g. a payment made before this existed,
-- or a manually-shared payment link with no metadata pass-through) lands
-- here instead of being credited, silently dropped, or misattributed.
--
-- Additive only — no drops, no renames. The live boot-time runner
-- (apps/api/src/db/dodo_rail_schema.js) applies the same idempotent DDL;
-- this numbered file is the reviewable record, matching the convention
-- established by 031/033/035.
--
-- payment_id has a partial unique index (WHERE NOT NULL) so a retried Dodo
-- delivery for the same payment is idempotent — ON CONFLICT DO NOTHING at
-- the insert site, same pattern as dodo_refund_dispute_log.event_id.
CREATE TABLE IF NOT EXISTS unmatched_payments (
  id                BIGSERIAL PRIMARY KEY,
  provider          TEXT NOT NULL DEFAULT 'dodo',
  event_type        TEXT NOT NULL,
  payment_id        TEXT,
  subscription_id   TEXT,
  product_id        TEXT,
  customer_email    TEXT,
  currency          TEXT,
  amount_minor      BIGINT,
  metadata          JSONB,
  reason            TEXT NOT NULL,   -- 'no_account_metadata' | 'account_not_found' | ...
  raw_payload       JSONB,
  resolved          BOOLEAN NOT NULL DEFAULT false,
  resolved_api_key  TEXT,
  resolved_by       TEXT,            -- operator identifier (admin script arg), not a session/user id
  resolved_at       BIGINT,
  is_test_data      BOOLEAN NOT NULL DEFAULT false,
  created_at        BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_unmatched_payments_payment_id
  ON unmatched_payments(provider, payment_id) WHERE payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_unmatched_payments_resolved ON unmatched_payments(resolved);
