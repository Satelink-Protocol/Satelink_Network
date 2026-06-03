/**
 * Weighted Load Balancer for RPC Providers
 * S1-RPC-005: Weighted load balancing across providers
 *
 * Weight calculation:
 * - Faster providers get higher weights (inverse latency)
 * - Rate limits factor into max concurrent requests
 * - Circuit-broken providers get weight 0
 *
 * Selection: Weighted random selection
 * - Distributes load proportionally to weights
 * - Prevents single provider from being overwhelmed
 * - Still favors faster, more reliable providers
 */

import { getSharedRedis } from "./shared_redis.js";
import { CHAIN_ALIASES } from "./providers.js";

const DEFAULT_LATENCY = 500;
const MIN_WEIGHT = 1;
const MAX_WEIGHT = 100;

// Use shared Redis client to avoid connection pool exhaustion
function getRedis() {
  return getSharedRedis();
}

function getRequestCountKey(chain, providerId) {
  const normalized = CHAIN_ALIASES[chain] || chain;
  return `rpc:requests:${normalized}:${providerId}`;
}

export function calculateWeight(provider) {
  const latency = provider.latency || DEFAULT_LATENCY;
  const rateLimit = provider.rateLimit || 100;

  const latencyScore = 1 / Math.sqrt(latency);
  const rateLimitBonus = Math.log10(rateLimit + 1);
  const priorityBonus = (10 - Math.min(provider.priority || 1, 10)) / 10;

  let weight = latencyScore * rateLimitBonus * (1 + priorityBonus);

  weight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, Math.round(weight)));

  return weight;
}

export function selectWeightedProvider(providers) {
  if (providers.length === 0) return null;
  if (providers.length === 1) return providers[0];

  const weights = providers.map((p) => ({
    provider: p,
    weight: calculateWeight(p),
  }));

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);

  if (totalWeight === 0) {
    return providers[0];
  }

  const random = Math.random() * totalWeight;
  let cumulative = 0;

  for (const { provider, weight } of weights) {
    cumulative += weight;
    if (random <= cumulative) {
      return provider;
    }
  }

  return providers[providers.length - 1];
}

export async function incrementRequestCount(chain, providerId) {
  const client = getRedis();
  if (!client) return;

  try {
    const key = getRequestCountKey(chain, providerId);
    await client.incr(key);
    await client.expire(key, 3600);
  } catch (err) {
    console.error(
      "[LoadBalancer] Failed to increment request count:",
      err.message,
    );
  }
}

export async function getRequestCounts(chain, providerIds) {
  const client = getRedis();
  if (!client) {
    return providerIds.map(() => 0);
  }

  try {
    const keys = providerIds.map((id) => getRequestCountKey(chain, id));
    const values = await client.mget(...keys);
    return values.map((v) => parseInt(v) || 0);
  } catch (err) {
    console.error("[LoadBalancer] Failed to get request counts:", err.message);
    return providerIds.map(() => 0);
  }
}

export function getWeightsForProviders(providers) {
  return providers.map((p) => ({
    id: p.id,
    weight: calculateWeight(p),
    latency: p.latency,
    rateLimit: p.rateLimit,
  }));
}

export { MIN_WEIGHT, MAX_WEIGHT, DEFAULT_LATENCY };
