-- Rollback for 033_trading_decisions (local / ephemeral databases only). Run before 029's down.
DROP TABLE IF EXISTS trading_decisions;
DELETE FROM schema_migrations WHERE filename = '033_trading_decisions.sql';
