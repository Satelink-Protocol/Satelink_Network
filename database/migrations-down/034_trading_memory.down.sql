-- Rollback for 034_trading_memory (local / ephemeral databases only). Run before 033's and 029's downs.
DROP TABLE IF EXISTS calibration_decisions;
DROP TABLE IF EXISTS calibration_proposals;
DROP TABLE IF EXISTS error_memory;
DROP TABLE IF EXISTS trade_memory;
DROP TABLE IF EXISTS decision_memory;
DROP TABLE IF EXISTS strategy_memory;
DROP TABLE IF EXISTS user_trading_profile;
DELETE FROM schema_migrations WHERE filename = '034_trading_memory.sql';
