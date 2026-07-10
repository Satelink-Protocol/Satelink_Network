-- 028_x402_funnel.sql
-- Single-row conversion-telemetry counters for the x402 rail.
-- NOTE: this repo has no automatic migration runner — apply via psql like
-- prior migrations (027 pattern).

CREATE TABLE IF NOT EXISTS x402_funnel (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  issued BIGINT NOT NULL DEFAULT 0,      -- x402 402s issued to anonymous callers
  attempts BIGINT NOT NULL DEFAULT 0,    -- payment headers presented
  settlements BIGINT NOT NULL DEFAULT 0, -- facilitator-settled payments recorded
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO x402_funnel (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
