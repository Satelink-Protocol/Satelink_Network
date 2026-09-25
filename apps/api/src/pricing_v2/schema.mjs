// Pricing V2 schema — additive; never alters api_credits, plans or
// plan_entitlements (V1 stays readable for rollback). Mirrored in
// migrations/040_pricing_v2.sql; applied idempotently at first use.
// Keyed by the account (Better Auth user.id, see CONSOLE_ACCOUNTS_V1).

export const PRICING_V2_DDL = `
-- Every Dodo webhook, stored once by its webhook-id (Standard Webhooks). The
-- handler is idempotent on this row: a redelivery is acknowledged, not re-applied.
CREATE TABLE IF NOT EXISTS pv2_webhook_events (
  webhook_id   TEXT PRIMARY KEY,
  event_type   TEXT        NOT NULL,
  mode         TEXT        NOT NULL CHECK (mode IN ('test', 'live')),
  payload      JSONB       NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  outcome      TEXT
);

-- Dodo subscriptions, mirrored (Dodo is the source of truth; this is our view).
CREATE TABLE IF NOT EXISTS pv2_subscriptions (
  dodo_subscription_id TEXT PRIMARY KEY,
  account_id           TEXT        NOT NULL,
  mode                 TEXT        NOT NULL CHECK (mode IN ('test', 'live')),
  plan_id              TEXT        NOT NULL,
  catalog_version      TEXT        NOT NULL,
  status               TEXT        NOT NULL,
  current_period_end   TIMESTAMPTZ,
  intro                BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pv2_subscriptions_account ON pv2_subscriptions (account_id);

-- The account's current entitlement (one row per account). status:
-- active (allowance usable) · on_hold (renewal failed — allowance paused) ·
-- revoked (cancelled/expired/refunded/disputed — back to Free).
CREATE TABLE IF NOT EXISTS pv2_entitlements (
  account_id      TEXT PRIMARY KEY,
  plan_id         TEXT        NOT NULL,
  catalog_version TEXT        NOT NULL,
  session_uu      INTEGER     NOT NULL CHECK (session_uu >= 0),
  weekly_uu       INTEGER     NOT NULL CHECK (weekly_uu >= 0),
  status          TEXT        NOT NULL CHECK (status IN ('active', 'on_hold', 'revoked')),
  source_ref      TEXT,
  period_end      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prepaid pack UU (Dodo-funded, Trading Intelligence only). Balance + grants.
CREATE TABLE IF NOT EXISTS pv2_pack_balances (
  account_id TEXT PRIMARY KEY,
  uu_balance BIGINT      NOT NULL DEFAULT 0 CHECK (uu_balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pv2_pack_grants (
  dodo_payment_id TEXT PRIMARY KEY,
  account_id      TEXT        NOT NULL,
  pack_id         TEXT        NOT NULL,
  uu              BIGINT      NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'reversed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every metered consumption: native meter + UU + pricing version + which
-- bucket paid. The single source for session/weekly windows and usage views.
CREATE TABLE IF NOT EXISTS pv2_usage_ledger (
  id              BIGSERIAL PRIMARY KEY,
  account_id      TEXT        NOT NULL,
  api_key_id      INTEGER,
  meter           TEXT        NOT NULL,
  native_units    NUMERIC(20,6) NOT NULL,
  uu              INTEGER     NOT NULL CHECK (uu >= 0),
  pricing_version TEXT        NOT NULL,
  bucket          TEXT        NOT NULL CHECK (bucket IN ('plan', 'pack', 'credits')),
  credits_usdt    NUMERIC(20,6) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pv2_usage_ledger_window ON pv2_usage_ledger (account_id, created_at DESC) WHERE bucket = 'plan';
CREATE INDEX IF NOT EXISTS pv2_usage_ledger_account ON pv2_usage_ledger (account_id, created_at DESC);

-- 70/85/95/100% notices, at most once per window per threshold.
CREATE TABLE IF NOT EXISTS pv2_usage_notices (
  account_id TEXT        NOT NULL,
  win        TEXT        NOT NULL CHECK (win IN ('session', 'weekly')),
  window_key TEXT        NOT NULL,
  threshold  SMALLINT    NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, win, window_key, threshold)
);

-- Payment facts from Dodo, one row per payment / refund / dispute. Feeds the
-- revenue events + reconciliation (Dodo API vs revenue vs entitlements).
CREATE TABLE IF NOT EXISTS pv2_payments (
  dodo_id      TEXT PRIMARY KEY,
  kind         TEXT        NOT NULL CHECK (kind IN ('payment', 'refund', 'dispute')),
  mode         TEXT        NOT NULL CHECK (mode IN ('test', 'live')),
  account_id   TEXT,
  item_id      TEXT,
  amount_minor BIGINT      NOT NULL,
  currency     TEXT        NOT NULL,
  status       TEXT        NOT NULL,
  payment_ref  TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pv2_reconciliation_runs (
  id          BIGSERIAL PRIMARY KEY,
  mode        TEXT        NOT NULL,
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dodo_count  INTEGER,
  local_count INTEGER,
  mismatches  JSONB       NOT NULL DEFAULT '[]'::jsonb
);
`;

let ensured = null;
export function ensurePricingV2Schema(pool) {
  if (!ensured) {
    ensured = pool.query(PRICING_V2_DDL).catch((err) => { ensured = null; throw err; });
  }
  return ensured;
}
export function __resetPricingSchema() { ensured = null; }
