// Track B (P3.B) — plans catalogue + entitlement ("Dodo bucket") schema.
//
// ADDITIVE ONLY. It never touches api_credits / revenue_events_v2 /
// credit_balances / subscriptions or any existing money-path table, and it does
// NOT modify the existing Dodo webhook (src/routes/internal_dodo.js), which
// already credits fungible USD on subscription payments. This layer adds the
// plan CATALOGUE (the pricing-parity source for the web) and a monthly
// included-call ALLOWANCE bucket (§4.2/§4.5). Wiring the bucket into the live
// billing path is a separate, founder-gated money-path change (see DECISIONS.md)
// — it is NOT done here.
//
// Idempotent (safe on every startup), same style as src/db/migrate.js.
export async function ensurePlansSchema(pool) {
  await pool.query(`
    -- Plan catalogue (Free / Pro / Max). Read-only source for GET /v1/plans.
    CREATE TABLE IF NOT EXISTS plans (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      price_monthly_usd    NUMERIC(10,2) NOT NULL DEFAULT 0,
      price_yearly_usd     NUMERIC(10,2) NOT NULL DEFAULT 0,
      included_calls       INTEGER NOT NULL DEFAULT 0,   -- monthly Trading-Intelligence allowance
      overage_per_call_usd NUMERIC(12,6),                -- NULL for Free
      api_keys             INTEGER NOT NULL DEFAULT 1,
      rate_limit           TEXT NOT NULL DEFAULT 'low',
      active               BOOLEAN NOT NULL DEFAULT true,
      sort                 INTEGER NOT NULL DEFAULT 0
    );

    -- The "Dodo bucket": a monthly included-call allowance, consumed BEFORE
    -- credits, spendable ONLY on Trading Intelligence. Keyed by api_key (the
    -- existing account id). Exists for Free too (the free monthly quota). This
    -- table is new and separate from the money-path api_credits balance.
    CREATE TABLE IF NOT EXISTS plan_entitlements (
      api_key              TEXT PRIMARY KEY,
      plan_id              TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
      source               TEXT NOT NULL DEFAULT 'free' CHECK (source IN ('free','plan')),
      included_calls_total INTEGER NOT NULL DEFAULT 0,
      included_calls_used  INTEGER NOT NULL DEFAULT 0,
      period_start         TIMESTAMPTZ NOT NULL DEFAULT now(),
      period_end           TIMESTAMPTZ NOT NULL,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_plan_entitlements_period ON plan_entitlements(period_end);
  `);

  // Seed the plan catalogue (idempotent). Values mirror apps/web/src/lib/plans.ts.
  await pool.query(`
    INSERT INTO plans (id, name, price_monthly_usd, price_yearly_usd, included_calls, overage_per_call_usd, api_keys, rate_limit, sort)
    VALUES
      ('free','Free',   0,   0,     300, NULL,    1,'low',      0),
      ('pro','Pro',    19, 190,    2500, 0.008,   5,'standard', 1),
      ('max','Max',    79, 790,   12000, 0.007,  20,'high',     2)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      price_monthly_usd = EXCLUDED.price_monthly_usd,
      price_yearly_usd = EXCLUDED.price_yearly_usd,
      included_calls = EXCLUDED.included_calls,
      overage_per_call_usd = EXCLUDED.overage_per_call_usd,
      api_keys = EXCLUDED.api_keys,
      rate_limit = EXCLUDED.rate_limit,
      sort = EXCLUDED.sort;
  `);
}
