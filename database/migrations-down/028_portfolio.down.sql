-- 028_portfolio.down.sql — reverts database/migrations/028_portfolio.sql.
-- LOCAL / EPHEMERAL DATABASES ONLY (outside database/migrations/ so the runner never applies it).
BEGIN;
DROP TABLE IF EXISTS portfolio_consumer_cursors;
DROP TABLE IF EXISTS reconciliation_events;
DROP TABLE IF EXISTS portfolio_snapshots;
DROP INDEX IF EXISTS idx_positions_principal;
ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_flat_has_no_avg;
ALTER TABLE positions DROP COLUMN IF EXISTS fees_minor, DROP COLUMN IF EXISTS fill_count,
                      DROP COLUMN IF EXISTS last_fill_at, DROP COLUMN IF EXISTS unconverted_fees;
DELETE FROM schema_migrations WHERE filename = '028_portfolio.sql';
COMMIT;
