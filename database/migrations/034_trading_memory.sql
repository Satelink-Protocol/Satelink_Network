-- 034_trading_memory — Phase 6 item 9 (trading memory + feedback)
--
-- Structured memory the AI layer retrieves INSTEAD of chat history, and the evidence the feedback
-- loop learns from. Everything except the user profile is append-only (029 trading_append_only_guard):
-- outcomes and approvals are new rows, never edits.
--   user_trading_profile   one row per principal (risk tolerance, capital, markets, max loss) — updatable, versioned
--   strategy_memory        per strategy version: backtest / walk-forward / stress / paper / live / regime evidence, failure modes, revisions
--   decision_memory        opportunity → evidence → score → decision → authorization → outcome (one row per step)
--   trade_memory           fills → P&L, regime, score, execution quality
--   error_memory           errors worth remembering (scope, code, context)
--   calibration_proposals  scorecard re-weighting proposals from the feedback job (NEW config version)
--   calibration_decisions  the human decision on a proposal (approve / reject) — nothing applies without one
--
-- * Additive. Depends on 029 (guard) and 033 (trading_decisions).
-- * Down: database/migrations-down/034_trading_memory.down.sql (local/ephemeral only; before 033's and 029's downs).
CREATE TABLE user_trading_profile (
    principal_id     TEXT        PRIMARY KEY REFERENCES principals(id),
    risk_tolerance   TEXT        NOT NULL CHECK (risk_tolerance IN ('low', 'medium', 'high')),
    capital          TEXT        CHECK (capital ~ '^[0-9]+(\.[0-9]+)?$'),
    currency         TEXT        NOT NULL DEFAULT 'USDT',
    max_loss         TEXT        CHECK (max_loss ~ '^[0-9]+(\.[0-9]+)?$'),
    markets          TEXT[]      NOT NULL DEFAULT '{}',
    brokers          TEXT[]      NOT NULL DEFAULT '{}',
    version          INTEGER     NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at       TIMESTAMPTZ NOT NULL
);

CREATE TABLE strategy_memory (
    id                   TEXT        PRIMARY KEY,
    strategy_version_id  TEXT        NOT NULL,
    kind                 TEXT        NOT NULL CHECK (kind IN ('backtest', 'walk_forward', 'stress', 'paper', 'live', 'regime', 'revision')),
    regime               TEXT,
    metrics              JSONB       NOT NULL,
    failure_modes        TEXT[]      NOT NULL DEFAULT '{}',
    evidence_ref         TEXT,
    recorded_at          TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_strategy_memory_version ON strategy_memory (strategy_version_id, recorded_at DESC);

CREATE TABLE decision_memory (
    id                 TEXT        PRIMARY KEY,
    decision_id        TEXT        NOT NULL REFERENCES trading_decisions(id),
    entry_kind         TEXT        NOT NULL CHECK (entry_kind IN ('decision', 'authorization', 'outcome')),
    principal_id       TEXT        REFERENCES principals(id),
    opportunity_id     TEXT,
    strategy_version_id TEXT,
    decision           TEXT        CHECK (decision IN ('GO', 'WAIT', 'REJECT')),
    score              SMALLINT    CHECK (score BETWEEN 0 AND 100),
    dimension_scores   JSONB,
    evidence_refs      TEXT[]      NOT NULL DEFAULT '{}',
    authorization_ref  TEXT,
    outcome            TEXT        CHECK (outcome IN ('profit', 'loss', 'flat', 'not_executed')),
    outcome_pnl        TEXT        CHECK (outcome_pnl ~ '^-?[0-9]+(\.[0-9]+)?$'),
    recorded_at        TIMESTAMPTZ NOT NULL,
    CHECK ((entry_kind = 'outcome') = (outcome IS NOT NULL)),
    CHECK (entry_kind <> 'decision' OR (decision IS NOT NULL AND score IS NOT NULL AND dimension_scores IS NOT NULL)),
    CHECK (entry_kind <> 'authorization' OR authorization_ref IS NOT NULL)
);
CREATE UNIQUE INDEX uq_decision_memory_outcome ON decision_memory (decision_id) WHERE entry_kind = 'outcome';
CREATE INDEX idx_decision_memory_principal ON decision_memory (principal_id, recorded_at DESC);

CREATE TABLE trade_memory (
    id                 TEXT        PRIMARY KEY,
    decision_id        TEXT        REFERENCES trading_decisions(id),
    principal_id       TEXT        REFERENCES principals(id),
    order_id           TEXT,
    fill_ids           TEXT[]      NOT NULL DEFAULT '{}',
    instrument         TEXT        NOT NULL,
    pnl                TEXT        NOT NULL CHECK (pnl ~ '^-?[0-9]+(\.[0-9]+)?$'),
    regime             TEXT,
    score              SMALLINT    CHECK (score BETWEEN 0 AND 100),
    execution_quality  JSONB,
    closed_at          TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_trade_memory_principal ON trade_memory (principal_id, closed_at DESC);

CREATE TABLE error_memory (
    id           TEXT        PRIMARY KEY,
    scope        TEXT        NOT NULL,
    code         TEXT        NOT NULL,
    detail       TEXT        CHECK (char_length(detail) <= 500),
    context      JSONB,
    principal_id TEXT        REFERENCES principals(id),
    occurred_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_error_memory_principal ON error_memory (principal_id, occurred_at DESC);

CREATE TABLE calibration_proposals (
    id            TEXT        PRIMARY KEY,
    from_version  TEXT        NOT NULL,
    to_version    TEXT        NOT NULL,
    weights       JSONB       NOT NULL,
    report        JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL,
    CHECK (from_version <> to_version)
);

CREATE TABLE calibration_decisions (
    proposal_id   TEXT        PRIMARY KEY REFERENCES calibration_proposals(id),
    decision      TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected')),
    decided_by    TEXT        NOT NULL REFERENCES principals(id),
    step_up_method TEXT       NOT NULL,
    decided_at    TIMESTAMPTZ NOT NULL
);

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['strategy_memory', 'decision_memory', 'trade_memory', 'error_memory', 'calibration_proposals', 'calibration_decisions'] LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trading_append_only_guard()', t || '_append_only', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION trading_append_only_guard()', t || '_no_truncate', t);
        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM PUBLIC', t);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
            EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM satelink_app', t);
        END IF;
    END LOOP;
END
$$;
