// apps/api/src/middleware/upgrade_context.js
//
// Conversion patch (war room 2026-07-11): personalized, honest upgrade math
// for the free-tier wall 402s, plus the conversion-stage counters
// (personalized_402_seen → pricing_opened → payment_started → payment_success).
//
// Pricing-truth rules:
//   - Every dollar figure is computed from the CALLER'S OWN measured usage
//     (their ft:* count today, their developer_intel history) at the prices
//     the serving path actually bills. No competitor comparisons, no
//     "you save X%" claims — a machine can re-derive every number from
//     unit prices also present in the response.
//   - Prepaid credits are cheaper per call than x402 bundles at every volume
//     ($0.00003 vs $0.0001) — the recommendation says so plainly and only
//     prefers the bundle on friction grounds (no registration) for tiny or
//     one-off usage, with the reason spelled out.
//
// Hot-path rule: the gate emits thousands of 402s/day. get() is synchronous —
// it reads an in-memory cache and kicks a background Postgres fill on miss,
// so the first 402 of a window carries usage-today numbers only and
// subsequent ones (these callers retry constantly) carry full history.
// The 402 path NEVER waits on the database.

import { PRICE_PER_CALL_USDT, TIER_DAILY_LIMIT } from '../billing/credit_service.mjs';
import { getX402Config } from '../payments/x402/config.js';

const API_BASE = () => process.env.API_BASE_URL || 'https://rpc.satelink.network';
const MIN_DEPOSIT = () => parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50');
const FREE_LIMIT = () => parseInt(process.env.FREE_TIER_DAILY_LIMIT || '500', 10);

const round = (v, dp) => parseFloat(Number(v).toFixed(dp));

/**
 * Pure, honest plan math for a measured monthly volume. Exported for tests.
 */
export function computeUpgradeOffer(estimatedMonthlyCalls) {
  const est = Math.max(0, Math.round(Number(estimatedMonthlyCalls) || 0));
  const prepaidCost = round(est * PRICE_PER_CALL_USDT, 4);

  const options = [{
    plan: 'prepaid_credits',
    est_monthly_cost_usd: prepaidCost,
    unit_price_usd: PRICE_PER_CALL_USDT,
    minimum_first_deposit_usd: MIN_DEPOSIT(),
    note: 'unused credits never expire — the minimum deposit is a balance, not a fee',
    how: `POST ${API_BASE()}/v1/machine/register, then GET ${API_BASE()}/credits/deposit/initiate?amount=<usdt>`,
  }];

  const cfg = getX402Config();
  let bundleCost = null;
  if (cfg.enabled) {
    const bundlePrice = parseFloat(cfg.bundlePriceUsd);
    const bundles = Math.max(1, Math.ceil(est / cfg.bundleCalls));
    bundleCost = round(bundles * bundlePrice, 2);
    options.push({
      plan: 'x402_bundle',
      est_monthly_cost_usd: bundleCost,
      bundle_price_usd: bundlePrice,
      bundle_calls: cfg.bundleCalls,
      bundles_per_month: bundles,
      unit_price_usd: round(bundlePrice / cfg.bundleCalls, 6),
      note: 'no account, no registration — retry this exact call with an x402 payment header',
    });
  }

  // Honest recommendation: prepaid is cheaper per call at every volume; the
  // bundle only wins on friction. Say exactly that.
  let recommended_plan, reason;
  if (bundleCost != null && prepaidCost < MIN_DEPOSIT()) {
    recommended_plan = 'x402_bundle';
    reason =
      `your estimated month costs $${prepaidCost.toFixed(4)} prepaid — below the $${MIN_DEPOSIT().toFixed(2)} ` +
      `minimum deposit. One $${parseFloat(cfg.bundlePriceUsd).toFixed(2)} x402 bundle needs no account; ` +
      'prepaid is still cheaper per call if you expect usage to grow (the deposit balance never expires).';
  } else {
    recommended_plan = 'prepaid_credits';
    reason =
      `prepaid is the lowest cost for your volume: $${prepaidCost.toFixed(4)}/month at ` +
      `$${PRICE_PER_CALL_USDT}/call` +
      (bundleCost != null ? ` vs $${bundleCost.toFixed(2)}/month in x402 bundles` : '') +
      '. Numbers use only your measured usage — verify with the unit prices in each option.';
  }

  return {
    estimated_monthly_calls: est,
    options,
    best_available_option: bundleCost != null && bundleCost < prepaidCost ? 'x402_bundle' : 'prepaid_credits',
    recommended_plan,
    reason,
  };
}

// ── Conversion-stage counters (Redis, day-keyed, 8d TTL) ────────────────────
// Stages: seen (personalized 402 emitted) → pricing (pi:v:* — recorded by the
// discovery endpoints, not here) → pay_start (deposit calldata fetched or
// x402 attempt) → success (derived from ledgers, never a counter).
const STAGE_TTL_S = 8 * 24 * 3600;
const utcDay = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

