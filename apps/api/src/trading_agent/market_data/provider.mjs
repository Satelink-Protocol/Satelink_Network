// MarketDataProvider (Stage 11). Internal-only; no route exposes it.
//
// getQuote / getCandles:
//   1. entitlement check for (principal, venue, dataset, purpose) — deny by default;
//   2. cache lookup (namespaced key); a cached item is RE-EVALUATED for staleness
//      against `now` — caching never makes data fresh;
//   3. on miss or stale cache entry: fetch from the venue (_fetch* hook), normalize,
//      cache with TTL strictly below the staleness threshold;
//   4. return { data, freshness } — callers (risk) must reject freshness.stale.
import { Dataset, MarketDataError, normalizeCandle, normalizeQuote, CandleInterval } from './types.mjs';
import { cacheTtlFor, computeStaleness, defineStalenessPolicy } from './staleness.mjs';
import { marketDataKey } from './cache.mjs';

export class MarketDataProvider {
  #entitlements;
  #cache;
  #clock;
  #policies;
  #ttls;

  /**
   * @param {object} deps
   * @param {import('./entitlements.mjs').EntitlementService} deps.entitlements
   * @param {{get:Function,set:Function}} deps.cache           InMemoryLruCache or RedisMarketDataCache
   * @param {() => Date} deps.clock
   * @param {{quotes:{maxAgeMs:number}, candles:{maxAgeMs:number}}} deps.staleness
   * @param {{quotes?:number, candles?:number}} [deps.cacheTtlMs]  each must be < its staleness threshold
   */
  constructor({ entitlements, cache, clock, staleness, cacheTtlMs = {} }) {
    if (!entitlements || typeof entitlements.assertAllowed !== 'function') throw new MarketDataError('CONFIG', 'entitlements service required');
    if (!cache || typeof cache.get !== 'function' || typeof cache.set !== 'function') throw new MarketDataError('CONFIG', 'cache required');
    if (typeof clock !== 'function') throw new MarketDataError('CONFIG', 'clock required');
    this.#entitlements = entitlements;
    this.#cache = cache;
    this.#clock = clock;
    this.#policies = {
      [Dataset.QUOTES]: defineStalenessPolicy(staleness?.quotes ?? {}),
      [Dataset.CANDLES]: defineStalenessPolicy(staleness?.candles ?? {}),
    };
    this.#ttls = {
      [Dataset.QUOTES]: cacheTtlFor(this.#policies.quotes, cacheTtlMs.quotes),
      [Dataset.CANDLES]: cacheTtlFor(this.#policies.candles, cacheTtlMs.candles),
    };
  }

  /** @returns {{venue:string, datasets:string[], candleIntervals:string[], realtime:boolean}} */
  capabilities() { throw new Error(`${this.constructor.name}.capabilities() not implemented`); }

  stalenessPolicy(dataset) { return this.#policies[dataset]; }
  cacheTtl(dataset) { return this.#ttls[dataset]; }

  async getQuote(principalId, instrument, { purpose }) {
    const { venue } = this.capabilities();
    await this.#entitlements.assertAllowed({ principalId, venue, dataset: Dataset.QUOTES, purpose });
    const key = marketDataKey('quote', venue, instrument);
    return this.#read(key, Dataset.QUOTES, async () => normalizeQuote(await this._fetchQuote(instrument)));
  }

  async getCandles(principalId, instrument, interval, { purpose, limit = 100 }) {
    const { venue } = this.capabilities();
    if (!Object.values(CandleInterval).includes(interval)) throw new MarketDataError('INVALID_DATA', `invalid interval ${interval}`);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new MarketDataError('INVALID_DATA', 'limit must be 1..1000');
    await this.#entitlements.assertAllowed({ principalId, venue, dataset: Dataset.CANDLES, purpose });
    const key = marketDataKey('candles', venue, instrument, interval, String(limit));
    return this.#read(key, Dataset.CANDLES, async () => {
      const rows = (await this._fetchCandles(instrument, interval, limit)).map(normalizeCandle);
      if (rows.length === 0) throw new MarketDataError('UPSTREAM_UNAVAILABLE', 'no candles returned');
      return rows;
    });
  }

  async #read(key, dataset, fetchFresh) {
    const policy = this.#policies[dataset];
    const cached = await this.#cache.get(key);
    if (cached != null) {
      const f = this.#freshness(cached, policy);
      if (!f.stale) return Object.freeze({ data: cached, freshness: f, cache: 'hit' });
    }
    const data = await fetchFresh();
    await this.#cache.set(key, data, this.#ttls[dataset]);
    return Object.freeze({ data, freshness: this.#freshness(data, policy), cache: cached == null ? 'miss' : 'stale_refetched' });
  }

  /** For candle series, staleness is judged on the most recent candle. */
  #freshness(data, policy) {
    const item = Array.isArray(data) ? data[data.length - 1] : data;
    return computeStaleness(item, policy, this.#clock());
  }

  // Hooks implemented by concrete providers; return RAW venue-shaped objects already
  // mapped to the normalizeQuote/normalizeCandle input fields.
  async _fetchQuote() { throw new MarketDataError('NOT_IMPLEMENTED', `${this.constructor.name}._fetchQuote() not implemented`); }
  async _fetchCandles() { throw new MarketDataError('NOT_IMPLEMENTED', `${this.constructor.name}._fetchCandles() not implemented`); }
}
