-- 024_backtests.down.sql — reverts database/migrations/024_backtests.sql.
-- LOCAL / EPHEMERAL DATABASES ONLY (outside database/migrations/ so the runner never applies it).
BEGIN;
DROP TRIGGER IF EXISTS backtests_guard ON backtests;
DROP TABLE IF EXISTS backtests;
DROP FUNCTION IF EXISTS backtests_guard();
DELETE FROM schema_migrations WHERE filename = '024_backtests.sql';
COMMIT;
