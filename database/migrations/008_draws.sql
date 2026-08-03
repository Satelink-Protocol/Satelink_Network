-- 008_draws.sql
-- M6: Draw + Settlement in shadow.
--
-- ADDITIVE ONLY. New tables; no existing table/constraint/view is modified.
-- Amounts are NUMERIC(38,0) integer minor units. version columns provide
-- optimistic locking on the Draw aggregate.
-- Settlement is an ENTITY inside the Draw aggregate — they must be loaded
-- and saved atomically.

CREATE TABLE draws (
    id                  TEXT          PRIMARY KEY,
    principal_id        TEXT          NOT NULL REFERENCES principals(id),
    authorization_id    TEXT          NOT NULL REFERENCES authorizations(id),
    funding_source_id   TEXT          NOT NULL REFERENCES funding_sources(id),
    account_id          TEXT          NOT NULL REFERENCES accounts(id),
    amount              NUMERIC(38,0) NOT NULL CHECK (amount > 0),
    currency            TEXT          NOT NULL,
    idempotency_key     TEXT          NOT NULL UNIQUE,
    state               TEXT          NOT NULL, -- requested|authorized|settling|settled|rejected|failed|retrying|failed_permanent
    reject_reason       TEXT,
    version             INTEGER       NOT NULL DEFAULT 0,
    created_at          BIGINT        NOT NULL  -- epoch ms (to match domain)
);

CREATE INDEX idx_draws_principal ON draws (principal_id);
CREATE INDEX idx_draws_authorization ON draws (authorization_id);
-- The UNIQUE constraint on idempotency_key implicitly creates an index.

-- Settlements are an ENTITY inside the Draw aggregate. We store them in a
-- separate table with a 1:1 relationship to draws, always loaded together.
CREATE TABLE settlements (
    id                      BIGSERIAL PRIMARY KEY,
    draw_id                 TEXT      NOT NULL UNIQUE REFERENCES draws(id),
    state                   TEXT      NOT NULL, -- pending|submitted|confirming|confirmed|reverted|retrying_settlement|failed_permanent_settlement
    rail_tx_hash            TEXT,
    rail_network            TEXT,
    confirmations           INTEGER   NOT NULL DEFAULT 0,
    required_confirmations  INTEGER   NOT NULL,
    attempt_count           INTEGER   NOT NULL DEFAULT 0,
    confirmed_at            BIGINT              -- epoch ms
);

-- We don't need a separate index on draw_id because of the UNIQUE constraint.
