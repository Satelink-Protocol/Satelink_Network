-- 020 — request_log (D5): a BOUNDED per-request log for the customer console.
--
-- Additive. Written by apps/api/src/observability/request_log.mjs: an in-memory
-- buffer flushed in multi-row INSERTs every few seconds, never on the request
-- path. Only requests that carry an EXISTING api key are recorded (the ~500k
-- anonymous 402s a day are not — they belong to aggregate counters). Rows are
-- deleted after REQUEST_LOG_RETENTION_DAYS (default 14) by the same module.
-- Not a financial table: cost is a copy for display; the money of record stays
-- in revenue_events_v2 / api_credits (joined by request_id).
CREATE TABLE IF NOT EXISTS request_log (
  id           BIGSERIAL    PRIMARY KEY,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  api_key_id   BIGINT       NOT NULL,
  product      TEXT         NOT NULL CHECK (product IN ('rpc', 'intelligence')),
  endpoint     TEXT         NOT NULL,
  chain        TEXT,
  http_status  SMALLINT     NOT NULL,
  latency_ms   INTEGER      NOT NULL CHECK (latency_ms >= 0),
  rail         TEXT         NOT NULL CHECK (rail IN ('credits', 'x402')),
  charged_usdt NUMERIC(18, 8) NOT NULL DEFAULT 0,
  request_id   TEXT,
  error_code   TEXT
);
CREATE INDEX IF NOT EXISTS request_log_key_created ON request_log (api_key_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS request_log_created ON request_log (created_at);
CREATE INDEX IF NOT EXISTS request_log_request_id ON request_log (request_id) WHERE request_id IS NOT NULL;
