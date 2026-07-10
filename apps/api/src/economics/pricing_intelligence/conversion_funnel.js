// apps/api/src/economics/pricing_intelligence/conversion_funnel.js
//
// Conversion feedback loop — every stage measured from a real production
// source, each stage labeled with where the number came from:
//
//   anonymous traffic      → Redis ft:* daily counters (fallback: developer_intel)
//   free-tier wall (402)   → ft:* counts at/over FREE_TIER_DAILY_LIMIT
//   pricing viewed         → pi:v:* Redis counters bumped by the discovery routers
//   payment completed      → payment_sources (x402 et al) + api_deposits (vault), 30d
//   paying accounts        → api_credits with total_deposited > 0
//   repeat usage           → paying accounts that also spent credits
//
// Pricing must optimize paid conversion, not traffic — the brain consumes
// paying_accounts / payments_30d, never raw request counts alone.

const FREE_TIER_LIMIT = () => parseInt(process.env.FREE_TIER_DAILY_LIMIT || '500', 10);

const utcDay = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const VIEW_TTL_S = 8 * 24 * 3600;

/** Non-blocking view counter for the machine discovery surfaces. */
export function recordPricingView(redis, surface) {
  if (!redis) return;
  const key = `pi:v:${surface}:${utcDay()}`;
  Promise.resolve(redis.incr(key))
    .then(() => redis.expire(key, VIEW_TTL_S))
    .catch(() => {}); // counters are best-effort; never touch the request path
}

async function scanKeys(redis, pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function trafficAndWall(pool, redis) {
  if (redis) {
    try {
      const keys = (await scanKeys(redis, 'ft:*')).filter(k => !k.startsWith('ftua:'));
      let calls = 0, atWall = 0;
      if (keys.length) {
        const vals = await redis.mget(...keys);
        const limit = FREE_TIER_LIMIT();
        for (const v of vals) {
          const n = parseInt(v, 10) || 0;
          calls += n;
          if (n >= limit) atWall++;
        }
      }
      return { requests_today: calls, active_ips_today: keys.length, ips_at_free_tier_wall: atWall, source: 'redis_ft_counters_utc_day' };
    } catch { /* fall through */ }
  }
  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE calls_today > 0)::int AS ips,
            COALESCE(SUM(calls_today) FILTER (WHERE calls_today > 0),0)::int AS calls,
            COUNT(*) FILTER (WHERE calls_today >= $1)::int AS wall
       FROM developer_intel WHERE last_seen >= now() - interval '24 hours'`,
    [FREE_TIER_LIMIT()]);
  const row = r.rows[0] || {};
  return {
    requests_today: Number(row.calls) || 0,
    active_ips_today: Number(row.ips) || 0,
    ips_at_free_tier_wall: Number(row.wall) || 0,
    source: 'developer_intel_last_seen_24h',
  };
}

async function pricingViews(redis) {
  if (!redis) return { views_7d: null, by_surface: null, source: 'unavailable_no_redis' };
  try {
    const keys = await scanKeys(redis, 'pi:v:*');
    const bySurface = {};
    let total = 0;
    if (keys.length) {
      const vals = await redis.mget(...keys);
      keys.forEach((k, i) => {
        const surface = k.split(':')[2] || 'unknown';
        const n = parseInt(vals[i], 10) || 0;
        bySurface[surface] = (bySurface[surface] || 0) + n;
        total += n;
      });
    }
    return { views_7d: total, by_surface: bySurface, source: 'redis_pi_v_counters' };
  } catch {
    return { views_7d: null, by_surface: null, source: 'redis_error' };
  }
}

export async function getConversionFunnel(pool, redis) {
  const [traffic, views] = await Promise.all([trafficAndWall(pool, redis), pricingViews(redis)]);

  // Each query individually guarded: a missing table (fresh DB, x402 migration
  // not applied) must degrade that stage to null, not 500 the endpoint.
  const safeOne = async (sql, params = []) => {
    try { return (await pool.query(sql, params)).rows[0] || null; }
    catch { return null; }
  };

  const pay = await safeOne(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_usd),0)::float AS usd
       FROM payment_sources WHERE NOT is_test_data AND created_at >= now() - interval '30 days'`);
  const dep = await safeOne(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_usdt),0)::float AS usd
       FROM api_deposits WHERE created_at >= now() - interval '30 days'`);
  const accounts = await safeOne(
    `SELECT COUNT(*) FILTER (WHERE total_deposited > 0)::int AS paying,
            COUNT(*) FILTER (WHERE total_deposited > 0 AND total_spent > 0)::int AS repeat,
            COUNT(*)::int AS total
       FROM api_credits`);
  const billed = await safeOne(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_usdt),0)::float AS usd
       FROM revenue_events_v2
      WHERE NOT is_test_data AND to_timestamp(created_at) >= now() - interval '30 days'`);

  const paymentsCompleted30d = (pay ? pay.n : 0) + (dep ? dep.n : 0);
  const paidUsd30d = (pay ? pay.usd : 0) + (dep ? dep.usd : 0);
  const payingAccounts = accounts ? accounts.paying : null;
  const walled = traffic.ips_at_free_tier_wall;

  return {
    stages: {
      anonymous_requests_today: traffic.requests_today,
      anonymous_ips_today: traffic.active_ips_today,
      free_tier_wall_402_ips_today: walled,
      pricing_views_7d: views.views_7d,
      payments_completed_30d: paymentsCompleted30d,
      paid_usd_30d: parseFloat(paidUsd30d.toFixed(6)),
      paying_accounts_lifetime: payingAccounts,
      repeat_usage_accounts: accounts ? accounts.repeat : null,
      billed_calls_30d: billed ? billed.n : null,
      billed_usd_30d: billed ? billed.usd : null,
    },
    // Wall→paid is the conversion the pricing brain optimizes: of the IPs that
    // hit the 402 wall today, how does that compare with paid conversions?
    wall_to_paid_conversion_30d:
      walled > 0 && paymentsCompleted30d != null
        ? parseFloat((paymentsCompleted30d / Math.max(walled, 1)).toFixed(4))
        : null,
    sources: {
      traffic: traffic.source,
      pricing_views: views.source,
      payments: 'payment_sources(!is_test_data) + api_deposits, 30d',
      accounts: 'api_credits',
      billing: 'revenue_events_v2(!is_test_data), 30d',
    },
  };
}
