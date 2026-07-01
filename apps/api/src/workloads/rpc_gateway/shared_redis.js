/**
 * Shared Redis Client for RPC Gateway
 * Single connection shared across all RPC gateway modules.
 * REDIS_URL is set in Railway — do not stub this.
 *
 * Uses ioredis (the project's Redis client); the node-redis `redis`
 * package is not a dependency here.
 */
import Redis from 'ioredis';

let client = null;
let connectionAttempted = false;

async function connect() {
  if (connectionAttempted) return;
  connectionAttempted = true;

  const url = process.env.REDIS_URL;
  if (!url || url === 'redis://') {
    console.warn('[SharedRedis] REDIS_URL not set — cache disabled');
    return;
  }

  try {
    client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: times => Math.min(times * 100, 3000),
    });
    client.on('error', err => console.error('[SharedRedis] Error:', err.message));
    client.on('ready', () => console.log('[SharedRedis] Connected'));
    client.on('reconnecting', () => console.warn('[SharedRedis] Reconnecting...'));
    await client.connect();
  } catch (err) {
    console.error('[SharedRedis] Connection failed:', err.message);
    client = null;
  }
}

// Connect on module load
connect();

function isReady() {
  return client?.status === 'ready';
}

export function getSharedRedis() {
  return isReady() ? client : null;
}

export function getRedisStatus() {
  if (!client) return { status: 'disconnected', reason: 'never connected' };
  return { status: isReady() ? 'connected' : 'connecting' };
}

export function isRedisHealthy() {
  return isReady();
}

export const OPERATION_TIMEOUT_MS = 500;

export async function withTimeout(promise, timeoutMs = OPERATION_TIMEOUT_MS, fallback = null) {
  return Promise.race([promise, new Promise(r => setTimeout(() => r(fallback), timeoutMs))]);
}

export async function safeGet(key, fallback = null) {
  try { return (await client?.get(key)) ?? fallback; } catch { return fallback; }
}

export async function safeSet(key, value, ttl = 3600) {
  try { await client?.set(key, value, 'EX', ttl); return true; } catch { return false; }
}

export async function safeIncr(key) {
  try { return (await client?.incr(key)) ?? 0; } catch { return 0; }
}

export async function safeMget(...keys) {
  try { return (await client?.mget(keys)) ?? keys.map(() => null); } catch { return keys.map(() => null); }
}
