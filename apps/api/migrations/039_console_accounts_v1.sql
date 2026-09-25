-- 039 — CONSOLE_ACCOUNTS_V1 (feat/console-accounts-v1). Additive only; does not
-- alter api_credits. Applied idempotently at first use by
-- src/console_accounts/schema.mjs (prod has no migration runner). FOUNDER REVIEW.
CREATE TABLE IF NOT EXISTS account_api_keys (
  id              BIGSERIAL PRIMARY KEY,
  account_id      TEXT        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  api_key_id      INTEGER     NOT NULL REFERENCES api_credits(id),
  key_fingerprint TEXT        NOT NULL,
  key_hint        TEXT        NOT NULL,
  label           TEXT        NOT NULL DEFAULT 'Untitled key' CHECK (char_length(label) BETWEEN 1 AND 80),
  role            TEXT        NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'agent')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ
);
-- A live key belongs to exactly one account.
CREATE UNIQUE INDEX IF NOT EXISTS account_api_keys_live_key ON account_api_keys (api_key_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS account_api_keys_account ON account_api_keys (account_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS account_settings (
  account_id             TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  monthly_spend_cap_usdt NUMERIC(20,6) CHECK (monthly_spend_cap_usdt IS NULL OR monthly_spend_cap_usdt >= 0),
  credit_auto_use        BOOLEAN     NOT NULL DEFAULT TRUE,
  alert_thresholds       SMALLINT[]  NOT NULL DEFAULT '{70,85,95,100}',
  default_mode           TEXT        NOT NULL DEFAULT 'simple' CHECK (default_mode IN ('simple', 'advanced')),
  timezone               TEXT        NOT NULL DEFAULT 'UTC',
  notifications          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_limits (
  api_key_id     INTEGER PRIMARY KEY REFERENCES api_credits(id),
  account_id     TEXT        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  scopes         TEXT[],
  daily_cap_usdt NUMERIC(20,6) CHECK (daily_cap_usdt IS NULL OR daily_cap_usdt >= 0),
  paused         BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Atomic spend counters. Incremented in the SAME transaction as the credit
-- deduction with a conditional upsert, so a counter always equals the sum of
-- committed charges and never exceeds its cap under concurrency.
CREATE TABLE IF NOT EXISTS account_spend_counters (
  scope      TEXT          NOT NULL CHECK (scope IN ('agent_day', 'account_month')),
  scope_id   TEXT          NOT NULL,
  period     TEXT          NOT NULL,
  spent_usdt NUMERIC(20,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, scope_id, period)
);

CREATE TABLE IF NOT EXISTS account_saved_queries (
  id         BIGSERIAL PRIMARY KEY,
  account_id TEXT        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  query      JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_saved_queries_account ON account_saved_queries (account_id);

CREATE TABLE IF NOT EXISTS account_wallets (
  id          BIGSERIAL PRIMARY KEY,
  account_id  TEXT        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  address     TEXT        NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  chain_id    INTEGER     NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (address)
);

CREATE TABLE IF NOT EXISTS account_siwe_nonces (
  nonce      TEXT PRIMARY KEY,
  account_id TEXT        NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS account_audit (
  id         BIGSERIAL PRIMARY KEY,
  account_id TEXT        NOT NULL,
  action     TEXT        NOT NULL,
  subject    TEXT,
  detail     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_audit_account ON account_audit (account_id, created_at DESC);

-- Replay protection for create / rotate (Idempotency-Key header).
CREATE TABLE IF NOT EXISTS account_idempotency (
  account_id TEXT        NOT NULL,
  idem_key   TEXT        NOT NULL,
  action     TEXT        NOT NULL,
  status     INTEGER     NOT NULL,
  response   JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, idem_key)
);

-- Run outside a transaction:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rev2_client_created ON revenue_events_v2 (client_id, created_at DESC);
