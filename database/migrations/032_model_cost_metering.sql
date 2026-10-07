-- 032_model_cost_metering — Phase 6 item 3 (model router tiers + per-call cost metering)
--
-- Additive, nullable columns on model_traces (023) so every LLM call records what it cost and on
-- whose behalf, for aggregation per user (agent_runs.principal_id), strategy, opportunity and
-- machine request. Cost is integer micro-USD (1e-6 USD) computed from the provider's reported token
-- usage and the versioned price table in apps/api/src/trading_agent/agent/pricing.mjs; a call whose
-- model has no price is recorded with cost_priced = false (never guessed).
--
-- * No existing column, constraint or row changes. model_traces stays append-only (023's REVOKE).
-- * Down: database/migrations-down/032_model_cost_metering.down.sql (local/ephemeral only).
ALTER TABLE model_traces
    ADD COLUMN tier                TEXT    CHECK (tier IN ('fast', 'standard', 'deep')),
    ADD COLUMN task_type           TEXT    CHECK (task_type IS NULL OR char_length(task_type) <= 64),
    ADD COLUMN cache_read_tokens   INTEGER CHECK (cache_read_tokens >= 0),
    ADD COLUMN cache_write_tokens  INTEGER CHECK (cache_write_tokens >= 0),
    ADD COLUMN cost_usd_micro      BIGINT  CHECK (cost_usd_micro >= 0),
    ADD COLUMN cost_priced         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN price_version       TEXT,
    ADD COLUMN strategy_id         TEXT,
    ADD COLUMN opportunity_id      TEXT,
    ADD COLUMN machine_request_id  TEXT,
    ADD CONSTRAINT model_traces_cost_priced_ck CHECK (NOT cost_priced OR (cost_usd_micro IS NOT NULL AND price_version IS NOT NULL));

CREATE INDEX idx_model_traces_strategy ON model_traces (strategy_id) WHERE strategy_id IS NOT NULL;
CREATE INDEX idx_model_traces_opportunity ON model_traces (opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX idx_model_traces_machine_request ON model_traces (machine_request_id) WHERE machine_request_id IS NOT NULL;
