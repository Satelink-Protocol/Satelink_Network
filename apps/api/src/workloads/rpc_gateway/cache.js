/**
 * Redis Response Cache for RPC Gateway
 * S1-RPC-004: Response caching with TTL per method type
 *
 * Cache rules:
 * - Read-heavy methods: cached with appropriate TTL
 * - Write operations: NEVER cached
 * - Cache key: rpc:cache:{chain}:{method}:{hash(params)}
 */

import { getSharedRedis } from './shared_redis.js';
import crypto from 'crypto';
import { CHAIN_ALIASES } from './providers.js';

const METHOD_TTL = {
  'eth_blockNumber': 5,
  'eth_chainId': 3600,
  'eth_gasPrice': 5,
  'eth_getBalance': 10,
  'eth_call': 3,
  'eth_getCode': 300,
  'eth_getLogs': 30,
  'eth_getBlockByNumber': 60,
  'eth_getBlockByHash': 3600,
  'eth_getTransactionByHash': 3600,
  'eth_getTransactionReceipt': 3600,
  'net_version': 3600,
  'web3_clientVersion': 3600
};

const NEVER_CACHE = new Set([
  'eth_sendRawTransaction',
  'eth_sendTransaction',
  'eth_estimateGas',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_accounts',
  'eth_requestAccounts'
]);

let cacheStats = {
  hits: 0,
  misses: 0
};

// Use shared Redis client to avoid connection pool exhaustion
function getRedis() {
  return getSharedRedis();
}

function hashParams(params) {
  if (!params || params.length === 0) {
    return 'empty';
  }
  const str = JSON.stringify(params);
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

function getCacheKey(chain, method, params) {
  const normalized = CHAIN_ALIASES[chain] || chain;
  const paramHash = hashParams(params);
  return `rpc:cache:${normalized}:${method}:${paramHash}`;
}

export function isCacheable(method) {
  if (NEVER_CACHE.has(method)) {
    return false;
  }
  return METHOD_TTL[method] !== undefined;
}

export function getTTL(method) {
  return METHOD_TTL[method] || 0;
}

export async function getCached(chain, method, params) {
  if (!isCacheable(method)) {
    return null;
  }

  const client = getRedis();
  if (!client) {
    cacheStats.misses++;
    return null;
  }

  const key = getCacheKey(chain, method, params);

  try {
    const cached = await client.get(key);
    if (cached) {
      cacheStats.hits++;
      console.log(`[RPC Cache] HIT ${method} (${key.slice(-20)})`);
      return JSON.parse(cached);
    }
  } catch (err) {
    console.error('[RPC Cache] Get failed:', err.message);
  }

  cacheStats.misses++;
  return null;
}

export async function setCached(chain, method, params, response) {
  if (!isCacheable(method)) {
    return;
  }

  const ttl = getTTL(method);
  if (ttl <= 0) {
    return;
  }

  const client = getRedis();
  if (!client) {
    return;
  }

  const key = getCacheKey(chain, method, params);

  try {
    await client.set(key, JSON.stringify(response), 'EX', ttl);
    console.log(`[RPC Cache] SET ${method} TTL=${ttl}s`);
  } catch (err) {
    console.error('[RPC Cache] Set failed:', err.message);
  }
}

export function getCacheStats() {
  const total = cacheStats.hits + cacheStats.misses;
  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    total,
    hitRate: total > 0 ? ((cacheStats.hits / total) * 100).toFixed(1) : '0.0'
  };
}

export function resetCacheStats() {
  cacheStats.hits = 0;
  cacheStats.misses = 0;
}

export { METHOD_TTL, NEVER_CACHE };
