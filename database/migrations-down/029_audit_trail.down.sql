-- 029_audit_trail.down.sql — reverts database/migrations/029_audit_trail.sql.
-- LOCAL / EPHEMERAL DATABASES ONLY (outside database/migrations/ so the runner never applies it).
BEGIN;
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['audit_events', 'order_events', 'fills', 'strategy_versions', 'tool_calls', 'model_traces',
                             'kill_switch_events', 'reconciliation_events', 'portfolio_snapshots'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['agent_runs', 'tool_calls', 'model_traces', 'signals', 'orders', 'order_events', 'fills', 'audit_events', 'kill_switch_events'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_trace', t);
        EXECUTE format('DROP INDEX IF EXISTS %I', 'idx_' || t || '_trace');
        EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS trace_id, DROP COLUMN IF EXISTS span_id, DROP COLUMN IF EXISTS parent_span_id', t);
    END LOOP;
END
$$;
DROP FUNCTION IF EXISTS trading_inherit_run_trace();
DROP FUNCTION IF EXISTS trading_inherit_order_trace();
DROP FUNCTION IF EXISTS trading_stamp_trace();
DROP FUNCTION IF EXISTS trading_new_span_id();
DROP FUNCTION IF EXISTS trading_append_only_guard();
DELETE FROM schema_migrations WHERE filename = '029_audit_trail.sql';
COMMIT;
