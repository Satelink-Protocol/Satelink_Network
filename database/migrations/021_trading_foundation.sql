-- 021_trading_foundation.sql
-- Stage 09 (trading agent): core trading tables. ADDITIVE ONLY.
--
-- * Creates 14 NEW tables. No existing table is altered, dropped or referenced
--   by a foreign key except principals(id) (read-only FK target, M1).
--   Deliberately NO FK into ledger_txns / api_credits / revenue tables
--   (docs/trading-agent/audit/07-database.md §6): links to the ledger are
--   plain TEXT ids, so this migration takes no lock on money-path tables.
-- * Numbered 021, not 020: 020 is reserved by the unmerged D5 branch
--   (feat/d5-request-log adds 020_request_log.sql). The runner tracks by
--   filename and has no contiguity check (database/runner.ts discoverMigrations).
-- * `outbox` already exists (011_reconciliation.sql) → this uses trading_outbox.
-- * Money: *_minor NUMERIC(38,0) + currency TEXT + decimals SMALLINT (Financial-OS
--   convention, 002/003). Instrument quantities/prices: NUMERIC(38,18). No floats.
-- * Credentials: NO plaintext secret columns anywhere. broker_credentials_metadata
--   holds non-secret metadata; the encrypted material lives in the separate
--   broker_credential_ciphertexts table (envelope encryption, KMS-wrapped DEK).
-- * Append-only: strategy_versions, order_events, fills, audit_events have
--   UPDATE/DELETE revoked from PUBLIC and satelink_app (same model as 004/017;
--   effective once DATABASE_URL connects as satelink_app).
-- * Down migration: database/migrations-down/021_trading_foundation.down.sql
--   (outside database/migrations/ so the runner never applies it). Apply only on
--   local/ephemeral databases.
-- * Nothing in the application reads or writes these tables yet; all trading
--   feature flags default OFF (apps/api/src/trading_agent/flags.mjs).

