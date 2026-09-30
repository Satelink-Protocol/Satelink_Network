-- 022_market_data_entitlements.sql
-- Stage 11 (trading agent): market-data licensing boundary. ADDITIVE ONLY.
--
-- One NEW table. No existing table is altered; the only FK target is principals(id).
-- Deny-by-default: application code (apps/api/src/trading_agent/market_data/entitlements.mjs)
-- treats the absence of an active row as DENIED. `redistribution` (serving raw
-- venue data to anyone outside the entitled principal) is a separate, explicit
-- scope and is never implied by `internal_use` or `display`.
-- Terms references point at docs/legal/MARKET_DATA_TERMS.md (legal review pending).
-- Down migration: database/migrations-down/022_market_data_entitlements.down.sql (local/ephemeral only).

CREATE TABLE market_data_entitlements (
    id                TEXT        PRIMARY KEY,                               -- 'mde_…'
    principal_id      TEXT        NOT NULL REFERENCES principals(id),
    venue             TEXT        NOT NULL CHECK (venue IN ('binance', 'upstox', 'alpaca', 'mock')),
    dataset           TEXT        NOT NULL CHECK (dataset IN ('quotes', 'candles', 'order_book', 'trades')),
    scope             TEXT        NOT NULL CHECK (scope IN ('internal_use', 'display', 'redistribution')),
    status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    source_terms_ref  TEXT        NOT NULL,                                   -- e.g. 'docs/legal/MARKET_DATA_TERMS.md#binance'
    granted_by        TEXT        NOT NULL,
    valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at        TIMESTAMPTZ,
    CHECK (valid_until IS NULL OR valid_until > valid_from),
    CHECK (status <> 'revoked' OR revoked_at IS NOT NULL)
);

-- At most one ACTIVE grant per (principal, venue, dataset, scope).
CREATE UNIQUE INDEX idx_md_entitlements_active
    ON market_data_entitlements (principal_id, venue, dataset, scope)
    WHERE status = 'active';
