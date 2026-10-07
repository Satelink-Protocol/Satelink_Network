-- 027_oms.down.sql — reverts database/migrations/027_oms.sql.
-- LOCAL / EPHEMERAL DATABASES ONLY (outside database/migrations/ so the runner never applies it).
-- Fails if any order is in status 'unknown' (as it should: resolve those first).
BEGIN;
DROP TRIGGER IF EXISTS oms_orders_guard ON orders;
DROP FUNCTION IF EXISTS oms_orders_guard();
DROP INDEX IF EXISTS idx_orders_reconcile;
DROP INDEX IF EXISTS idx_trading_outbox_aggregate;
ALTER TABLE trading_outbox DROP COLUMN IF EXISTS last_error;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_unknown_has_since;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_fill_within_quantity;
ALTER TABLE orders
    DROP COLUMN IF EXISTS risk_decision_id, DROP COLUMN IF EXISTS mandate_terms_hash, DROP COLUMN IF EXISTS venue,
    DROP COLUMN IF EXISTS filled_quantity, DROP COLUMN IF EXISTS avg_fill_price, DROP COLUMN IF EXISTS sent_at,
    DROP COLUMN IF EXISTS acknowledged_at, DROP COLUMN IF EXISTS unknown_since, DROP COLUMN IF EXISTS last_reconciled_at,
    DROP COLUMN IF EXISTS reconcile_attempts, DROP COLUMN IF EXISTS dispatch_count, DROP COLUMN IF EXISTS last_error;
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
    'proposed', 'approved', 'rejected', 'submitted', 'acknowledged', 'partially_filled', 'filled',
    'cancel_requested', 'cancelled', 'expired', 'failed'));
DELETE FROM schema_migrations WHERE filename = '027_oms.sql';
COMMIT;
