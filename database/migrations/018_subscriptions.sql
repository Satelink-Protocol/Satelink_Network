-- 018_subscriptions.sql
-- M5 (T-18): subscriptions table — the Dodo human payment rail (cards, UPI).
-- x402 reaches agents; Dodo reaches humans. This table is the record of a
-- recurring commercial relationship, distinct from the one-shot payment
-- ledger rows (payment_sources / revenue_events_v2) each renewal also writes.
--
-- Maps to EXISTING primitives rather than inventing a parallel identity model:
--   principal_id -> principals   (financial-domain identity, 001_principals.sql)
--   account_id   -> accounts     (financial-domain ledger account, 002_accounts.sql)
--   api_key      -> api_credits  (the CANONICAL spendable balance store the
--                                 serving path deducts from — billing/credit_service.mjs)
--
-- principal_id / account_id are nullable: Satelink does not yet provision a
-- financial-domain principal+account per human customer (that is separate,
-- larger work — today only system accounts exist, 005_system_accounts.sql).
-- api_key is NOT NULL and is the operative identity: entitlement, crediting,
-- and spend all key off the same api_credits row every other rail uses.
--
-- provider is CHECK-constrained to a single value on purpose — this is the
-- Dodo-specific bridge table, not a generic multi-provider abstraction (that
-- would be premature: Satelink has exactly one human-payment provider today).

CREATE TABLE subscriptions (
    id                       TEXT        PRIMARY KEY,   -- app-set, e.g. 'dodo:<provider_subscription_id>'
    provider                 TEXT        NOT NULL CHECK (provider IN ('dodo')),
    provider_subscription_id TEXT        NOT NULL,
    principal_id             TEXT        REFERENCES principals(id),
    account_id               TEXT        REFERENCES accounts(id),
    api_key                  TEXT        NOT NULL REFERENCES api_credits(api_key),
    plan                     TEXT        NOT NULL,       -- 'starter' | 'pro' | ... (product tier name)
    status                   TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'active', 'on_hold', 'paused',
                                                    'cancelled', 'failed', 'expired')),
    currency                 TEXT        NOT NULL,       -- ISO 4217, as Dodo reports it (e.g. 'INR')
    recurring_amount_minor   BIGINT      NOT NULL,       -- smallest currency unit (e.g. paise)
    current_period_start     TIMESTAMPTZ,
    current_period_end       TIMESTAMPTZ,
    metadata                 JSONB,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    cancelled_at              TIMESTAMPTZ
);

-- One row per Dodo subscription, ever — the idempotency anchor for every
-- subscription.* webhook handler (UPSERT on this key).
CREATE UNIQUE INDEX idx_subscriptions_provider_subscription
    ON subscriptions (provider, provider_subscription_id);

CREATE INDEX idx_subscriptions_api_key ON subscriptions (api_key);
CREATE INDEX idx_subscriptions_status ON subscriptions (status);
