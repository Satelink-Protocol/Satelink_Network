-- 021_trading_foundation.down.sql — reverts database/migrations/021_trading_foundation.sql.
--
-- LOCAL / EPHEMERAL DATABASES ONLY. Lives outside database/migrations/ so
-- database/runner.ts never applies it (the runner is forward-only by design).
-- Drops ONLY the 14 tables created by 021 (reverse dependency order) and its
-- schema_migrations row so the up migration can be re-applied. It touches no
-- pre-existing table. Never run against a shared or production database.

BEGIN;

DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS trading_outbox;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS fills;
DROP TABLE IF EXISTS order_events;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS signals;
DROP TABLE IF EXISTS risk_policies;
DROP TABLE IF EXISTS mandates;
DROP TABLE IF EXISTS strategy_versions;
DROP TABLE IF EXISTS strategies;
DROP TABLE IF EXISTS broker_credential_ciphertexts;
DROP TABLE IF EXISTS broker_credentials_metadata;
DROP TABLE IF EXISTS broker_accounts;

DELETE FROM schema_migrations WHERE filename = '021_trading_foundation.sql';

COMMIT;
