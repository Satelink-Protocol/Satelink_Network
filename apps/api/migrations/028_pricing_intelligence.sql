-- 028_pricing_intelligence.sql
-- Autonomous Pricing Intelligence engine (market intel + advisory pricing decisions).
-- Mirrors ensurePricingIntelTables() in src/economics/pricing_intelligence/schema.js,
-- which also runs at boot (CREATE IF NOT EXISTS) — applying this migration is
-- optional but keeps migration history complete. Seed rows are inserted by the
-- runtime ensure, not here, so admin-corrected values are never overwritten.

CREATE TABLE IF NOT EXISTS market_providers (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  website TEXT,
  pricing_url TEXT,
  pricing_model TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_price_points (
  id BIGSERIAL PRIMARY KEY,
  provider_id BIGINT NOT NULL REFERENCES market_providers(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL,
  monthly_price_usd NUMERIC(12,2),
  included_requests_m NUMERIC(14,4),
  effective_usd_per_million NUMERIC(14,6),
  overage_usd_per_million NUMERIC(14,6),
  free_tier_requests_m_per_month NUMERIC(14,4),
  rate_limit_rps INT,
  chains_count INT,
  requires_signup BOOLEAN NOT NULL DEFAULT true,
  requires_subscription BOOLEAN NOT NULL DEFAULT true,
  supports_x402 BOOLEAN NOT NULL DEFAULT false,
  sla_pct NUMERIC(6,3),
  latency_claim_ms INT,
  source_url TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('published','derived_estimate','unverified')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, plan_name)
);

CREATE TABLE IF NOT EXISTS pricing_decisions (
  id BIGSERIAL PRIMARY KEY,
  mode TEXT NOT NULL,
  current_price_usd NUMERIC(18,9) NOT NULL,
  recommended_price_usd NUMERIC(18,9) NOT NULL,
  floor_price_usd NUMERIC(18,9) NOT NULL,
  market_median_usd_per_million NUMERIC(14,6),
  market_average_usd_per_million NUMERIC(14,6),
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  inputs JSONB NOT NULL,
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pricing_decisions_created ON pricing_decisions(created_at DESC);