-- ─────────────────────────────────────────────────────────────────────────────
-- Brokers & credentials
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE broker_accounts (
    id                    TEXT        PRIMARY KEY,                      -- 'bka_…'
    principal_id          TEXT        NOT NULL REFERENCES principals(id),
    broker                TEXT        NOT NULL CHECK (broker IN ('binance', 'upstox', 'alpaca')),
    environment           TEXT        NOT NULL CHECK (environment IN ('paper', 'live')),
    external_account_ref  TEXT,
    label                 TEXT        NOT NULL DEFAULT 'Untitled broker account'
                                      CHECK (char_length(label) BETWEEN 1 AND 80),
    status                TEXT        NOT NULL DEFAULT 'pending'
                                      CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_broker_accounts_identity
    ON broker_accounts (principal_id, broker, environment, external_account_ref);

CREATE TABLE broker_credentials_metadata (
    id                    TEXT        PRIMARY KEY,                      -- 'bkc_…'
    broker_account_id     TEXT        NOT NULL REFERENCES broker_accounts(id),
    kind                  TEXT        NOT NULL CHECK (kind IN ('api_key', 'oauth_token', 'byok')),
    key_fingerprint       TEXT        NOT NULL,                          -- sha256 of the public key id, never the secret
    key_hint              TEXT        NOT NULL CHECK (char_length(key_hint) <= 8),
    scopes                TEXT[]      NOT NULL DEFAULT '{}',
    kms_key_ref           TEXT        NOT NULL,                          -- KMS key id/ARN that wraps the DEK
    status                TEXT        NOT NULL DEFAULT 'active'
                                      CHECK (status IN ('active', 'rotated', 'revoked')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at            TIMESTAMPTZ,
    revoked_at            TIMESTAMPTZ,
    expires_at            TIMESTAMPTZ
);
CREATE INDEX idx_broker_credentials_account ON broker_credentials_metadata (broker_account_id) WHERE revoked_at IS NULL;

CREATE TABLE broker_credential_ciphertexts (
    credential_id         TEXT        PRIMARY KEY REFERENCES broker_credentials_metadata(id) ON DELETE CASCADE,
    encryption_alg        TEXT        NOT NULL CHECK (encryption_alg IN ('AES-256-GCM')),
    wrapped_dek           BYTEA       NOT NULL,                          -- data key encrypted by kms_key_ref
    iv                    BYTEA       NOT NULL,
    auth_tag              BYTEA       NOT NULL,
    ciphertext            BYTEA       NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Strategies
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE strategies (
    id                    TEXT        PRIMARY KEY,                      -- 'stg_…'
    principal_id          TEXT        NOT NULL REFERENCES principals(id),
    name                  TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    description           TEXT,
    status                TEXT        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE strategy_versions (
    id                    TEXT        PRIMARY KEY,                      -- 'stv_…'
    strategy_id           TEXT        NOT NULL REFERENCES strategies(id),
    version               INTEGER     NOT NULL CHECK (version >= 1),
    definition            JSONB       NOT NULL,
    definition_hash       TEXT        NOT NULL,
    created_by            TEXT        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (strategy_id, version)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Mandates & risk
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE mandates (
    id                    TEXT        PRIMARY KEY,                      -- 'mdt_…'
    principal_id          TEXT        NOT NULL REFERENCES principals(id),
    broker_account_id     TEXT        NOT NULL REFERENCES broker_accounts(id),
    strategy_id           TEXT        REFERENCES strategies(id),
    mode                  TEXT        NOT NULL CHECK (mode IN ('copilot', 'automated')),
    status                TEXT        NOT NULL DEFAULT 'draft'
                                      CHECK (status IN ('draft', 'active', 'paused', 'revoked', 'expired')),
    max_notional_minor    NUMERIC(38,0) NOT NULL CHECK (max_notional_minor >= 0),
    currency              TEXT        NOT NULL,
    decimals              SMALLINT    NOT NULL CHECK (decimals BETWEEN 0 AND 18),
    valid_from            TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until           TIMESTAMPTZ,
    approved_at           TIMESTAMPTZ,
    approved_by           TEXT,
    step_up_method        TEXT        CHECK (step_up_method IN ('passkey', 'totp')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at            TIMESTAMPTZ,
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (status <> 'active' OR (approved_at IS NOT NULL AND step_up_method IS NOT NULL))
);
CREATE INDEX idx_mandates_principal_active ON mandates (principal_id) WHERE status = 'active';

CREATE TABLE risk_policies (
    id                           TEXT        PRIMARY KEY,               -- 'rsk_…'
    principal_id                 TEXT        NOT NULL REFERENCES principals(id),
    mandate_id                   TEXT        REFERENCES mandates(id),
    version                      INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    max_order_notional_minor     NUMERIC(38,0) NOT NULL CHECK (max_order_notional_minor >= 0),
    max_daily_notional_minor     NUMERIC(38,0) NOT NULL CHECK (max_daily_notional_minor >= 0),
    max_daily_loss_minor         NUMERIC(38,0) NOT NULL CHECK (max_daily_loss_minor >= 0),
    currency                     TEXT        NOT NULL,
    decimals                     SMALLINT    NOT NULL CHECK (decimals BETWEEN 0 AND 18),
    max_leverage                 NUMERIC(10,4) NOT NULL DEFAULT 1 CHECK (max_leverage >= 1),
    max_open_positions           INTEGER     NOT NULL DEFAULT 1 CHECK (max_open_positions >= 0),
    allowed_instruments          TEXT[]      NOT NULL DEFAULT '{}',
    kill_switch                  BOOLEAN     NOT NULL DEFAULT true,       -- fail-closed: trading halted until explicitly cleared
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Signals (data only — an LLM or strategy PROPOSES; deterministic code decides)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE signals (
    id                    TEXT        PRIMARY KEY,                      -- 'sig_…'
    principal_id          TEXT        NOT NULL REFERENCES principals(id),
    strategy_version_id   TEXT        REFERENCES strategy_versions(id),
    source                TEXT        NOT NULL CHECK (source IN ('intelligence', 'strategy', 'llm_proposal', 'manual')),
    instrument            TEXT        NOT NULL,
    side                  TEXT        NOT NULL CHECK (side IN ('buy', 'sell', 'flat')),
    confidence            NUMERIC(5,4) CHECK (confidence BETWEEN 0 AND 1),
    payload               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ
);
CREATE INDEX idx_signals_principal_created ON signals (principal_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Orders, order events, fills, positions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE orders (
    id                    TEXT        PRIMARY KEY,                      -- 'ord_…'
    principal_id          TEXT        NOT NULL REFERENCES principals(id),
    mandate_id            TEXT        NOT NULL REFERENCES mandates(id),
    broker_account_id     TEXT        NOT NULL REFERENCES broker_accounts(id),
    signal_id             TEXT        REFERENCES signals(id),
    client_order_id       TEXT        NOT NULL,
    broker_order_id       TEXT,
    instrument            TEXT        NOT NULL,
    side                  TEXT        NOT NULL CHECK (side IN ('buy', 'sell')),
    order_type            TEXT        NOT NULL CHECK (order_type IN ('market', 'limit', 'stop', 'stop_limit')),
    time_in_force         TEXT        CHECK (time_in_force IN ('gtc', 'ioc', 'fok', 'day')),
    quantity              NUMERIC(38,18) NOT NULL CHECK (quantity > 0),
    limit_price           NUMERIC(38,18) CHECK (limit_price > 0),
    stop_price            NUMERIC(38,18) CHECK (stop_price > 0),
    notional_minor        NUMERIC(38,0) CHECK (notional_minor >= 0),
    currency              TEXT,
    decimals              SMALLINT    CHECK (decimals BETWEEN 0 AND 18),
    mode                  TEXT        NOT NULL CHECK (mode IN ('paper', 'live')),
    status                TEXT        NOT NULL DEFAULT 'proposed'
                                      CHECK (status IN ('proposed', 'approved', 'rejected', 'submitted', 'acknowledged',
                                                        'partially_filled', 'filled', 'cancel_requested', 'cancelled',
                                                        'expired', 'failed')),
    idempotency_key       TEXT        NOT NULL UNIQUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (broker_account_id, client_order_id),
    CHECK (order_type NOT IN ('limit', 'stop_limit') OR limit_price IS NOT NULL),
    CHECK (order_type NOT IN ('stop', 'stop_limit') OR stop_price IS NOT NULL)
);
CREATE INDEX idx_orders_principal_status ON orders (principal_id, status);

CREATE TABLE order_events (
    id                    BIGSERIAL   PRIMARY KEY,
    order_id              TEXT        NOT NULL REFERENCES orders(id),
    event_type            TEXT        NOT NULL,
    from_status           TEXT,
    to_status             TEXT,
    actor                 TEXT        NOT NULL,                          -- 'user:<id>' | 'agent:<id>' | 'system' | 'broker'
    payload               JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_events_order ON order_events (order_id, id);

CREATE TABLE fills (
    id                    TEXT        PRIMARY KEY,                      -- 'fil_…'
    order_id              TEXT        NOT NULL REFERENCES orders(id),
    broker_fill_id        TEXT        NOT NULL,
    quantity              NUMERIC(38,18) NOT NULL CHECK (quantity > 0),
    price                 NUMERIC(38,18) NOT NULL CHECK (price > 0),
    fee_minor             NUMERIC(38,0) NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
    fee_currency          TEXT,
    fee_decimals          SMALLINT    CHECK (fee_decimals BETWEEN 0 AND 18),
    ledger_txn_id         TEXT,                                          -- ledger_txns.txn_id; deliberately no FK (07 §6)
    executed_at           TIMESTAMPTZ NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, broker_fill_id)
);

CREATE TABLE positions (
    id                    TEXT        PRIMARY KEY,                      -- 'pos_…'
    principal_id          TEXT        NOT NULL REFERENCES principals(id),
    broker_account_id     TEXT        NOT NULL REFERENCES broker_accounts(id),
    instrument            TEXT        NOT NULL,
    mode                  TEXT        NOT NULL CHECK (mode IN ('paper', 'live')),
    quantity              NUMERIC(38,18) NOT NULL DEFAULT 0,
    avg_entry_price       NUMERIC(38,18) CHECK (avg_entry_price > 0),
    realized_pnl_minor    NUMERIC(38,0) NOT NULL DEFAULT 0,             -- signed
    currency              TEXT        NOT NULL,
    decimals              SMALLINT    NOT NULL CHECK (decimals BETWEEN 0 AND 18),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (broker_account_id, instrument, mode)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Outbox & audit
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE trading_outbox (
    id                    BIGSERIAL   PRIMARY KEY,
    aggregate_type        TEXT        NOT NULL,
    aggregate_id          TEXT        NOT NULL,
    event_type            TEXT        NOT NULL,
    payload               JSONB       NOT NULL,
    idempotency_key       TEXT        NOT NULL UNIQUE,
    status                TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
    attempts              INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trading_outbox_pending ON trading_outbox (next_attempt_at) WHERE status = 'pending';

CREATE TABLE audit_events (
    id                    BIGSERIAL   PRIMARY KEY,
    occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_type            TEXT        NOT NULL CHECK (actor_type IN ('user', 'staff', 'agent', 'system')),
    actor_id              TEXT        NOT NULL,
    principal_id          TEXT        REFERENCES principals(id),
    action                TEXT        NOT NULL,
    target_type           TEXT,
    target_id             TEXT,
    request_id            TEXT,
    ip_hash               TEXT,
    payload               JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_audit_events_principal ON audit_events (principal_id, occurred_at DESC);
CREATE INDEX idx_audit_events_target ON audit_events (target_type, target_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Append-only enforcement (defence-in-depth; see 004/017 for the superuser caveat)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE, DELETE ON strategy_versions, order_events, fills, audit_events FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'REVOKE UPDATE, DELETE ON strategy_versions, order_events, fills, audit_events FROM satelink_app';
    END IF;
END
$$;
