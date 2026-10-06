// Market-data cache backends (Stage 11).
//
// FOUNDER DECISION (2026-09-30): the only Redis today is shared with production
// RPC (same DB 0, no key prefix; money-path keys such as billing:dedup:* live
// there; maxmemory/eviction policy unknown). Therefore:
//   * default backend = bounded in-process LRU (no shared state);
//   * RedisMarketDataCache takes an INJECTED client and is NOT wired to the
//     production client anywhere. Wire it only to a dedicated trading Redis.
// Both backends enforce: namespace `trading:md:v1:` only, TTL > 0, value-size cap.
import { MarketDataError } from './types.mjs';

export const CACHE_NAMESPACE = 'trading:md:v1:';
const KEY_PART_RE = /^[A-Za-z0-9._:|/-]{1,80}$/;

/** Build a namespaced key from parts (kind, venue, instrument, interval…). */
export function marketDataKey(...parts) {
  for (const p of parts) if (typeof p !== 'string' || !KEY_PART_RE.test(p)) throw new MarketDataError('CONFIG', `invalid cache key part: ${p}`);
  return CACHE_NAMESPACE + parts.join(':');
}

function assertKey(key) {
  if (typeof key !== 'string' || !key.startsWith(CACHE_NAMESPACE)) {
    throw new MarketDataError('CONFIG', `cache key must start with ${CACHE_NAMESPACE} (existing Redis namespaces are off-limits)`);
  }
}

const serialize = (value) => JSON.stringify(value);

export class InMemoryLruCache {
  #map = new Map();
  #maxEntries;
  #maxValueBytes;
  #clock;
  constructor({ maxEntries = 5_000, maxValueBytes = 16_384, clock }) {
    if (typeof clock !== 'function') throw new MarketDataError('CONFIG', 'InMemoryLruCache requires a clock');
    this.#maxEntries = maxEntries;
    this.#maxValueBytes = maxValueBytes;
    this.#clock = clock;
  }
  get size() { return this.#map.size; }
  async get(key) {
    assertKey(key);
    const e = this.#map.get(key);
    if (!e) return null;
    if (this.#clock().getTime() >= e.expiresAt) { this.#map.delete(key); return null; }
    this.#map.delete(key); this.#map.set(key, e); // LRU touch
    return JSON.parse(e.json);
  }
  async set(key, value, ttlMs) {
    assertKey(key);
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new MarketDataError('CONFIG', 'ttlMs must be a positive integer');
    const json = serialize(value);
    if (Buffer.byteLength(json) > this.#maxValueBytes) throw new MarketDataError('CONFIG', `value exceeds ${this.#maxValueBytes} bytes`);
    this.#map.delete(key);
    this.#map.set(key, { json, expiresAt: this.#clock().getTime() + ttlMs });
    while (this.#map.size > this.#maxEntries) this.#map.delete(this.#map.keys().next().value);
  }
}

/**
 * Redis backend over an injected ioredis-compatible client (get, set with PX).
 * Never imports or discovers a client itself.
 */
export class RedisMarketDataCache {
  #client;
  #maxValueBytes;
  constructor({ client, maxValueBytes = 16_384 }) {
    if (!client || typeof client.get !== 'function' || typeof client.set !== 'function') {
      throw new MarketDataError('CONFIG', 'RedisMarketDataCache requires an injected client with get/set');
    }
    this.#client = client;
    this.#maxValueBytes = maxValueBytes;
  }
  async get(key) {
    assertKey(key);
    const raw = await this.#client.get(key);
    return raw == null ? null : JSON.parse(raw);
  }
  async set(key, value, ttlMs) {
    assertKey(key);
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) throw new MarketDataError('CONFIG', 'ttlMs must be a positive integer');
    const json = serialize(value);
    if (Buffer.byteLength(json) > this.#maxValueBytes) throw new MarketDataError('CONFIG', `value exceeds ${this.#maxValueBytes} bytes`);
    await this.#client.set(key, json, 'PX', ttlMs); // every key expires; no persistent trading keys
  }
}
