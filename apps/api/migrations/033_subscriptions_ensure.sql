-- 033_subscriptions_ensure.sql
-- Ensure subscriptions table exists on this branch (mirrors database/migrations/018_subscriptions.sql
-- but uses IF NOT EXISTS so it is safe to run alongside the 018 migration).
-- This is a boot-time migration run by app_factory ensureTable patterns.

CREATE TABLE IF NOT EXISTS subscriptions (
    id                       TEXT        PRIMARY KEY,
    provider                 TEXT        NOT NULL CHECK (provider IN ('dodo')),
    provider_subscription_id TEXT        NOT NULL,
    principal_id             TEXT,
    account_id               TEXT,
    api_key                  TEXT        NOT NULL,
    plan                     TEXT        NOT NULL,
    status                   TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'active', 'on_hold', 'paused',
                                                    'cancelled', 'failed', 'expired')),
    currency                 TEXT,
    recurring_amount_minor   BIGINT,
    current_period_start     TIMESTAMPTZ,
    current_period_end       TIMESTAMPTZ,
    metadata                 JSONB,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at             TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_provider_subscription
    ON subscriptions (provider, provider_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_api_key ON subscriptions (api_key);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions (status);

-- Dodo payment source value
DO $$
BEGIN
  ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_source_check;
  ALTER TABLE payment_sources ADD CONSTRAINT payment_sources_source_check
    CHECK (source IN ('polygon_usdt_vault', 'x402', 'dodo', 'marketplace', 'other'));
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
