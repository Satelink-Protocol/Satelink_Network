-- 028_portfolio.sql
-- Stage 18 (trading agent): portfolio, P&L and broker reconciliation. ADDITIVE ONLY.
--
-- NEW portfolio_snapshots and reconciliation_events (append-only: UPDATE/DELETE revoked),
-- NEW portfolio_consumer_cursors (the fill consumer's durable position in order_events),
-- and additive positions (021) columns for fees, fill count and unconverted fees.
-- Fills keep ledger_txn_id NULL: nothing here writes the ledger.
-- Down: database/migrations-down/028_portfolio.down.sql (local/ephemeral only).

ALTER TABLE positions
    ADD COLUMN fees_minor        NUMERIC(38,0) NOT NULL DEFAULT 0 CHECK (fees_minor >= 0),
    ADD COLUMN fill_count        INTEGER NOT NULL DEFAULT 0 CHECK (fill_count >= 0),
    ADD COLUMN last_fill_at      TIMESTAMPTZ,
    ADD COLUMN unconverted_fees  JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE positions ADD CONSTRAINT positions_flat_has_no_avg CHECK ((quantity = 0) = (avg_entry_price IS NULL));
CREATE INDEX idx_positions_principal ON positions (principal_id, broker_account_id, mode);

CREATE TABLE portfolio_snapshots (
    id                    TEXT        PRIMARY KEY,                        -- 'pfs_…'
    principal_id          TEXT        NOT NULL REFERENCES principals(id),
    broker_account_id     TEXT        NOT NULL REFERENCES broker_accounts(id),
    mode                  TEXT        NOT NULL CHECK (mode IN ('paper', 'live')),
    taken_at              TIMESTAMPTZ NOT NULL,
    currency              TEXT        NOT NULL,
    decimals              SMALLINT    NOT NULL CHECK (decimals BETWEEN 0 AND 18),
    positions             JSONB       NOT NULL,
    realized_pnl_minor    NUMERIC(38,0) NOT NULL,
    unrealized_pnl_minor  NUMERIC(38,0),                                  -- NULL when any mark was missing/stale
    gross_exposure_minor  NUMERIC(38,0),
    net_exposure_minor    NUMERIC(38,0),
    fees_minor            NUMERIC(38,0) NOT NULL DEFAULT 0,
    marks_complete        BOOLEAN     NOT NULL,
    snapshot_hash         TEXT        NOT NULL CHECK (snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (marks_complete = (unrealized_pnl_minor IS NOT NULL))
);
CREATE INDEX idx_portfolio_snapshots_account ON portfolio_snapshots (principal_id, broker_account_id, taken_at DESC);

CREATE TABLE reconciliation_events (
    seq                     BIGSERIAL   UNIQUE,
    id                      TEXT        PRIMARY KEY,                      -- 'rce_…'
    principal_id            TEXT        NOT NULL REFERENCES principals(id),
    broker_account_id       TEXT        NOT NULL REFERENCES broker_accounts(id),
    mode                    TEXT        NOT NULL CHECK (mode IN ('paper', 'live')),
    checked_at              TIMESTAMPTZ NOT NULL,
    status                  TEXT        NOT NULL CHECK (status IN ('match', 'mismatch', 'error')),
    consecutive_mismatches  INTEGER     NOT NULL CHECK (consecutive_mismatches >= 0),
    action                  TEXT        NOT NULL CHECK (action IN ('none', 'paused', 'already_paused', 'pause_failed')),
    broker_as_of            TIMESTAMPTZ,
    tolerance               JSONB       NOT NULL,
    details                 JSONB       NOT NULL,
    CHECK ((status = 'match') = (consecutive_mismatches = 0)),
    CHECK (status <> 'match' OR action = 'none')
);
CREATE INDEX idx_reconciliation_events_account ON reconciliation_events (principal_id, broker_account_id, mode, checked_at DESC);

CREATE TABLE portfolio_consumer_cursors (
    consumer        TEXT        PRIMARY KEY,
    last_event_id   BIGINT      NOT NULL CHECK (last_event_id >= 0),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE UPDATE, DELETE ON portfolio_snapshots, reconciliation_events FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'REVOKE UPDATE, DELETE ON portfolio_snapshots, reconciliation_events FROM satelink_app';
    END IF;
END
$$;
