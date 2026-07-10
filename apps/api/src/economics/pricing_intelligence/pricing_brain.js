// apps/api/src/economics/pricing_intelligence/pricing_brain.js
//
// The pricing decision loop: market position × demand × capacity × cost →
// a recommended price, floor-clamped and step-limited, recorded with its full
// evidence bundle in pricing_decisions.
//
// SAFETY: this engine is ADVISORY. The serving path bills the flat
// PRICE_PER_CALL_USDT constant in credit_service.mjs; nothing here mutates
// billing, credits, x402 verification or settlement. `applied` stays false —
// wiring a recommendation into the billed price is an explicit human change
// (see docs/PRICING_INTELLIGENCE.md), exactly like SETTLEMENT_DRY_RUN.
// PRICING_MODE=AUTO only changes how the recommendation is labeled.

import { PRICE_PER_CALL_USDT } from '../../billing/credit_service.mjs';
import { getMarketSnapshot } from './market_intel.js';
import { computePriceFloor, enforceFloor } from './price_floor.js';
import { getConversionFunnel } from './conversion_funnel.js';
import { ensurePricingIntelTables } from './schema.js';

// Never move more than this per evaluation — a mispriced market row or a
// traffic spike must not swing the recommendation to an extreme in one step.
const MAX_STEP = 0.25;
// When above market with zero paid conversion, walk toward this fraction of
// the verified market median (i.e. target 20% below median).
const TARGET_MEDIAN_FRACTION = () => {
  const v = parseFloat(process.env.PRICING_TARGET_MEDIAN_FRACTION);
  return Number.isFinite(v) && v > 0 && v <= 2 ? v : 0.8;
};
// Capacity-strain thresholds over the measured node health sample.
const P50_STRAIN_MS = 250;
const ERROR_STRAIN_PCT = 5;

export const pricingMode = () =>
  (process.env.PRICING_MODE || 'MANUAL').toUpperCase() === 'AUTO' ? 'AUTO' : 'MANUAL';

