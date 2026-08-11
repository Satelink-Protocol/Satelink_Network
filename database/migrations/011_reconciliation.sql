-- 011_reconciliation.sql
-- M7: Reconciler + settlement poller state.
--
-- Two purely additive tables. No changes to existing tables.
--
-- 1. reconciliation_state — single-row snapshot of the last reconciler cycle
--    plus the halt flag. The endpoint /internal/reconciliation reads this row.
-- 2. outbox — append-only domain events. The outbox-publisher drains it
--    at-least-once; consumers dedupe on event_id (the primary key).

-- ═══════════════════════════════════════════════════════════════
-- 1. reconciliation_state (exactly one row, id = 1)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE reconciliation_state (
    id                     integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_run_at            timestamptz,
    -- signed sum of (ledger amount − chain amount) across reconciled rows,
    -- in integer minor units. numeric(38,0) so it is exact and can be negative.
    drift_minor_units      numeric(38,0) NOT NULL DEFAULT 0,
    halted                 boolean       NOT NULL DEFAULT false,
    halt_reason            text,
    stuck_settlement_count integer       NOT NULL DEFAULT 0,
    reconciled_count       integer       NOT NULL DEFAULT 0,
    cycle_duration_ms      integer       NOT NULL DEFAULT 0,
    updated_at             timestamptz   NOT NULL DEFAULT now()
);

-- Seed the single row so the endpoint always has something to read.
INSERT INTO reconciliation_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 2. outbox (append-only domain events)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE outbox (
    -- Deterministic id (e.g. 'reconcile:drift:<cycle>') so re-emitting the same
    -- logical event is a no-op → consumers are idempotent, publish is at-least-once.
    event_id     text PRIMARY KEY,
    event_type   text        NOT NULL,
    severity     text        NOT NULL DEFAULT 'info'
                   CHECK (severity IN ('info', 'warning', 'critical')),
    payload      jsonb       NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    -- NULL = not yet published. Set only after successful delivery.
    published_at timestamptz
);

-- Fast scan for the publisher: unpublished rows, oldest first.
CREATE INDEX idx_outbox_unpublished ON outbox (created_at) WHERE published_at IS NULL;
