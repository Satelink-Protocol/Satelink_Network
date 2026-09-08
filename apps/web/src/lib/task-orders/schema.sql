-- task_orders — isolated table for the "500 Verified Local Business Leads"
-- task-commerce product (Dodo Payments checkout + Apify fulfillment).
--
-- Deliberately separate from apps/api's money-path tables (api_credits,
-- ledger_entries, revenue_events_v2, credit_balances, ...). Nothing in this
-- feature reads or writes any of those.
--
-- Applied defensively (CREATE TABLE IF NOT EXISTS) by db.ts on first use, the
-- same pattern apps/api/server.js uses for its own tables — there is no
-- migration runner wired to apps/web. Idempotent; safe to also run by hand:
--   psql "$DATABASE_URL" -f apps/web/src/lib/task-orders/schema.sql

CREATE TABLE IF NOT EXISTS task_orders (
  id                    SERIAL PRIMARY KEY,
  order_ref             TEXT UNIQUE NOT NULL,        -- generated before checkout; carried as metadata_order_ref on the Dodo link, matched back on webhook
  status                TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | paid | fulfilled | failed
  city                  TEXT NOT NULL,
  category              TEXT NOT NULL,
  buyer_email           TEXT NOT NULL,               -- collected on the landing-page form
  price_inr             NUMERIC(10,2) NOT NULL DEFAULT 499.00,
  dodo_payment_id       TEXT,                         -- set once the webhook confirms payment
  dodo_customer_email   TEXT,                         -- email Dodo reports at checkout (cross-check against buyer_email)
  apify_run_id          TEXT,                         -- set by the manual fulfillment script
  raw_webhook_payload   JSONB,                        -- full payment.succeeded body, for audit/debug on a brand-new integration
  paid_at               TIMESTAMPTZ,
  fulfilled_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_orders_status ON task_orders (status);
CREATE INDEX IF NOT EXISTS idx_task_orders_buyer_email ON task_orders (buyer_email);