async function capacitySignals(pool) {
  try {
    const h = (await pool.query(
      `SELECT
         ROUND(100.0*COUNT(*) FILTER (WHERE status IN ('healthy','ok','up','online'))/NULLIF(COUNT(*),0),2)::float AS avail,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY response_time_ms)::float AS p50,
         ROUND(100.0*COUNT(*) FILTER (WHERE status NOT IN ('healthy','ok','up','online'))/NULLIF(COUNT(*),0),2)::float AS err,
         COUNT(DISTINCT node_id)::int AS sample_nodes
       FROM node_health_logs WHERE checked_at >= extract(epoch from now())-86400`)).rows[0] || {};
    const n = (await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='active')::int AS c FROM registered_nodes`)).rows[0] || {};
    return {
      availability_pct: h.avail ?? null,
      p50_latency_ms: h.p50 ?? null,
      error_rate_pct: h.err ?? null,
      health_sample_nodes: h.sample_nodes ?? null,
      active_nodes: Number(n.c) || 0,
    };
  } catch {
    return { availability_pct: null, p50_latency_ms: null, error_rate_pct: null, health_sample_nodes: null, active_nodes: null };
  }
}

/**
 * Pure decision function — exported for tests. All inputs are plain numbers.
 * Returns { recommended, action, reason, clampedToFloor, stepLimited }.
 */
export function decidePrice({ current, floor, marketMedianPerMillion, payments30d, demandRequestsToday, capacity }) {
  const currentPerMillion = current * 1_000_000;
  const strained = capacity &&
    ((capacity.p50_latency_ms != null && capacity.p50_latency_ms > P50_STRAIN_MS) ||
     (capacity.error_rate_pct != null && capacity.error_rate_pct > ERROR_STRAIN_PCT));

  let target = current;
  let action = 'hold';
  let reason;

  if (strained) {
    // Capacity strained — protect quality of service; careful increase.
    target = current * (1 + MAX_STEP);
    action = 'increase';
    reason = `capacity strained (p50 ${capacity.p50_latency_ms}ms / error ${capacity.error_rate_pct}%): careful +${MAX_STEP * 100}% to protect service quality`;
  } else if (marketMedianPerMillion != null && currentPerMillion > marketMedianPerMillion && (payments30d ?? 0) === 0) {
    // Above market and nothing converting — walk toward below-median positioning.
    target = (marketMedianPerMillion * TARGET_MEDIAN_FRACTION()) / 1_000_000;
    action = 'decrease';
    reason = `price $${currentPerMillion.toFixed(2)}/M is above verified market median $${marketMedianPerMillion.toFixed(2)}/M with 0 paid conversions in 30d: move toward ${TARGET_MEDIAN_FRACTION() * 100}% of median`;
  } else if (marketMedianPerMillion != null && currentPerMillion > marketMedianPerMillion) {
    reason = `above market median but paid conversion exists (${payments30d} payments/30d): hold and observe`;
  } else if ((payments30d ?? 0) > 0 && (demandRequestsToday ?? 0) > 0) {
    reason = `at/below market median with active paid demand (${payments30d} payments/30d): hold — never race to zero`;
  } else {
    reason = 'no signal strong enough to move price: hold';
  }

  // Step limiter, then floor. Order matters: the floor is absolute.
  let stepLimited = false;
  const maxDown = current * (1 - MAX_STEP);
  const maxUp = current * (1 + MAX_STEP);
  if (target < maxDown) { target = maxDown; stepLimited = true; }
  if (target > maxUp) { target = maxUp; stepLimited = true; }

  const { price: recommended, clamped } = enforceFloor(target, floor);
  if (clamped) reason += ` [clamped to profit floor $${floor}]`;
  if (stepLimited) reason += ` [step-limited to ±${MAX_STEP * 100}% per evaluation]`;
  if (recommended > current) action = 'increase';
  else if (recommended < current) action = 'decrease';
  else action = 'hold';

  return { recommended, action, reason, clampedToFloor: clamped, stepLimited };
}

/** Full evaluation: gather evidence, decide, persist. Returns the decision row payload. */
export async function evaluatePricing(pool, redis) {
  await ensurePricingIntelTables(pool);
  const current = PRICE_PER_CALL_USDT;

  const [market, funnel, capacity] = await Promise.all([
    getMarketSnapshot(pool, current),
    getConversionFunnel(pool, redis),
    capacitySignals(pool),
  ]);

  const monthlyVolume = (funnel.stages.anonymous_requests_today || 0) * 30;
  const floorInfo = computePriceFloor({ monthlyCallVolume: monthlyVolume, currentPricePerCall: current });

  const decision = decidePrice({
    current,
    floor: floorInfo.floor_price_usd,
    marketMedianPerMillion: market.market_median_usd_per_million,
    payments30d: funnel.stages.payments_completed_30d,
    demandRequestsToday: funnel.stages.anonymous_requests_today,
    capacity,
  });

  const inputs = {
    market: {
      median_usd_per_million: market.market_median_usd_per_million,
      average_usd_per_million: market.market_average_usd_per_million,
      verified_plans: market.verified_plans_in_sample,
      our_usd_per_million: market.satelink.effective_usd_per_million,
    },
    demand: funnel.stages,
    capacity,
    floor: floorInfo,
  };

  const mode = pricingMode();
  const row = (await pool.query(
    `INSERT INTO pricing_decisions
       (mode, current_price_usd, recommended_price_usd, floor_price_usd,
        market_median_usd_per_million, market_average_usd_per_million, action, reason, inputs, applied)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
     RETURNING id, created_at`,
    [mode, current, decision.recommended, floorInfo.floor_price_usd,
     market.market_median_usd_per_million, market.market_average_usd_per_million,
     decision.action, decision.reason, JSON.stringify(inputs)]
  )).rows[0];

  // Surface in /admin/jobs/status alongside the other automation jobs.
  try {
    await pool.query(
      `INSERT INTO automation_logs (job_name, action, result) VALUES ($1,$2,$3)`,
      ['pricing-intel', decision.action,
       JSON.stringify({ decision_id: row.id, recommended: decision.recommended, current, reason: decision.reason })]
    );
  } catch { /* automation_logs is optional visibility, never a failure */ }

  return {
    decision_id: row.id,
    created_at: row.created_at,
    mode,
    current_price_usd: current,
    recommended_price_usd: decision.recommended,
    floor_price_usd: floorInfo.floor_price_usd,
    action: decision.action,
    reason: decision.reason,
    applied: false,
    apply_note:
      'Recommendations are advisory. The billed price is PRICE_PER_CALL_USDT in credit_service.mjs; ' +
      'changing it is an explicit human code change, like SETTLEMENT_DRY_RUN.',
    inputs,
  };
}

export async function latestDecision(pool) {
  await ensurePricingIntelTables(pool);
  const r = await pool.query(
    `SELECT id, mode, current_price_usd::float, recommended_price_usd::float, floor_price_usd::float,
            market_median_usd_per_million::float, market_average_usd_per_million::float,
            action, reason, inputs, applied, created_at
       FROM pricing_decisions ORDER BY created_at DESC LIMIT 1`);
  return r.rows[0] || null;
}