export function bumpConversionStage(redis, stage) {
  if (!redis || !/^[a-z_]+$/.test(stage)) return;
  const key = `cz:${stage}:${utcDay()}`;
  Promise.resolve(redis.incr(key))
    .then(() => redis.expire(key, STAGE_TTL_S))
    .catch(() => {}); // telemetry never touches the request path
}

// ── Personalized context, background-filled cache ───────────────────────────
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX = 5000;

export function createUpgradeContext({ pool = null, redis = null, log = console } = {}) {
  const cache = new Map(); // key → { at, data }
  const inflight = new Set();

  const remember = (key, data) => {
    if (cache.size >= CACHE_MAX) cache.clear(); // crude but bounded
    cache.set(key, { at: Date.now(), data });
  };

  const fillIp = (ip) => {
    if (!pool || inflight.has(ip)) return;
    inflight.add(ip);
    pool.query(
      `SELECT days_active, avg_daily_calls::float AS avg_daily FROM developer_intel WHERE ip = $1`,
      [ip]
    ).then(r => {
      const row = r.rows[0];
      remember(`ip:${ip}`, row ? { days_active: row.days_active, avg_daily: row.avg_daily } : {});
    }).catch(() => remember(`ip:${ip}`, {}))
      .finally(() => inflight.delete(ip));
  };

  const fillSubnet = (subnet) => {
    if (!pool || inflight.has(`s:${subnet}`)) return;
    inflight.add(`s:${subnet}`);
    pool.query(
      `SELECT COUNT(*)::int AS ips FROM developer_intel
        WHERE ip LIKE $1 AND last_seen >= now() - interval '24 hours'`,
      [`${subnet}.%`]
    ).then(r => remember(`sub:${subnet}`, { active_ips: r.rows[0]?.ips ?? null }))
      .catch(() => remember(`sub:${subnet}`, {}))
      .finally(() => inflight.delete(`s:${subnet}`));
  };

  const cached = (key) => {
    const hit = cache.get(key);
    return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.data : null;
  };

  /**
   * Synchronous. Returns the personalized upgrade block for a wall 402 and
   * bumps the seen-counter. History fields appear once the background fill
   * has landed (these callers retry, so almost immediately in practice).
   */
  return function upgradeContextFor({ ip, requestsToday = null, subnet = null, subnetCount = null }) {
    bumpConversionStage(redis, 'seen');

    const hist = ip ? cached(`ip:${ip}`) : null;
    if (ip && !hist) fillIp(ip);
    const sub = subnet ? cached(`sub:${subnet}`) : null;
    if (subnet && !sub) fillSubnet(subnet);

    const avgDaily = hist?.avg_daily || 0;
    const today = requestsToday || 0;
    const estMonthly = Math.round(Math.max(avgDaily, today, subnetCount || 0) * 30);
    const offer = computeUpgradeOffer(estMonthly);

    const ctx = {
      // Personalization inputs — all measured, each labeled with its source.
      days_active: hist?.days_active ?? null,
      requests_today: today || null,
      avg_daily_calls: avgDaily || null,
      estimated_monthly_calls: offer.estimated_monthly_calls,
      basis: hist
        ? 'developer_intel history + today\'s live counter'
        : 'today\'s live counter only (history loads on your next request)',
      // The zero-cost rung, v2 (revenue sprint 2026-07-11): the wallet
      // signature was the drop-off (stranger tests: raw-HTTP consumers hold
      // no keys; eth-account can hard-fail at install). The instant trial
      // key removes it — one curl, no wallet, no email, own per-key quota.
      // Payment attaches when the quota binds and dependency has formed.
      free_first_step: {
        cost_usd: 0,
        message:
          'Your workload hit the public limit. Create a free machine key — no wallet, no email, 10-second setup. ' +
          'Pay only when your workload grows.',
        curl: `curl -X POST ${API_BASE()}/v1/machine/register -H "Content-Type: application/json" -d '{"mode":"instant"}'`,
        returns: 'an API key (send as X-API-Key header) with its own daily quota, independent of this IP/subnet limit',
        wallet_option:
          `prefer a permanent identity? POST the same endpoint with a wallet signature instead — deposits from that wallet auto-credit (${TIER_DAILY_LIMIT.free} calls/day free, then prepaid).`,
      },
      ...offer,
    };

    // Migration message for IP rotators: >1 active IP in this /24 today means
    // the shared subnet budget is being split — rotation buys nothing.
    if ((sub?.active_ips ?? 0) > 1) {
      ctx.migration = {
        detected: `${sub.active_ips} IPs from your /24 hit this gateway in the last 24h; the whole /24 shares one ${FREE_LIMIT()}-call daily budget, so rotating IPs does not increase free capacity.`,
        message:
          'Replace multiple free endpoints with one paid authenticated endpoint: a single X-API-Key has no ' +
          `per-IP limit — your estimated ${offer.estimated_monthly_calls.toLocaleString('en-US')} calls/month costs ` +
          `$${offer.options[0].est_monthly_cost_usd.toFixed(4)} prepaid, with no rotation logic to maintain.`,
      };
    }

    return ctx;
  };
}
