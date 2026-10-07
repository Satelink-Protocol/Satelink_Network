-- 027_oms.sql
-- Stage 17 (trading agent): order management system. ADDITIVE ONLY (extends 021).
--
-- orders: adds the 'unknown' status (timeouts / ambiguous submits — resolved only by
-- reconciliation), OMS bookkeeping columns, and a trigger that (a) allows only the
-- OMS transition table (mirrors apps/api/src/trading_agent/oms/states.mjs, plus the
-- Stage 16 mandate-cancellation edges), (b) keeps an order's identity immutable —
-- in particular client_order_id, so a resend can never use a new id — and
-- (c) freezes terminal orders. trading_outbox (021) gains last_error and an index.
-- Down: database/migrations-down/027_oms.down.sql (local/ephemeral only).

ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN (
    'proposed', 'approved', 'rejected', 'submitted', 'acknowledged', 'partially_filled', 'filled',
    'cancel_requested', 'cancelled', 'expired', 'failed', 'unknown'));

ALTER TABLE orders
    ADD COLUMN risk_decision_id    TEXT,
    ADD COLUMN mandate_terms_hash  TEXT CHECK (mandate_terms_hash ~ '^sha256:[0-9a-f]{64}$'),
    ADD COLUMN venue               TEXT CHECK (venue IN ('binance', 'upstox', 'alpaca', 'mock')),
    ADD COLUMN filled_quantity     NUMERIC(38,18) NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
    ADD COLUMN avg_fill_price      NUMERIC(38,18) CHECK (avg_fill_price > 0),
    ADD COLUMN sent_at             TIMESTAMPTZ,
    ADD COLUMN acknowledged_at     TIMESTAMPTZ,
    ADD COLUMN unknown_since       TIMESTAMPTZ,
    ADD COLUMN last_reconciled_at  TIMESTAMPTZ,
    ADD COLUMN reconcile_attempts  INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_attempts >= 0),
    ADD COLUMN dispatch_count      INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_count >= 0),
    ADD COLUMN last_error          TEXT;
ALTER TABLE orders ADD CONSTRAINT orders_unknown_has_since CHECK (status <> 'unknown' OR unknown_since IS NOT NULL);
ALTER TABLE orders ADD CONSTRAINT orders_fill_within_quantity CHECK (filled_quantity <= quantity);
CREATE INDEX idx_orders_reconcile ON orders (status, created_at) WHERE status IN ('submitted', 'unknown', 'acknowledged', 'partially_filled', 'cancel_requested');

ALTER TABLE trading_outbox ADD COLUMN last_error TEXT;
CREATE INDEX idx_trading_outbox_aggregate ON trading_outbox (aggregate_type, aggregate_id);

CREATE FUNCTION oms_orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'orders rows cannot be deleted';
    END IF;
    IF OLD.status IN ('filled', 'cancelled', 'rejected', 'expired', 'failed') THEN
        RAISE EXCEPTION 'order % is terminal (%)', OLD.id, OLD.status;
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.client_order_id IS DISTINCT FROM OLD.client_order_id
       OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.principal_id IS DISTINCT FROM OLD.principal_id
       OR NEW.mandate_id IS DISTINCT FROM OLD.mandate_id OR NEW.broker_account_id IS DISTINCT FROM OLD.broker_account_id
       OR NEW.instrument IS DISTINCT FROM OLD.instrument OR NEW.side IS DISTINCT FROM OLD.side OR NEW.order_type IS DISTINCT FROM OLD.order_type
       OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.limit_price IS DISTINCT FROM OLD.limit_price OR NEW.stop_price IS DISTINCT FROM OLD.stop_price
       OR NEW.mode IS DISTINCT FROM OLD.mode OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (OLD.venue IS NOT NULL AND NEW.venue IS DISTINCT FROM OLD.venue)
       OR (OLD.broker_order_id IS NOT NULL AND NEW.broker_order_id IS DISTINCT FROM OLD.broker_order_id) THEN
        RAISE EXCEPTION 'order %: identity columns are immutable', OLD.id;
    END IF;
    IF NEW.filled_quantity < OLD.filled_quantity THEN
        RAISE EXCEPTION 'order %: filled quantity cannot decrease', OLD.id;
    END IF;
    IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN (
        -- OMS-TRANSITIONS-BEGIN (kept identical to oms/states.mjs TRANSITIONS; checked by a test)
        ('approved', 'submitted'), ('approved', 'cancelled'), ('approved', 'rejected'),
        ('submitted', 'acknowledged'), ('submitted', 'partially_filled'), ('submitted', 'filled'), ('submitted', 'cancelled'),
        ('submitted', 'rejected'), ('submitted', 'unknown'), ('submitted', 'approved'), ('submitted', 'cancel_requested'),
        ('unknown', 'acknowledged'), ('unknown', 'partially_filled'), ('unknown', 'filled'), ('unknown', 'cancelled'),
        ('unknown', 'rejected'), ('unknown', 'approved'), ('unknown', 'cancel_requested'),
        ('acknowledged', 'partially_filled'), ('acknowledged', 'filled'), ('acknowledged', 'cancelled'), ('acknowledged', 'rejected'),
        ('acknowledged', 'cancel_requested'), ('acknowledged', 'unknown'),
        ('partially_filled', 'filled'), ('partially_filled', 'cancelled'), ('partially_filled', 'cancel_requested'), ('partially_filled', 'unknown'),
        ('cancel_requested', 'cancelled'), ('cancel_requested', 'filled'),
        -- OMS-TRANSITIONS-END
        ('proposed', 'approved'), ('proposed', 'rejected'), ('proposed', 'cancelled')  -- pre-OMS proposals (Stage 16 cancels them)
    ) THEN
        RAISE EXCEPTION 'order %: illegal status transition % -> %', OLD.id, OLD.status, NEW.status;
    END IF;
    RETURN NEW;
END
$$;
CREATE TRIGGER oms_orders_guard BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION oms_orders_guard();
