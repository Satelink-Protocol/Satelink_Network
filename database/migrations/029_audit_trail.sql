-- 029_audit_trail.sql
-- Stage 19 (trading agent): append-only audit trail + W3C trace propagation. ADDITIVE ONLY.
--
-- 1. APPEND-ONLY FOR EVERY ROLE. REVOKE (021–028) is inert for a superuser, and production
--    connects as one today (004 header, audit 07 §4). A BEFORE UPDATE OR DELETE row trigger and
--    a BEFORE TRUNCATE statement trigger raise for every role, superusers included. No role is
--    created, altered or re-granted, so nothing conflicts with existing DB roles.
--    (A superuser can still DISABLE TRIGGER; only repointing DATABASE_URL to the non-superuser
--    satelink_app role closes that — B-07 / audit 06 S-12.)
-- 2. TRACE PROPAGATION agent_run → signal → risk decision → order → order events → fills
--    (→ ledger via fills.ledger_txn_id when trading P&L is ever posted). trace_id / span_id /
--    parent_span_id are W3C Trace Context ids. A BEFORE INSERT trigger stamps them from the
--    session settings satelink.trace_id / satelink.span_id (set by trading/audit tracedPool),
--    or inherits them from the parent row (order → order_events / fills; agent run → tool calls
--    / model traces), so asynchronous workers (dispatcher, fill consumer) stay on the trace.
-- Down: database/migrations-down/029_audit_trail.down.sql (local/ephemeral only).

-- ── append-only ────────────────────────────────────────────────────────────────
CREATE FUNCTION trading_append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'append-only table %: % is not allowed (write a new row instead)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'insufficient_privilege';
END
$$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['audit_events', 'order_events', 'fills', 'strategy_versions', 'tool_calls', 'model_traces',
                             'kill_switch_events', 'reconciliation_events', 'portfolio_snapshots'] LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION trading_append_only_guard()', t || '_append_only', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION trading_append_only_guard()', t || '_no_truncate', t);
    END LOOP;
END
$$;

-- ── trace columns ──────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['agent_runs', 'tool_calls', 'model_traces', 'signals', 'orders', 'order_events', 'fills', 'audit_events', 'kill_switch_events'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN trace_id TEXT CHECK (trace_id ~ ''^[0-9a-f]{32}$'' AND trace_id <> ''00000000000000000000000000000000'')', t);
        EXECUTE format('ALTER TABLE %I ADD COLUMN span_id TEXT CHECK (span_id ~ ''^[0-9a-f]{16}$'')', t);
        EXECUTE format('ALTER TABLE %I ADD COLUMN parent_span_id TEXT CHECK (parent_span_id ~ ''^[0-9a-f]{16}$'')', t);
        EXECUTE format('CREATE INDEX %I ON %I (trace_id) WHERE trace_id IS NOT NULL', 'idx_' || t || '_trace', t);
    END LOOP;
END
$$;

-- New 16-hex span id (W3C span ids must not be all zeros).
CREATE FUNCTION trading_new_span_id() RETURNS text LANGUAGE sql VOLATILE AS $$
    SELECT lpad(to_hex((floor(random() * 2147483646) + 1)::bigint), 8, '0') || lpad(to_hex(floor(random() * 2147483647)::bigint), 8, '0')
$$;

-- Stamp from the session trace context (set by tracedPool); untraced writes stay NULL.
CREATE FUNCTION trading_stamp_trace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    ctx_trace text := nullif(current_setting('satelink.trace_id', true), '');
    ctx_span  text := nullif(current_setting('satelink.span_id', true), '');
BEGIN
    IF NEW.trace_id IS NULL THEN NEW.trace_id := ctx_trace; NEW.parent_span_id := COALESCE(NEW.parent_span_id, ctx_span); END IF;
    IF NEW.trace_id IS NOT NULL AND NEW.span_id IS NULL THEN NEW.span_id := trading_new_span_id(); END IF;
    RETURN NEW;
END
$$;

-- Children inherit their parent's trace when written outside the original context.
CREATE FUNCTION trading_inherit_order_trace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_trace text; p_span text;
BEGIN
    IF NEW.trace_id IS NULL THEN
        SELECT trace_id, span_id INTO p_trace, p_span FROM orders WHERE id = NEW.order_id;
        NEW.trace_id := COALESCE(p_trace, nullif(current_setting('satelink.trace_id', true), ''));
        NEW.parent_span_id := COALESCE(NEW.parent_span_id, p_span, nullif(current_setting('satelink.span_id', true), ''));
    END IF;
    IF NEW.trace_id IS NOT NULL AND NEW.span_id IS NULL THEN NEW.span_id := trading_new_span_id(); END IF;
    RETURN NEW;
END
$$;

CREATE FUNCTION trading_inherit_run_trace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_trace text; p_span text;
BEGIN
    IF NEW.trace_id IS NULL THEN
        SELECT trace_id, span_id INTO p_trace, p_span FROM agent_runs WHERE id = NEW.run_id;
        NEW.trace_id := COALESCE(p_trace, nullif(current_setting('satelink.trace_id', true), ''));
        NEW.parent_span_id := COALESCE(NEW.parent_span_id, p_span);
    END IF;
    IF NEW.trace_id IS NOT NULL AND NEW.span_id IS NULL THEN NEW.span_id := trading_new_span_id(); END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER agent_runs_trace BEFORE INSERT ON agent_runs FOR EACH ROW EXECUTE FUNCTION trading_stamp_trace();
CREATE TRIGGER signals_trace BEFORE INSERT ON signals FOR EACH ROW EXECUTE FUNCTION trading_stamp_trace();
CREATE TRIGGER orders_trace BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION trading_stamp_trace();
CREATE TRIGGER audit_events_trace BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION trading_stamp_trace();
CREATE TRIGGER kill_switch_events_trace BEFORE INSERT ON kill_switch_events FOR EACH ROW EXECUTE FUNCTION trading_stamp_trace();
CREATE TRIGGER order_events_trace BEFORE INSERT ON order_events FOR EACH ROW EXECUTE FUNCTION trading_inherit_order_trace();
CREATE TRIGGER fills_trace BEFORE INSERT ON fills FOR EACH ROW EXECUTE FUNCTION trading_inherit_order_trace();
CREATE TRIGGER tool_calls_trace BEFORE INSERT ON tool_calls FOR EACH ROW EXECUTE FUNCTION trading_inherit_run_trace();
CREATE TRIGGER model_traces_trace BEFORE INSERT ON model_traces FOR EACH ROW EXECUTE FUNCTION trading_inherit_run_trace();
