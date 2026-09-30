-- 022_market_data_entitlements.down.sql — reverts database/migrations/022_market_data_entitlements.sql.
-- LOCAL / EPHEMERAL DATABASES ONLY (outside database/migrations/ so the runner never applies it).
BEGIN;
DROP TABLE IF EXISTS market_data_entitlements;
DELETE FROM schema_migrations WHERE filename = '022_market_data_entitlements.sql';
COMMIT;
