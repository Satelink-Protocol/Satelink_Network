// apps/api/src/economics/pricing_intelligence/market_intel.js
//
// Market snapshot + honest positioning math.
//
// The load-bearing honesty rule: Satelink's credits rail is $30/M requests,
// which is ABOVE bulk subscription plans ($1–9/M). The real advantage is
// zero-commitment pay-per-call — so the comparison output leads with the
// computed break-even volume per plan (below which Satelink costs fewer
// absolute dollars than the subscription), never a fabricated "cheaper than
// market" claim.

import { ensurePricingIntelTables } from './schema.js';

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round = (v, dp = 6) => (v == null ? null : parseFloat(Number(v).toFixed(dp)));

/**
 * Full market snapshot: every active provider/plan row (with provenance),
 * aggregates over verified rows only, and Satelink's computed position.
 * @param {number} ourPricePerCallUsd — what the serving path actually bills.
 */
export async function getMarketSnapshot(pool, ourPricePerCallUsd) {
  await ensurePricingIntelTables(pool);
  const { rows } = await pool.query(`
    SELECT p.slug, p.name, p.pricing_model, pp.plan_name, pp.monthly_price_usd::float,
           pp.included_requests_m::float, pp.effective_usd_per_million::float,
           pp.free_tier_requests_m_per_month::float, pp.requires_signup,
           pp.requires_subscription, pp.supports_x402, pp.source_url,
           pp.observed_at, pp.confidence, pp.notes
      FROM market_providers p
      JOIN market_price_points pp ON pp.provider_id = p.id
     WHERE p.active
     ORDER BY pp.effective_usd_per_million ASC NULLS LAST`);

  const ourPerMillion = round(ourPricePerCallUsd * 1_000_000, 4);
  const verified = rows.filter(r => r.effective_usd_per_million != null && r.confidence !== 'unverified');
  const prices = verified.map(r => r.effective_usd_per_million).sort((a, b) => a - b);

  const marketMedian = round(median(prices), 4);
  const marketAverage = prices.length
    ? round(prices.reduce((a, b) => a + b, 0) / prices.length, 4) : null;

  const providers = rows.map(r => ({
    provider: r.slug,
    name: r.name,
    plan: r.plan_name,
    pricing_model: r.pricing_model,
    monthly_price_usd: r.monthly_price_usd,
    effective_usd_per_million: r.effective_usd_per_million,
    free_tier_requests_m_per_month: r.free_tier_requests_m_per_month,
    requires_signup: r.requires_signup,
    requires_subscription: r.requires_subscription,
    supports_x402: r.supports_x402,
    // Below this monthly volume, paying Satelink per-call costs fewer absolute
    // dollars than this plan's subscription fee (free tiers excluded — a
    // workload inside a free tier costs $0 anywhere).
    breakeven_monthly_calls_vs_satelink:
      r.monthly_price_usd > 0 && ourPricePerCallUsd > 0
        ? Math.floor(r.monthly_price_usd / ourPricePerCallUsd)
        : null,
    source_url: r.source_url,
    observed_at: r.observed_at,
    confidence: r.confidence,
    notes: r.notes,
  }));

  return {
    satelink: {
      price_per_call_usd: ourPricePerCallUsd,
      effective_usd_per_million: ourPerMillion,
      requires_signup: false,
      requires_subscription: false,
      monthly_minimum_usd: 0,
      supports_x402: true,
    },
    market_median_usd_per_million: marketMedian,
    market_average_usd_per_million: marketAverage,
    verified_plans_in_sample: verified.length,
    position: positionStatement(ourPerMillion, marketMedian, ourPricePerCallUsd, verified),
    providers,
    methodology:
      'Aggregates use only plans with a verified or derivation-documented effective rate ' +
      '(confidence published/derived_estimate); unverified rows are listed but excluded. ' +
      'Each row carries source_url, observed_at and its unit-conversion assumptions.',
  };
}

