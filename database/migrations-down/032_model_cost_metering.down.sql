-- Rollback for 032_model_cost_metering (local / ephemeral databases only). Run before 023's down.
DROP INDEX IF EXISTS idx_model_traces_machine_request;
DROP INDEX IF EXISTS idx_model_traces_opportunity;
DROP INDEX IF EXISTS idx_model_traces_strategy;
ALTER TABLE model_traces
    DROP CONSTRAINT IF EXISTS model_traces_cost_priced_ck,
    DROP COLUMN IF EXISTS machine_request_id,
    DROP COLUMN IF EXISTS opportunity_id,
    DROP COLUMN IF EXISTS strategy_id,
    DROP COLUMN IF EXISTS price_version,
    DROP COLUMN IF EXISTS cost_priced,
    DROP COLUMN IF EXISTS cost_usd_micro,
    DROP COLUMN IF EXISTS cache_write_tokens,
    DROP COLUMN IF EXISTS cache_read_tokens,
    DROP COLUMN IF EXISTS task_type,
    DROP COLUMN IF EXISTS tier;
DELETE FROM schema_migrations WHERE filename = '032_model_cost_metering.sql';
