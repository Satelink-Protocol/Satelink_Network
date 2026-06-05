// apps/api/src/middleware/free_tier_gate.js
// Path C hybrid gate: free tier per IP, then 402 with deposit instructions
// Free tier: FREE_TIER_LIMIT calls/day per IP (default 500)
// Wallet-authenticated requests bypass IP limit entirely → go to creditGate
// Resets daily at midnight UTC. Redis-backed when available; falls back to in-memory.

import { createHash } from 'crypto';

const FREE_TIER_LIMIT = parseInt(process.env.FREE_TIER_DAILY_LIMIT || '500');
const LOG_PREFIX = '[FreeTierGate]';

// Module-level Redis reference — set when createFreeTierGate is called
let _redis = null;

// Map<ip, { count, resetAt }> — in-memory fallback when Redis unavailable
const ipCounters = new Map();

function getMidnightUTC() {
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  ));
  return midnight.getTime();
}

function getCounter(ip) {
  const now = Date.now();
  const existing = ipCounters.get(ip);

  if (!existing || now >= existing.resetAt) {
    const counter = { count: 0, resetAt: getMidnightUTC() };
    ipCounters.set(ip, counter);
    return counter;
  }
  return existing;
}

// Cleanup old IPs every hour to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, counter] of ipCounters.entries()) {
    if (now >= counter.resetAt) ipCounters.delete(ip);
  }
}, 60 * 60 * 1000);

export function createFreeTierGate(logger, redis) {
  const log = logger || console;
  if (redis) _redis = redis;

  return async function freeTierGate(req, res, next) {
    // Wallet-authenticated → skip IP gate entirely, go to creditGate
    const walletHeader = req.headers['x-wallet-address'];
    if (walletHeader) return next();

    // Get real IP (Railway proxies requests)
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      'unknown';

    let count;
    let resetAt;

    if (redis) {
      try {
        const key = `ft:${ip}`;
        count = await redis.incr(key);
        if (count === 1) {
          const ttl = Math.ceil((getMidnightUTC() - Date.now()) / 1000);
          await redis.expire(key, ttl);
        }
        resetAt = getMidnightUTC();
      } catch (err) {
        log.warn(`${LOG_PREFIX} Redis error, using in-memory fallback: ${err.message}`);
        const counter = getCounter(ip);
        counter.count++;
        count = counter.count;
        resetAt = counter.resetAt;
      }
    } else {
      const counter = getCounter(ip);
      counter.count++;
      count = counter.count;
      resetAt = counter.resetAt;
    }

    if (count > FREE_TIER_LIMIT) {
      log.warn(`${LOG_PREFIX} Free tier exceeded: ip=${ip} count=${count} limit=${FREE_TIER_LIMIT}`);

      const VAULT = process.env.REVENUE_VAULT_ADDRESS || '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3';

      return res.status(429).json({
        error: 'rate_limit_exceeded',
        upgrade_url: `${process.env.API_BASE_URL || 'https://rpc.satelink.network'}/credits/initiate?amount=10`,
        deposit_address: VAULT,
        network: 'Polygon Mainnet',
        docs: 'https://docs.satelink.network/paid-tier'
      });
    }

    // Under limit — track usage and pass through
    req.freeTierIp = ip;
    req.freeTierCount = count;
    next();
  };
}

// Export current stats for monitoring — reads Redis ft:* keys in production
export async function getFreeTierStats() {
  if (_redis) {
    try {
      const keys = await _redis.keys('ft:*');
      if (!keys || keys.length === 0) {
        return { activeIPs: 0, totalCalls: 0, nearLimitIPs: 0, limit: FREE_TIER_LIMIT };
      }
      const values = await _redis.mget(...keys);
      let totalCalls = 0;
      let nearLimitIPs = 0;
      for (const v of values) {
        const count = parseInt(v, 10) || 0;
        totalCalls += count;
        if (count > FREE_TIER_LIMIT * 0.8) nearLimitIPs++;
      }
      return { activeIPs: keys.length, totalCalls, nearLimitIPs, limit: FREE_TIER_LIMIT };
    } catch (err) {
      // Fall through to in-memory
    }
  }
  const now = Date.now();
  let activeIPs = 0;
  let totalCalls = 0;
  let nearLimitIPs = 0;
  for (const [, counter] of ipCounters.entries()) {
    if (now < counter.resetAt) {
      activeIPs++;
      totalCalls += counter.count;
      if (counter.count > FREE_TIER_LIMIT * 0.8) nearLimitIPs++;
    }
  }
  return { activeIPs, totalCalls, nearLimitIPs, limit: FREE_TIER_LIMIT };
}

// Export conversion targets: IPs at >=90% of free tier limit
export async function getConversionTargets() {
  const threshold = FREE_TIER_LIMIT * 0.9;

  if (_redis) {
    try {
      const keys = await _redis.keys('ft:*');
      if (!keys || keys.length === 0) return [];
      const values = await _redis.mget(...keys);
      const targets = [];
      for (let i = 0; i < keys.length; i++) {
        const count = parseInt(values[i], 10) || 0;
        if (count >= threshold) {
          targets.push({
            client_id: hashIp(keys[i].slice(3)), // strip 'ft:' prefix
            calls_today: count,
            limit: FREE_TIER_LIMIT,
            threshold_pct: Math.round((count / FREE_TIER_LIMIT) * 100),
            exceeded: count > FREE_TIER_LIMIT,
            resets_at: new Date(getMidnightUTC()).toISOString()
          });
        }
      }
      targets.sort((a, b) => b.calls_today - a.calls_today);
      return targets;
    } catch (err) {
      // Fall through to in-memory
    }
  }

  const now = Date.now();
  const targets = [];
  for (const [ip, counter] of ipCounters.entries()) {
    if (now < counter.resetAt && counter.count >= threshold) {
      targets.push({
        client_id: hashIp(ip),
        calls_today: counter.count,
        limit: FREE_TIER_LIMIT,
        threshold_pct: Math.round((counter.count / FREE_TIER_LIMIT) * 100),
        exceeded: counter.count > FREE_TIER_LIMIT,
        resets_at: new Date(counter.resetAt).toISOString()
      });
    }
  }
  targets.sort((a, b) => b.calls_today - a.calls_today);
  return targets;
}

// Hash IP for privacy in logs/exports
function hashIp(ip) {
  return 'IP-' + createHash('sha256').update(ip + (process.env.IP_HASH_SALT || 'satelink')).digest('hex').substring(0, 12);
}
