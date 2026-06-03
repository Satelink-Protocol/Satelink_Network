/**
 * API Key Tiers and Rate Limiting
 * S1-RPC-006: Tiered rate limiting for paid customers
 *
 * Tiers:
 * - free: 100 requests/day (IP-based, no API key)
 * - basic: 10,000 requests/day
 * - pro: 100,000 requests/day
 * - enterprise: 1,000,000 requests/day
 *
 * Redis keys:
 * - rpc:apikey:{key} → { tier, owner, created }
 * - rpc:usage:{key}:{date} → request count
 * - rpc:usage:ip:{ip}:{date} → request count (free tier)
 */

import { getSharedRedis } from './shared_redis.js';
import crypto from 'crypto';

const TIERS = {
  free: {
    limit: 200,
    period: 'day',
    priceUsdt: 0
  },
  basic: {
    limit: 10000,
    period: 'day',
    priceUsdt: 10
  },
  pro: {
    limit: 100000,
    period: 'day',
    priceUsdt: 50
  },
  enterprise: {
    limit: 1000000,
    period: 'day',
    priceUsdt: 200
  }
};

// Use shared Redis client to avoid connection pool exhaustion
function getRedis() {
  return getSharedRedis();
}

function getDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function getApiKeyInfoKey(apiKey) {
  return `rpc:apikey:${apiKey}`;
}

function getUsageKey(apiKey, date) {
  return `rpc:usage:${apiKey}:${date}`;
}

function getIpUsageKey(ip, date) {
  return `rpc:usage:ip:${ip}:${date}`;
}

export function generateApiKey() {
  return `sk_${crypto.randomBytes(24).toString('hex')}`;
}

export async function createApiKey(tier, owner) {
  const client = getRedis();
  if (!client) {
    throw new Error('Redis not available');
  }

  if (!TIERS[tier]) {
    throw new Error(`Invalid tier: ${tier}`);
  }

  const apiKey = generateApiKey();
  const keyInfo = {
    tier,
    owner: owner || 'anonymous',
    created: Date.now(),
    status: 'active'
  };

  await client.set(getApiKeyInfoKey(apiKey), JSON.stringify(keyInfo));

  console.log(`[RateLimiter] Created API key: ${apiKey.slice(0, 10)}... tier=${tier}`);

  return { apiKey, ...keyInfo };
}

export async function getApiKeyInfo(apiKey) {
  const client = getRedis();
  if (!client) return null;

  try {
    const data = await client.get(getApiKeyInfoKey(apiKey));
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('[RateLimiter] Failed to get API key info:', err.message);
    return null;
  }
}

export async function checkRateLimit(apiKey, ip) {
  const client = getRedis();
  const date = getDateKey();

  let tier = 'free';
  let usageKey;

  if (apiKey && apiKey.startsWith('sk_')) {
    const keyInfo = await getApiKeyInfo(apiKey);
    if (keyInfo && keyInfo.status === 'active') {
      tier = keyInfo.tier;
      usageKey = getUsageKey(apiKey, date);
    } else {
      usageKey = getIpUsageKey(ip, date);
    }
  } else {
    usageKey = getIpUsageKey(ip, date);
  }

  const limit = TIERS[tier].limit;

  if (!client) {
    return { allowed: true, tier, remaining: limit, limit };
  }

  try {
    const current = parseInt(await client.get(usageKey)) || 0;

    if (current >= limit) {
      return {
        allowed: false,
        tier,
        remaining: 0,
        limit,
        resetAt: getNextResetTime()
      };
    }

    return {
      allowed: true,
      tier,
      remaining: limit - current - 1,
      limit
    };
  } catch (err) {
    console.error('[RateLimiter] Check failed:', err.message);
    return { allowed: true, tier, remaining: limit, limit };
  }
}

export async function incrementUsage(apiKey, ip) {
  const client = getRedis();
  if (!client) return;

  const date = getDateKey();
  let usageKey;

  if (apiKey && apiKey.startsWith('sk_')) {
    const keyInfo = await getApiKeyInfo(apiKey);
    if (keyInfo && keyInfo.status === 'active') {
      usageKey = getUsageKey(apiKey, date);
    } else {
      usageKey = getIpUsageKey(ip, date);
    }
  } else {
    usageKey = getIpUsageKey(ip, date);
  }

  try {
    await client.incr(usageKey);
    await client.expire(usageKey, 86400 * 2);
  } catch (err) {
    console.error('[RateLimiter] Increment failed:', err.message);
  }
}

export async function getUsageStats(apiKey) {
  const client = getRedis();
  if (!client) return null;

  const keyInfo = await getApiKeyInfo(apiKey);
  if (!keyInfo) return null;

  const date = getDateKey();
  const usageKey = getUsageKey(apiKey, date);

  try {
    const current = parseInt(await client.get(usageKey)) || 0;
    const limit = TIERS[keyInfo.tier].limit;

    return {
      tier: keyInfo.tier,
      used: current,
      limit,
      remaining: Math.max(0, limit - current),
      percentUsed: ((current / limit) * 100).toFixed(1),
      resetAt: getNextResetTime()
    };
  } catch (err) {
    console.error('[RateLimiter] Usage stats failed:', err.message);
    return null;
  }
}

function getNextResetTime() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

export function getTiers() {
  return TIERS;
}

export { TIERS };
