-- 023_agent_traces.down.sql — reverts database/migrations/023_agent_traces.sql.
-- LOCAL / EPHEMERAL DATABASES ONLY (outside database/migrations/ so the runner never applies it).
BEGIN;
DROP TABLE IF EXISTS model_traces;
DROP TABLE IF EXISTS tool_calls;
DROP TABLE IF EXISTS agent_runs;
DELETE FROM schema_migrations WHERE filename = '023_agent_traces.sql';
COMMIT;
