-- 035_trading_agent_access — Phase 6 item 11 (machine + AI-agent interface)
--
-- API keys for agent / machine principals (the existing principals table, kinds 'agent' | 'machine',
-- owned by a human via parent_id). One key per principal; scope, budgets and a rate limit per key.
-- The raw key is NEVER stored — only its SHA-256 (same scheme as console_accounts/keys.mjs) and a hint.
--   scope READ                  evaluate opportunities, read receipts
--   scope PROPOSE               + create proposals (human review)
--   scope EXECUTE_UNDER_MANDATE + proposals bound to the key's mandate may proceed under Mode B
--                                 (item 12) — never without a human-signed mandate
-- trading_agent_usage is the metering record (append-only, 029 guard): one row per billable call.
--
-- * Additive. Depends on 001 (principals) and 029 (guard).
-- * Down: database/migrations-down/035_trading_agent_access.down.sql (local/ephemeral only).
CREATE TABLE trading_agent_keys (
    id                 TEXT        PRIMARY KEY,                       -- 'tak_…'
    principal_id       TEXT        NOT NULL UNIQUE REFERENCES principals(id),
    owner_principal_id TEXT        NOT NULL REFERENCES principals(id),
    key_hash           TEXT        NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
    key_hint           TEXT        NOT NULL CHECK (char_length(key_hint) <= 16),
    scope              TEXT        NOT NULL CHECK (scope IN ('READ', 'PROPOSE', 'EXECUTE_UNDER_MANDATE')),
    mandate_id         TEXT,
    budget_calls       INTEGER     NOT NULL CHECK (budget_calls > 0),
    budget_usd_micro   BIGINT      NOT NULL CHECK (budget_usd_micro >= 0),
    budget_period      TEXT        NOT NULL DEFAULT 'day' CHECK (budget_period IN ('day', 'month')),
    rate_per_minute    INTEGER     NOT NULL CHECK (rate_per_minute BETWEEN 1 AND 600),
    created_at         TIMESTAMPTZ NOT NULL,
    revoked_at         TIMESTAMPTZ,
    CHECK (scope <> 'EXECUTE_UNDER_MANDATE' OR mandate_id IS NOT NULL),
    CHECK (principal_id <> owner_principal_id)
);

CREATE TABLE trading_agent_usage (
    id                 TEXT        PRIMARY KEY,
    key_id             TEXT        NOT NULL REFERENCES trading_agent_keys(id),
    principal_id       TEXT        NOT NULL REFERENCES principals(id),
    endpoint           TEXT        NOT NULL CHECK (endpoint IN ('evaluate_opportunity', 'propose', 'get_receipt', 'propose_strategy')),
    request_id         TEXT        NOT NULL,
    units              INTEGER     NOT NULL DEFAULT 1 CHECK (units > 0),
    charge_usd_micro   BIGINT      NOT NULL CHECK (charge_usd_micro >= 0),
    price_version      TEXT        NOT NULL,
    at                 TIMESTAMPTZ NOT NULL,
    UNIQUE (key_id, request_id)
);
CREATE INDEX idx_trading_agent_usage_key_at ON trading_agent_usage (key_id, at);

CREATE TRIGGER trading_agent_usage_append_only BEFORE UPDATE OR DELETE ON trading_agent_usage FOR EACH ROW EXECUTE FUNCTION trading_append_only_guard();
CREATE TRIGGER trading_agent_usage_no_truncate BEFORE TRUNCATE ON trading_agent_usage FOR EACH STATEMENT EXECUTE FUNCTION trading_append_only_guard();
REVOKE UPDATE, DELETE, TRUNCATE ON trading_agent_usage FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON trading_agent_usage FROM satelink_app';
    END IF;
END
$$;
