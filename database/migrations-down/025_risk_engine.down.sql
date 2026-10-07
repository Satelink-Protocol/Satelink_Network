-- 025_risk_engine.down.sql — reverts database/migrations/025_risk_engine.sql.
-- LOCAL / EPHEMERAL DATABASES ONLY (outside database/migrations/ so the runner never applies it).
BEGIN;
DROP TRIGGER IF EXISTS risk_policies_immutable ON risk_policies;
DROP FUNCTION IF EXISTS risk_policies_immutable();
DROP INDEX IF EXISTS uq_risk_policies_version;
ALTER TABLE risk_policies DROP COLUMN IF EXISTS limits, DROP COLUMN IF EXISTS policy_hash,
                          DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS created_by_role;
DROP TABLE IF EXISTS kill_switch_events;
DELETE FROM schema_migrations WHERE filename = '025_risk_engine.sql';
COMMIT;
