-- task_orders — isolated table for the "500 Verified Local Business Leads"
-- task-commerce product (Dodo Payments checkout + Apify fulfillment).
--
-- Deliberately separate from apps/api's money-path tables (api_credits,
-- ledger_entries, revenue_events_v2, credit_balances, ...). Nothing in this
-- feature reads or writes any of those.
--
-- SOURCE OF TRUTH for the DDL, applied via an admin connection ONLY. The
-- deployed app role (task_commerce_web) is scoped to SELECT/INSERT/UPDATE on
-- this table alone — no CREATE, no ALTER — so db.ts only ever CONFIRMS this
-- table exists (see ensureTable()); it never creates or migrates it. Any
-- column change here must be applied by hand against production:
--   psql "$ADMIN_DATABASE_URL" -f apps/web/src/lib/task-orders/schema.sql
-- (idempotent — every statement is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- No re-GRANT needed after a column addition: the existing table-level
-- GRANT SELECT, INSERT, UPDATE ON task_orders covers new columns automatically.

CREATE TABLE IF NOT EXISTS task_orders (
  id                    SERIAL PRIMARY KEY,
  order_ref             TEXT UNIQUE NOT NULL,        -- generated before checkout; carried as metadata_order_ref on the Dodo link, matched back on webhook
  status                TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | paid | fulfilled | failed | refunded
  city                  TEXT NOT NULL,
  category              TEXT NOT NULL,
  buyer_email           TEXT NOT NULL,               -- collected on the landing-page form
  price_inr             NUMERIC(10,2) NOT NULL DEFAULT 499.00,
  dodo_payment_id       TEXT,                         -- set once the webhook confirms payment
  dodo_customer_email   TEXT,                         -- email Dodo reports at checkout (cross-check against buyer_email)
  apify_run_id          TEXT,                         -- set by the manual fulfillment script
  apify_cost_usd        NUMERIC(10,4),                -- run's usageTotalUsd, captured by the fulfillment script — feeds analytics.sql
  raw_webhook_payload   JSONB,                        -- full payment.succeeded body, for audit/debug on a brand-new integration
  paid_at               TIMESTAMPTZ,
  fulfilled_at          TIMESTAMPTZ,
  refunded_at           TIMESTAMPTZ,                  -- set by mark_refunded.mjs after a manual Dodo-dashboard refund — see REFUND_RUNBOOK.md
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent on a pre-existing table from an earlier version of this file.
ALTER TABLE task_orders ADD COLUMN IF NOT EXISTS apify_cost_usd NUMERIC(10,4);
ALTER TABLE task_orders ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_task_orders_status ON task_orders (status);
CREATE INDEX IF NOT EXISTS idx_task_orders_buyer_email ON task_orders (buyer_email);
