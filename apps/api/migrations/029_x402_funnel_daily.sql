-- 029_x402_funnel_daily.sql
-- Per-day x402 conversion funnel. Additive: leaves the single-row x402_funnel
-- (028) and its /internal/x402-funnel handler untouched. One row per UTC day,
-- upserted fire-and-forget from the serving path (telemetry never blocks serving).
-- NOTE: this repo has no automatic migration runner — apply via psql (027/028 pattern).

CREATE TABLE IF NOT EXISTS x402_funnel_daily (
  day DATE PRIMARY KEY,
  x402_402_served BIGINT NOT NULL DEFAULT 0,          -- payable x402 402s served (upgrade + payment-error)
  x_payment_retry_received BIGINT NOT NULL DEFAULT 0, -- requests that arrived carrying an X-PAYMENT header
  x402_settled BIGINT NOT NULL DEFAULT 0,             -- facilitator-settled payments recorded
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
