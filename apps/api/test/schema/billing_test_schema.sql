-- Focused test schema for the money-path billing tables.
-- (P0-1 / P0-3 remediation, 2026-09.)
--
-- Columns mirror exactly what apps/api/src billing code INSERT/SELECTs
-- (credit_service.mjs, payments/x402/settlement.js, rpc_gateway/rpc_billing.js,
-- billing/api_keys_route.mjs, services/deposit_listener.js). This is NOT a full
-- production mirror — only the tables the money-path + x402 rail tests touch.
-- Load into a LOCAL/ephemeral Postgres (see .env.test); never against prod.
--
-- Usage:
--   createdb satelink_test
--   psql -d satelink_test -f apps/api/test/schema/billing_test_schema.sql

CREATE TABLE IF NOT EXISTS api_credits (
  id              SERIAL PRIMARY KEY,
  api_key         VARCHAR(100) UNIQUE NOT NULL,
  tier            VARCHAR(20) DEFAULT 'free',
  daily_limit     INTEGER DEFAULT 200,
  credits_usdt    NUMERIC(18,6) DEFAULT 0,
  total_deposited NUMERIC(18,6) DEFAULT 0,
  total_spent     NUMERIC(18,6) DEFAULT 0,
  wallet_address  VARCHAR(42),
  demand_source   TEXT,
  created_at      TIMESTAMP DEFAULT now(),
  last_used       TIMESTAMP,
  status          VARCHAR(20) DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS api_usage_daily (
  id            SERIAL PRIMARY KEY,
  api_key       VARCHAR(100) NOT NULL,
  date          DATE NOT NULL,
  request_count INTEGER DEFAULT 0,
  usdt_spent    NUMERIC(18,8) DEFAULT 0,
  UNIQUE (api_key, date)
);

CREATE TABLE IF NOT EXISTS revenue_events_v2 (
  id            SERIAL PRIMARY KEY,
  op_type       TEXT,
  node_id       TEXT,
  client_id     TEXT,
  amount_usdt   NUMERIC(18,8) DEFAULT 0 NOT NULL,
  status        TEXT DEFAULT 'pending',
  request_id    TEXT UNIQUE,
  created_at    BIGINT,
  chain         TEXT,
  method        TEXT,
  source        TEXT,
  demand_source TEXT,
  epoch_id      INTEGER,
  is_test_data  BOOLEAN DEFAULT FALSE NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_sources (
  id               SERIAL PRIMARY KEY,
  source           TEXT,
  amount_usd       NUMERIC(18,8),
  token            TEXT,
  network          TEXT,
  tx_hash          TEXT UNIQUE,
  payer            TEXT,
  credited_api_key TEXT,
  is_test_data     BOOLEAN DEFAULT FALSE,
  created_at       BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
);

CREATE TABLE IF NOT EXISTS api_deposits (
  id           SERIAL PRIMARY KEY,
  api_key      TEXT,
  tx_hash      VARCHAR(66) UNIQUE NOT NULL,
  amount_usdt  NUMERIC(18,8),
  from_address TEXT,
  tier_before  TEXT,
  tier_after   TEXT,
  is_test_data BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_deposits (
  id             SERIAL PRIMARY KEY,
  wallet_address TEXT,
  amount_usdt    NUMERIC(18,8),
  tx_hash        TEXT UNIQUE,
  block_number   BIGINT DEFAULT 0,
  chain_id       INTEGER,
  status         TEXT DEFAULT 'confirmed',
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_balances (
  id              SERIAL PRIMARY KEY,
  wallet_address  TEXT UNIQUE,
  balance_usdt    NUMERIC(18,8) DEFAULT 0,
  total_deposited NUMERIC(18,8) DEFAULT 0,
  total_spent     NUMERIC(18,8) DEFAULT 0,
  last_deposit_tx TEXT,
  last_deposit_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
-- Idempotent on a pre-existing table from an earlier version of this file
-- (CREATE TABLE IF NOT EXISTS above is a no-op once the table exists).
ALTER TABLE credit_balances ADD COLUMN IF NOT EXISTS total_spent NUMERIC(18,8) DEFAULT 0;

-- Capacity-enforcement kill-switch (apps/api/src/lib/flags.js getCapacityPath).
-- Even though getCapacityPath catches a missing-table error internally and
-- fails closed to 'legacy', an uncaught SQL error still aborts the enclosing
-- Postgres transaction — this table must exist for savepoint-wrapped tests
-- that reach enforceCapacity to avoid poisoning the whole test transaction.
CREATE TABLE IF NOT EXISTS platform_flags (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- credit_gate.js's getPricing() cache — same poisoned-transaction hazard as
-- platform_flags above (its own try/catch swallows the JS error but not the
-- aborted Postgres transaction). Left empty so getCost() falls back to
-- DEFAULT_COST_USDT, same as production when no override row exists.
CREATE TABLE IF NOT EXISTS rpc_method_pricing (
  method_name TEXT PRIMARY KEY,
  price_usdt  NUMERIC(18,8),
  active      BOOLEAN DEFAULT TRUE
);

-- x402 conversion telemetry (payments/x402/funnel.js). Fire-and-forget writes
-- whose JS rejections are swallowed — but a missing table still aborts the
-- shared test transaction, so the tables must exist here.
CREATE TABLE IF NOT EXISTS x402_funnel (
  id          INTEGER PRIMARY KEY,
  issued      BIGINT DEFAULT 0,
  attempts    BIGINT DEFAULT 0,
  settlements BIGINT DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
INSERT INTO x402_funnel (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS x402_funnel_daily (
  day                      DATE PRIMARY KEY,
  x402_402_served          BIGINT DEFAULT 0,
  x_payment_retry_received BIGINT DEFAULT 0,
  x402_settled             BIGINT DEFAULT 0,
  updated_at               TIMESTAMPTZ DEFAULT now()
);
