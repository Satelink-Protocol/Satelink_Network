// apps/api/src/economics/pricing_intelligence/schema.js
//
// Tables + seed data for the Autonomous Pricing Intelligence engine.
//
// Data-honesty contract (CLAUDE.md: no fabricated live metrics):
//   - Every competitor price point carries source_url, observed_at and a
//     confidence label ('published' | 'derived_estimate' | 'unverified').
//   - 'derived_estimate' rows include the derivation in notes (plan price /
//     included quota, with the unit-conversion assumption spelled out).
//   - 'unverified' rows are excluded from market averages/medians until a
//     human confirms them via POST /admin/pricing/competitor.
//   - Seeds are inserted only when the provider slug is absent (ON CONFLICT
//     DO NOTHING) so admin-corrected values are never overwritten.

let ensured = false;

export async function ensurePricingIntelTables(pool) {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_providers (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      website TEXT,
      pricing_url TEXT,
      pricing_model TEXT,              -- 'per_request' | 'compute_units' | 'credits' | 'free_public'
      active BOOLEAN NOT NULL DEFAULT true,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS market_price_points (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NOT NULL REFERENCES market_providers(id) ON DELETE CASCADE,
      plan_name TEXT NOT NULL,
      monthly_price_usd NUMERIC(12,2),         -- null for pure pay-as-you-go
      included_requests_m NUMERIC(14,4),       -- millions of requests (normalized best-effort)
      effective_usd_per_million NUMERIC(14,6), -- headline comparison number; null = excluded from averages
      overage_usd_per_million NUMERIC(14,6),
      free_tier_requests_m_per_month NUMERIC(14,4),
      rate_limit_rps INT,
      chains_count INT,
      requires_signup BOOLEAN NOT NULL DEFAULT true,
      requires_subscription BOOLEAN NOT NULL DEFAULT true,
      supports_x402 BOOLEAN NOT NULL DEFAULT false,
      sla_pct NUMERIC(6,3),
      latency_claim_ms INT,
      source_url TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      confidence TEXT NOT NULL CHECK (confidence IN ('published','derived_estimate','unverified')),
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (provider_id, plan_name)
    );

    CREATE TABLE IF NOT EXISTS pricing_decisions (
      id BIGSERIAL PRIMARY KEY,
      mode TEXT NOT NULL,                       -- 'MANUAL' | 'AUTO'
      current_price_usd NUMERIC(18,9) NOT NULL, -- per call, what the serving path bills today
      recommended_price_usd NUMERIC(18,9) NOT NULL,
      floor_price_usd NUMERIC(18,9) NOT NULL,
      market_median_usd_per_million NUMERIC(14,6),
      market_average_usd_per_million NUMERIC(14,6),
      action TEXT NOT NULL,                     -- 'hold' | 'decrease' | 'increase'
      reason TEXT NOT NULL,
      inputs JSONB NOT NULL,                    -- full evidence bundle the decision was made from
      applied BOOLEAN NOT NULL DEFAULT false,   -- price application is a human step; see PRICING_INTELLIGENCE.md
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_pricing_decisions_created ON pricing_decisions(created_at DESC);
  `);
  await seedProviders(pool);
  ensured = true;
}

// Snapshot of published competitor pricing, researched 2026-07-10. Unit
// conversions (compute units / credits → requests) assume the eth_call cost
// each vendor documents; the assumption is restated in every derived row.
const SEED_OBSERVED_AT = '2026-07-10T00:00:00Z';

const SEED = [
  {
    provider: { slug: 'alchemy', name: 'Alchemy', website: 'https://www.alchemy.com', pricing_url: 'https://www.alchemy.com/pricing', pricing_model: 'compute_units' },
    points: [{
      plan_name: 'Growth', monthly_price_usd: 49, included_requests_m: 15.4,
      effective_usd_per_million: 3.18, free_tier_requests_m_per_month: 11.5,
      requires_signup: true, requires_subscription: true, supports_x402: false,
      source_url: 'https://www.alchemy.com/pricing', observed_at: SEED_OBSERVED_AT,
      confidence: 'derived_estimate',
      notes: 'Growth: $49/mo, 400M compute units. Derived at 26 CU per eth_call → ≈15.4M requests → ≈$3.18/M. Free tier 300M CU/mo ≈ 11.5M requests. Effective rate varies with method mix.',
    }],
  },
  {
    provider: { slug: 'quicknode', name: 'QuickNode', website: 'https://www.quicknode.com', pricing_url: 'https://www.quicknode.com/pricing', pricing_model: 'credits' },
    points: [{
      plan_name: 'Build', monthly_price_usd: 49, included_requests_m: 40,
      effective_usd_per_million: 1.23, free_tier_requests_m_per_month: 5,
      requires_signup: true, requires_subscription: true, supports_x402: false,
      source_url: 'https://www.quicknode.com/pricing', observed_at: SEED_OBSERVED_AT,
      confidence: 'derived_estimate',
      notes: 'Build: $49/mo, 80M API credits. Derived at 2 credits per eth_call → 40M requests → ≈$1.23/M. Free tier 10M credits/mo ≈ 5M requests.',
    }],
  },
  {
    provider: { slug: 'infura', name: 'Infura (MetaMask Developer)', website: 'https://www.infura.io', pricing_url: 'https://developer.metamask.io/pricing', pricing_model: 'credits' },
    points: [{
      plan_name: 'Developer', monthly_price_usd: 50, included_requests_m: 5.6,
      effective_usd_per_million: 8.93, free_tier_requests_m_per_month: 1.1,
      requires_signup: true, requires_subscription: true, supports_x402: false,
      source_url: 'https://developer.metamask.io/pricing', observed_at: SEED_OBSERVED_AT,
      confidence: 'derived_estimate',
      notes: 'Developer: $50/mo, 15M credits/day. Derived at 80 credits per eth_call → ≈5.6M requests/mo → ≈$8.93/M. Free tier 3M credits/day ≈ 1.1M requests/mo.',
    }],
  },
  {
    provider: { slug: 'chainstack', name: 'Chainstack', website: 'https://chainstack.com', pricing_url: 'https://chainstack.com/pricing/', pricing_model: 'per_request' },
    points: [{
      plan_name: 'Growth', monthly_price_usd: 49, included_requests_m: 20,
      effective_usd_per_million: 2.45, free_tier_requests_m_per_month: 3,
      requires_signup: true, requires_subscription: true, supports_x402: false,
      source_url: 'https://chainstack.com/pricing/', observed_at: SEED_OBSERVED_AT,
      confidence: 'published',
      notes: 'Growth: $49/mo, 20M requests included → $2.45/M (request-based plan, no unit conversion needed). Free Developer tier 3M requests/mo.',
    }],
  },
  {
    provider: { slug: 'ankr', name: 'Ankr', website: 'https://www.ankr.com', pricing_url: 'https://www.ankr.com/rpc/pricing/', pricing_model: 'credits' },
    points: [{
      plan_name: 'PAYG', monthly_price_usd: null, included_requests_m: null,
      effective_usd_per_million: null, free_tier_requests_m_per_month: null,
      requires_signup: true, requires_subscription: false, supports_x402: false,
      source_url: 'https://www.ankr.com/rpc/pricing/', observed_at: SEED_OBSERVED_AT,
      confidence: 'unverified',
      notes: 'Credit-based pay-as-you-go; per-request rate not yet verified against the live pricing page. Excluded from market averages until confirmed via POST /admin/pricing/competitor.',
    }],
  },
  {
    provider: { slug: 'drpc', name: 'dRPC', website: 'https://drpc.org', pricing_url: 'https://drpc.org/pricing', pricing_model: 'compute_units' },
    points: [{
      plan_name: 'PAYG', monthly_price_usd: null, included_requests_m: null,
      effective_usd_per_million: null, free_tier_requests_m_per_month: null,
      requires_signup: true, requires_subscription: false, supports_x402: false,
      source_url: 'https://drpc.org/pricing', observed_at: SEED_OBSERVED_AT,
      confidence: 'unverified',
      notes: 'CU-based pay-as-you-go; per-request rate not yet verified. Excluded from market averages until confirmed.',
    }],
  },
  {
    provider: { slug: 'lava', name: 'Lava Network', website: 'https://www.lavanet.xyz', pricing_url: 'https://www.lavanet.xyz', pricing_model: 'free_public' },
    points: [{
      plan_name: 'Public endpoints', monthly_price_usd: 0, included_requests_m: null,
      effective_usd_per_million: null, free_tier_requests_m_per_month: null,
      requires_signup: false, requires_subscription: false, supports_x402: false,
      source_url: 'https://www.lavanet.xyz', observed_at: SEED_OBSERVED_AT,
      confidence: 'unverified',
      notes: 'Rate-limited free public endpoints; provider-pair model for paid capacity. No comparable per-request price. Excluded from averages.',
    }],
  },
];

async function seedProviders(pool) {
  for (const { provider, points } of SEED) {
    const p = await pool.query(
      `INSERT INTO market_providers (slug, name, website, pricing_url, pricing_model)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [provider.slug, provider.name, provider.website, provider.pricing_url, provider.pricing_model]
    );
    if (!p.rows.length) continue; // provider existed — never clobber admin edits
    const providerId = p.rows[0].id;
    for (const pt of points) {
      await pool.query(
        `INSERT INTO market_price_points
           (provider_id, plan_name, monthly_price_usd, included_requests_m, effective_usd_per_million,
            free_tier_requests_m_per_month, requires_signup, requires_subscription, supports_x402,
            source_url, observed_at, confidence, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (provider_id, plan_name) DO NOTHING`,
        [providerId, pt.plan_name, pt.monthly_price_usd, pt.included_requests_m, pt.effective_usd_per_million,
         pt.free_tier_requests_m_per_month, pt.requires_signup, pt.requires_subscription, pt.supports_x402,
         pt.source_url, pt.observed_at, pt.confidence, pt.notes]
      );
    }
  }
}

/** Test hook — lets the suite re-run ensure against a fresh mock pool. */
export function _resetEnsuredForTests() { ensured = false; }
