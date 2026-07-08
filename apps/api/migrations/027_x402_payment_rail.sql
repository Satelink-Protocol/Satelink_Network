-- 027_x402_payment_rail.sql
-- x402 v2 parallel payment rail (feature-flagged off by default).
-- payment_sources: one row per settled external payment, any rail.
-- tx_hash UNIQUE is the replay/duplicate-settlement guard.
-- NOTE: production tables are revenue_events_v2 and api_credits
-- (there is no revenue_events / api_keys table — verified via \dt 2026-07-09).

CREATE TABLE IF NOT EXISTS payment_sources (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('polygon_usdt_vault','x402','marketplace','other')),
  amount_usd NUMERIC(18,6) NOT NULL,
  token TEXT NOT NULL,
  network TEXT NOT NULL,
  tx_hash TEXT UNIQUE NOT NULL,
  payer TEXT NOT NULL,
  credited_api_key TEXT,
  is_test_data BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_sources_source ON payment_sources(source);
CREATE INDEX IF NOT EXISTS idx_payment_sources_created ON payment_sources(created_at);

ALTER TABLE revenue_events_v2 ADD COLUMN IF NOT EXISTS demand_source TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE revenue_events_v2 ADD COLUMN IF NOT EXISTS demand_router_id BIGINT;
ALTER TABLE revenue_events_v2 ADD COLUMN IF NOT EXISTS partner_share_bps INT;

ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS demand_source TEXT NOT NULL DEFAULT 'direct';
