-- 033_trading_decisions — Phase 6 item 6 (scorecard + hard gates + GO/WAIT/REJECT)
--
-- Every scorecard decision is persisted, append-only (the 029 trading_append_only_guard trigger),
-- with its inputs' hash, dimension scores, failed gates, evidence references and explanation, so a
-- later review (and the memory/feedback loop) can reproduce why Satelink said GO, WAIT or REJECT.
-- The score is decision quality, NOT a probability of profit.
--
-- * Additive: one new table. Depends on 029 (guard function).
-- * Down: database/migrations-down/033_trading_decisions.down.sql (local/ephemeral only; run before 029's down).
CREATE TABLE trading_decisions (
    id                        TEXT        PRIMARY KEY,                      -- 'dec_…'
    decision                  TEXT        NOT NULL CHECK (decision IN ('GO', 'WAIT', 'REJECT')),
    score                     SMALLINT    NOT NULL CHECK (score BETWEEN 0 AND 100),
    confidence                SMALLINT    NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    failed_gates              TEXT[]      NOT NULL DEFAULT '{}',
    gate_details              JSONB       NOT NULL DEFAULT '[]',
    dimension_scores          JSONB       NOT NULL,
    strategy_version_id       TEXT,
    strategy_definition_hash  TEXT,
    data_timestamp            TIMESTAMPTZ,
    expires_at                TIMESTAMPTZ NOT NULL,
    evidence_refs             TEXT[]      NOT NULL DEFAULT '{}',
    explanation               TEXT        NOT NULL,
    config_version            TEXT        NOT NULL,
    input_hash                TEXT        NOT NULL,
    principal_id              TEXT        REFERENCES principals(id),
    instrument                TEXT,
    side                      TEXT        CHECK (side IN ('buy', 'sell')),
    opportunity_id            TEXT,
    decided_at                TIMESTAMPTZ NOT NULL,
    CHECK (decision <> 'REJECT' OR cardinality(failed_gates) > 0),
    CHECK (decision = 'REJECT' OR cardinality(failed_gates) = 0),
    CHECK (expires_at >= decided_at)
);
CREATE INDEX idx_trading_decisions_principal ON trading_decisions (principal_id, decided_at DESC);
CREATE INDEX idx_trading_decisions_strategy ON trading_decisions (strategy_version_id, decided_at DESC);
CREATE INDEX idx_trading_decisions_opportunity ON trading_decisions (opportunity_id) WHERE opportunity_id IS NOT NULL;

CREATE TRIGGER trading_decisions_append_only BEFORE UPDATE OR DELETE ON trading_decisions FOR EACH ROW EXECUTE FUNCTION trading_append_only_guard();
CREATE TRIGGER trading_decisions_no_truncate BEFORE TRUNCATE ON trading_decisions FOR EACH STATEMENT EXECUTE FUNCTION trading_append_only_guard();
REVOKE UPDATE, DELETE, TRUNCATE ON trading_decisions FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON trading_decisions FROM satelink_app';
    END IF;
END
$$;
