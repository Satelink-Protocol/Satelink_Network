-- 007_authorization.sql
-- M5: FundingSource + Authorization (with per-nonce entities).
--
-- ADDITIVE ONLY. New tables; no existing table/constraint/view is modified.
-- Amounts are NUMERIC(38,0) integer minor units (matching Money). Timestamps
-- for validity windows are BIGINT epoch MILLISECONDS. version columns provide
-- optimistic locking. This milestone is READ-ONLY: nothing consumes these for a
-- decision. The CHECK (consumed <= cap) is data-integrity defense-in-depth; the
-- Authorization aggregate is the real enforcer.

CREATE TABLE funding_sources (
    id              TEXT        PRIMARY KEY,
    principal_id    TEXT        NOT NULL REFERENCES principals(id),
    rail_id         TEXT        NOT NULL,
    rail_reference  JSONB       NOT NULL,   -- { refType, refValue }
    mode            TEXT        NOT NULL,   -- prepaid | authorization | escrow
    capabilities    JSONB       NOT NULL,
    state           TEXT        NOT NULL,   -- registered|verified|active|degraded|revoked
    version         INTEGER     NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_funding_sources_principal ON funding_sources (principal_id);

CREATE TABLE authorizations (
    id                  TEXT          PRIMARY KEY,
    principal_id        TEXT          NOT NULL REFERENCES principals(id),
    funding_source_id   TEXT          NOT NULL REFERENCES funding_sources(id),
    cap_amount          NUMERIC(38,0) NOT NULL CHECK (cap_amount > 0),
    currency            TEXT          NOT NULL,
    consumed_amount     NUMERIC(38,0) NOT NULL DEFAULT 0 CHECK (consumed_amount >= 0),
    valid_after         BIGINT        NOT NULL,   -- epoch ms
    valid_before        BIGINT        NOT NULL,   -- epoch ms
    signature_envelope  JSONB         NOT NULL,   -- { scheme, signature, signer }
    state               TEXT          NOT NULL,   -- active | revoked
    version             INTEGER       NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK (consumed_amount <= cap_amount),
    CHECK (valid_after <= valid_before)
);

CREATE INDEX idx_authorizations_principal ON authorizations (principal_id);
CREATE INDEX idx_authorizations_funding_source ON authorizations (funding_source_id);

-- Nonces are an ENTITY inside the Authorization aggregate — always loaded with
-- their root, never queried independently.
CREATE TABLE authorization_nonces (
    id                BIGSERIAL     PRIMARY KEY,
    authorization_id  TEXT          NOT NULL REFERENCES authorizations(id),
    nonce_value       TEXT          NOT NULL,
    valid_after       BIGINT        NOT NULL,   -- epoch ms
    valid_before      BIGINT        NOT NULL,   -- epoch ms
    state             TEXT          NOT NULL,   -- unconsumed | consumed
    consumed_amount   NUMERIC(38,0),
    consumed_at       BIGINT,                   -- epoch ms
    UNIQUE (authorization_id, nonce_value)
);

CREATE INDEX idx_authorization_nonces_auth ON authorization_nonces (authorization_id);
