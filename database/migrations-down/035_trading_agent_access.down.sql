-- Rollback for 035_trading_agent_access (local / ephemeral databases only). Run before 029's down.
DROP TABLE IF EXISTS trading_agent_usage;
DROP TABLE IF EXISTS trading_agent_keys;
DELETE FROM schema_migrations WHERE filename = '035_trading_agent_access.sql';
