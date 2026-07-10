// apps/api/src/economics/pricing_intelligence/index.js
//
// Facade for the machine discovery surface. One 60s-TTL in-memory cache keeps
// /v1/pricing and /v1/compare fast and keeps intel failures away from the
// payment-critical pricing endpoint (callers wrap in try/catch and fall back
// to the base body).

import { PRICE_PER_CALL_USDT } from '../../billing/credit_service.mjs';
import { getMarketSnapshot } from './market_intel.js';
import { computePriceFloor, X402_FACILITATOR_FLOOR_USD } from './price_floor.js';
import { computeMachinePreferenceScore } from './trust_score.js';
import { getConversionFunnel } from './conversion_funnel.js';
import { getX402Config } from '../../payments/x402/config.js';

export { recordPricingView } from './conversion_funnel.js';
export { evaluatePricing, latestDecision, pricingMode } from './pricing_brain.js';
export { upsertCompetitorPricePoint, getMarketSnapshot } from './market_intel.js';
export { getConversionFunnel } from './conversion_funnel.js';
export { computePriceFloor } from './price_floor.js';

const CACHE_TTL_MS = 60_000;
let cache = { at: 0, value: null };

async function healthSignals(pool) {
  try {
    const h = (await pool.query(
      `SELECT
         ROUND(100.0*COUNT(*) FILTER (WHERE status IN ('healthy','ok','up','online'))/NULLIF(COUNT(*),0),2)::float AS avail,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY response_time_ms)::float AS p50,
         ROUND(100.0*COUNT(*) FILTER (WHERE status NOT IN ('healthy','ok','up','online'))/NULLIF(COUNT(*),0),2)::float AS err,
         COUNT(DISTINCT node_id)::int AS sample_nodes
       FROM node_health_logs WHERE checked_at >= extract(epoch from now())-86400`)).rows[0] || {};
    return {
      availability_pct: h.avail ?? null,
      p50_latency_ms: h.p50 != null ? Math.round(h.p50) : null,
      error_rate_pct: h.err ?? null,
      sample_nodes: h.sample_nodes ?? null,
      window: 'last_24h',
      source: 'node_health_logs',
    };
  } catch {
    return { availability_pct: null, p50_latency_ms: null, error_rate_pct: null, sample_nodes: null, window: 'last_24h', source: 'unavailable' };
  }
}

/**
 * Cached bundle of everything the discovery endpoints need:
 * market snapshot, live performance, trust score, floor, why-choose facts.
 */
export async function getIntelSummary(pool, redis) {
  if (cache.value && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;

  const current = PRICE_PER_CALL_USDT;
  const x402 = getX402Config();

  const [market, perf, funnel] = await Promise.all([
    getMarketSnapshot(pool, current),
    healthSignals(pool),
    getConversionFunnel(pool, redis).catch(() => null),
  ]);

  const trust = computeMachinePreferenceScore({
    p50LatencyMs: perf.p50_latency_ms,
    availabilityPct: perf.availability_pct,
    errorRatePct: perf.error_rate_pct,
    healthSampleNodes: perf.sample_nodes,
    ourPerMillionUsd: current * 1_000_000,
    marketMedianUsdPerMillion: market.market_median_usd_per_million,
    x402Enabled: x402.enabled,
    minDepositUsd: parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50'),
  });

  const floor = computePriceFloor({
    monthlyCallVolume: (funnel?.stages?.anonymous_requests_today || 0) * 30,
    currentPricePerCall: current,
  });

  const value = {
    generated_at: new Date().toISOString(),
    price_per_call_usd: current,
    market,
    performance: perf,
    machine_preference_score: trust,
    price_floor: {
      floor_price_usd: floor.floor_price_usd,
      x402_floor_price_usd: X402_FACILITATOR_FLOOR_USD,
      explanation: floor.explanation,
    },
    why_choose_satelink: whyChoose(market, perf, x402),
    funnel_summary: funnel ? {
      paying_accounts_lifetime: funnel.stages.paying_accounts_lifetime,
      payments_completed_30d: funnel.stages.payments_completed_30d,
    } : null,
  };
  cache = { at: Date.now(), value };
  return value;
}

function whyChoose(market, perf, x402) {
  // Every entry is a fact a machine can independently verify — no adjectives
  // without a number or a checkable property behind them.
  const facts = [
    'No signup, no email, no human: register with a wallet signature (POST /v1/machine/register) or pay per call over x402.',
    `Pure pay-per-call at $${market.satelink.price_per_call_usd}/call — no subscription, no monthly minimum (competitor plans in /v1/compare start at $49/mo).`,
    market.position.summary,
  ];
  if (x402.enabled) {
    facts.push(`x402-native: HTTP 402 responses carry spec-compliant payment requirements; one $${x402.bundlePriceUsd} USDC settlement buys a ${x402.bundleCalls.toLocaleString('en-US')}-call bundle (effective $${(parseFloat(x402.bundlePriceUsd) / x402.bundleCalls).toFixed(6)}/call) — pay and retry in one round-trip.`);
  }
  if (perf.p50_latency_ms != null) {
    facts.push(`Measured p50 latency ${perf.p50_latency_ms}ms with ${perf.availability_pct}% healthy checks over the last 24h (sample: ${perf.sample_nodes} node(s)).`);
  }
  facts.push('On-chain settlement: revenue and deposits are verifiable on Polygon PoS (RevenueVault) — pricing claims are auditable.');
  return facts;
}

/** Test hook. */
export function _resetIntelCacheForTests() { cache = { at: 0, value: null }; }