function positionStatement(ourPerMillion, marketMedian, perCall, verified) {
  if (marketMedian == null) {
    return { summary: 'No verified market sample available yet.', per_million_vs_median_pct: null, cheapest_below_calls_per_month: null };
  }
  const pct = round(((ourPerMillion - marketMedian) / marketMedian) * 100, 1);
  // The smallest subscription in the verified sample defines the volume below
  // which pure pay-per-call beats every paid plan on absolute dollars.
  const minSub = verified
    .filter(r => r.monthly_price_usd > 0)
    .reduce((m, r) => Math.min(m, r.monthly_price_usd), Infinity);
  const cheapestBelow = Number.isFinite(minSub) && perCall > 0 ? Math.floor(minSub / perCall) : null;
  const summary = pct <= 0
    ? `Satelink is ${Math.abs(pct)}% below the verified market median per million requests, with no subscription or signup.`
    : `Per million requests Satelink is ${pct}% above the verified market median of bulk subscription plans, ` +
      `but has zero monthly commitment: below ~${cheapestBelow?.toLocaleString('en-US')} calls/month it costs fewer ` +
      'absolute dollars than the cheapest paid plan in the sample.';
  return { summary, per_million_vs_median_pct: pct, cheapest_below_calls_per_month: cheapestBelow };
}

/** Admin upsert: add/update a provider and one price point. */
export async function upsertCompetitorPricePoint(pool, input) {
  await ensurePricingIntelTables(pool);
  const {
    slug, name, website = null, pricing_url = null, pricing_model = null,
    plan_name, monthly_price_usd = null, included_requests_m = null,
    effective_usd_per_million = null, free_tier_requests_m_per_month = null,
    requires_signup = true, requires_subscription = true, supports_x402 = false,
    source_url, confidence, notes = null,
  } = input;

  if (!slug || !/^[a-z0-9-]{2,40}$/.test(slug)) throw new Error('slug required: lowercase kebab, 2-40 chars');
  if (!plan_name) throw new Error('plan_name required');
  if (!source_url) throw new Error('source_url required — every price point must be sourced');
  if (!['published', 'derived_estimate', 'unverified'].includes(confidence)) {
    throw new Error("confidence must be 'published' | 'derived_estimate' | 'unverified'");
  }

  const p = await pool.query(
    `INSERT INTO market_providers (slug, name, website, pricing_url, pricing_model)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (slug) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, market_providers.name),
       website = COALESCE(EXCLUDED.website, market_providers.website),
       pricing_url = COALESCE(EXCLUDED.pricing_url, market_providers.pricing_url),
       pricing_model = COALESCE(EXCLUDED.pricing_model, market_providers.pricing_model),
       updated_at = now()
     RETURNING id`,
    [slug, name || slug, website, pricing_url, pricing_model]
  );
  const providerId = p.rows[0].id;

  const r = await pool.query(
    `INSERT INTO market_price_points
       (provider_id, plan_name, monthly_price_usd, included_requests_m, effective_usd_per_million,
        free_tier_requests_m_per_month, requires_signup, requires_subscription, supports_x402,
        source_url, observed_at, confidence, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),$11,$12)
     ON CONFLICT (provider_id, plan_name) DO UPDATE SET
       monthly_price_usd = EXCLUDED.monthly_price_usd,
       included_requests_m = EXCLUDED.included_requests_m,
       effective_usd_per_million = EXCLUDED.effective_usd_per_million,
       free_tier_requests_m_per_month = EXCLUDED.free_tier_requests_m_per_month,
       requires_signup = EXCLUDED.requires_signup,
       requires_subscription = EXCLUDED.requires_subscription,
       supports_x402 = EXCLUDED.supports_x402,
       source_url = EXCLUDED.source_url,
       observed_at = now(),
       confidence = EXCLUDED.confidence,
       notes = EXCLUDED.notes
     RETURNING id, provider_id, plan_name, observed_at`,
    [providerId, plan_name, monthly_price_usd, included_requests_m, effective_usd_per_million,
     free_tier_requests_m_per_month, requires_signup, requires_subscription, supports_x402,
     source_url, confidence, notes]
  );
  return r.rows[0];
}
