-- 023_agent_traces.sql
-- Stage 12 (trading agent): agent trace capture. ADDITIVE ONLY.
--
-- Three NEW tables; FK targets only principals(id) and each other. Every payload
-- column is *_redacted: application code (apps/api/src/trading_agent/agent/trace.mjs)
-- redacts secrets before insert. tool_calls and model_traces are append-only
-- (UPDATE/DELETE revoked from PUBLIC and satelink_app; see 004/017 for the
-- superuser caveat). agent_runs is updated once, to finish the run.
-- Down: database/migrations-down/023_agent_traces.down.sql (local/ephemeral only).

CREATE TABLE agent_runs (
    id                     TEXT        PRIMARY KEY,                        -- 'run_…'
    principal_id           TEXT        NOT NULL REFERENCES principals(id),
    status                 TEXT        NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'aborted')),
    goal_redacted          TEXT        NOT NULL,
    final_output_redacted  TEXT,
    error_redacted         TEXT,
    step_count             INTEGER     CHECK (step_count >= 0),
    started_at             TIMESTAMPTZ NOT NULL,
    finished_at            TIMESTAMPTZ,
    CHECK (status = 'running' OR finished_at IS NOT NULL)
);
CREATE INDEX idx_agent_runs_principal ON agent_runs (principal_id, started_at DESC);

CREATE TABLE tool_calls (
    id                TEXT        PRIMARY KEY,                             -- 'tc_…'
    run_id            TEXT        NOT NULL REFERENCES agent_runs(id),
    seq               INTEGER     NOT NULL CHECK (seq >= 1),
    tool_name         TEXT        NOT NULL,
    tier              TEXT        CHECK (tier IN ('READ', 'CONTROLLED', 'REJECTED')),
    status            TEXT        NOT NULL CHECK (status IN ('ok', 'rejected', 'error')),
    rejection_code    TEXT,
    input_redacted    JSONB,
    output_redacted   JSONB,
    created_at        TIMESTAMPTZ NOT NULL,
    UNIQUE (run_id, seq),
    CHECK (status <> 'rejected' OR (tier = 'REJECTED' AND rejection_code IS NOT NULL))
);

CREATE TABLE model_traces (
    id                  TEXT        PRIMARY KEY,                           -- 'mt_…'
    run_id              TEXT        NOT NULL REFERENCES agent_runs(id),
    seq                 INTEGER     NOT NULL CHECK (seq >= 1),
    task                TEXT        NOT NULL CHECK (task IN ('chat', 'reason', 'structured', 'stream')),
    provider            TEXT        NOT NULL,
    model               TEXT        NOT NULL,
    status              TEXT        NOT NULL CHECK (status IN ('ok', 'fallback', 'error')),
    error_code          TEXT,
    request_redacted    JSONB,
    response_redacted   JSONB,
    input_tokens        INTEGER     CHECK (input_tokens >= 0),
    output_tokens       INTEGER     CHECK (output_tokens >= 0),
    latency_ms          INTEGER     CHECK (latency_ms >= 0),
    created_at          TIMESTAMPTZ NOT NULL,
    UNIQUE (run_id, seq)
);

REVOKE UPDATE, DELETE ON tool_calls, model_traces FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'REVOKE UPDATE, DELETE ON tool_calls, model_traces FROM satelink_app';
    END IF;
END
$$;
