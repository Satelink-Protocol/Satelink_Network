import { expect } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Dataset, Purpose, MarketDataError, normalizeQuote, normalizeCandle,
  defineStalenessPolicy, computeStaleness, StalenessReason, cacheTtlFor, withStaleness,
  EntitlementService, InMemoryEntitlementStore, PgEntitlementStore, SATISFYING_SCOPES,
  InMemoryLruCache, RedisMarketDataCache, marketDataKey, CACHE_NAMESPACE,
  MarketDataProvider, BinancePublicDataProvider,
} from '../src/trading_agent/market_data/index.mjs';

// Stage 11 — market data: staleness, cache expiry, entitlement denial. Pure (no network, no Redis, no DB).
const T0 = new Date('2026-01-01T00:00:00.000Z');
const at = (ms) => new Date(T0.getTime() + ms);
const fakeClock = (start = T0) => { let now = start.getTime(); const c = () => new Date(now); c.advance = (ms) => { now += ms; }; c.set = (d) => { now = d.getTime(); }; return c; };
const rawQuote = (sourceTimestamp = T0, patch = {}) => ({ venue: 'mock', instrument: 'BTC-USDT', bid: '64000.10', ask: '64000.20', last: '64000.15', sourceTimestamp, receivedAt: sourceTimestamp, ...patch });
const grant = (patch = {}) => ({ id: 'mde_1', principal_id: 'prn_a', venue: 'mock', dataset: 'quotes', scope: 'internal_use', status: 'active', valid_from: '2025-01-01T00:00:00Z', valid_until: null, ...patch });

async function expectMdError(p, code) {
  try { await p; expect.fail(`expected ${code}`); } catch (e) { expect(e).to.be.instanceOf(MarketDataError); expect(e.code).to.equal(code); return e; }
}

describe('market data: normalization', () => {
  it('normalizes a quote and rejects crossed / malformed ones', () => {
    const q = normalizeQuote(rawQuote());
    expect(q).to.deep.include({ kind: 'quote', bid: '64000.10', ask: '64000.20', sourceTimestamp: T0.toISOString() });
    expect(Object.isFrozen(q)).to.equal(true);
    expect(() => normalizeQuote(rawQuote(T0, { bid: '2', ask: '1' }))).to.throw(MarketDataError, /crossed/);
    expect(() => normalizeQuote(rawQuote(T0, { bid: 64000.1 }))).to.throw(/decimal string/);
    expect(() => normalizeQuote(rawQuote('not-a-date'))).to.throw(/timestamp/);
    expect(() => normalizeQuote(rawQuote(T0, { venue: 'nyse' }))).to.throw(/unknown venue/);
  });
  it('normalizes a candle with derived closeTime and OHLC checks', () => {
    const c = normalizeCandle({ venue: 'mock', instrument: 'BTC-USDT', interval: '1m', openTime: T0, open: '10', high: '12', low: '9', close: '11', volume: '3', closed: true, updatedAt: at(60_000) });
    expect(c.closeTime).to.equal(at(60_000).toISOString());
    expect(() => normalizeCandle({ venue: 'mock', instrument: 'X-Y', interval: '1m', openTime: T0, open: '13', high: '12', low: '9', close: '11', volume: '3', updatedAt: T0 })).to.throw(/above high/);
    expect(() => normalizeCandle({ venue: 'mock', instrument: 'X-Y', interval: '2m', openTime: T0, open: '1', high: '1', low: '1', close: '1', volume: '0', updatedAt: T0 })).to.throw(/interval/);
  });
});

describe('market data: staleness (deterministic)', () => {
  const policy = defineStalenessPolicy({ maxAgeMs: 2_000, maxFutureSkewMs: 500 });
  const q = normalizeQuote(rawQuote(T0));

  it('is fresh up to and including maxAgeMs, stale 1 ms later', () => {
    expect(computeStaleness(q, policy, at(0))).to.deep.include({ ageMs: 0, stale: false, reason: StalenessReason.FRESH });
    expect(computeStaleness(q, policy, at(2_000))).to.deep.include({ ageMs: 2_000, stale: false });
    expect(computeStaleness(q, policy, at(2_001))).to.deep.include({ ageMs: 2_001, stale: true, reason: StalenessReason.STALE_AGE });
  });
  it('is identical for identical inputs (deterministic)', () => {
    expect(computeStaleness(q, policy, at(2_001))).to.deep.equal(computeStaleness(q, policy, at(2_001)));
  });
  it('measures age from the venue timestamp, not local receipt', () => {
    const late = normalizeQuote(rawQuote(T0, { receivedAt: at(1_999) }));
    expect(computeStaleness(late, policy, at(2_500)).stale).to.equal(true);
  });
  it('flags future timestamps beyond the skew allowance', () => {
    expect(computeStaleness(normalizeQuote(rawQuote(at(500))), policy, T0).stale).to.equal(false);
    expect(computeStaleness(normalizeQuote(rawQuote(at(501))), policy, T0)).to.deep.include({ stale: true, reason: StalenessReason.FUTURE_TIMESTAMP });
  });
  it('uses closeTime for closed candles and updatedAt for open ones', () => {
    const base = { venue: 'mock', instrument: 'BTC-USDT', interval: '1m', openTime: T0, open: '1', high: '1', low: '1', close: '1', volume: '0' };
    const closed = normalizeCandle({ ...base, closed: true, updatedAt: at(60_000) });
    expect(computeStaleness(closed, policy, at(62_000)).stale).to.equal(false);
    expect(computeStaleness(closed, policy, at(62_001)).stale).to.equal(true);
    const open = normalizeCandle({ ...base, closed: false, updatedAt: at(10_000) });
    expect(computeStaleness(open, policy, at(12_001))).to.deep.include({ stale: true, reason: StalenessReason.NOT_CLOSED_TOO_LONG });
  });
  it('withStaleness wraps data + freshness', () => {
    expect(withStaleness(q, policy, at(1)).freshness.stale).to.equal(false);
  });
  it('rejects invalid policies and requires cache TTL < staleness threshold', () => {
    expect(() => defineStalenessPolicy({ maxAgeMs: 0 })).to.throw(MarketDataError);
    expect(cacheTtlFor(policy)).to.equal(1_000);
    expect(cacheTtlFor(policy, 1_999)).to.equal(1_999);
    expect(() => cacheTtlFor(policy, 2_000)).to.throw(/must be < staleness threshold/);
    expect(() => cacheTtlFor(policy, 5_000)).to.throw(/must be < staleness threshold/);
  });
});

describe('market data: cache', () => {
  it('builds namespaced keys and refuses anything else', async () => {
    expect(marketDataKey('quote', 'binance', 'BTC-USDT')).to.equal('trading:md:v1:quote:binance:BTC-USDT');
    expect(CACHE_NAMESPACE).to.equal('trading:md:v1:');
    expect(() => marketDataKey('quote', 'bad key with spaces')).to.throw(MarketDataError);
    const c = new InMemoryLruCache({ clock: fakeClock() });
    for (const k of ['billing:dedup:abc', 'ft:1.2.3.4', 'market:discovery', 'trading:other']) {
      await expectMdError(c.set(k, 1, 1000), 'CONFIG');
      await expectMdError(c.get(k), 'CONFIG');
    }
  });
  it('expires entries exactly at TTL (in-memory)', async () => {
    const clock = fakeClock();
    const c = new InMemoryLruCache({ clock });
    const k = marketDataKey('quote', 'mock', 'BTC-USDT');
    await c.set(k, { v: 1 }, 1_000);
    clock.advance(999); expect(await c.get(k)).to.deep.equal({ v: 1 });
    clock.advance(1); expect(await c.get(k)).to.equal(null);
  });
  it('is bounded (LRU) and size-capped', async () => {
    const c = new InMemoryLruCache({ clock: fakeClock(), maxEntries: 2, maxValueBytes: 32 });
    const k = (i) => marketDataKey('quote', 'mock', `I${i}-USDT`);
    await c.set(k(1), 1, 10_000); await c.set(k(2), 2, 10_000);
    await c.get(k(1));            // touch 1 → 2 becomes LRU
    await c.set(k(3), 3, 10_000);
    expect([await c.get(k(1)), await c.get(k(2)), await c.get(k(3))]).to.deep.equal([1, null, 3]);
    expect(c.size).to.equal(2);
    await expectMdError(c.set(k(4), 'x'.repeat(64), 1_000), 'CONFIG');
    await expectMdError(c.set(k(4), 1, 0), 'CONFIG');
  });
  it('Redis backend uses only an injected client, the namespace, and PX TTL', async () => {
    const calls = [];
    const fake = { store: new Map(), async get(k) { calls.push(['get', k]); return this.store.get(k) ?? null; }, async set(...a) { calls.push(['set', ...a]); this.store.set(a[0], a[1]); return 'OK'; } };
    expect(() => new RedisMarketDataCache({})).to.throw(MarketDataError, /injected client/);
    const c = new RedisMarketDataCache({ client: fake });
    const k = marketDataKey('quote', 'mock', 'BTC-USDT');
    await c.set(k, { bid: '1' }, 750);
    expect(calls[0]).to.deep.equal(['set', k, '{"bid":"1"}', 'PX', 750]);
    expect(await c.get(k)).to.deep.equal({ bid: '1' });
    await expectMdError(c.set('billing:dedup:x', 1, 100), 'CONFIG');
    expect(calls.filter((x) => x[0] === 'set').length).to.equal(1);
  });
  it('no market_data module imports a production Redis client', () => {
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/trading_agent/market_data');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
      const code = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const imports = [...code.matchAll(/(?:from|import\(|require\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of imports) expect(spec, `${f} imports ${spec}`).to.not.match(/^(ioredis|redis)$|shared_redis|redisClient|server\.js|app_factory/);
      expect(code, f).to.not.match(/process\.env\.REDIS/);
    }
  });
});

describe('market data: entitlements (deny by default)', () => {
  const svc = (rows, clock = fakeClock()) => new EntitlementService({ store: new InMemoryEntitlementStore(rows), clock });

  it('denies when no grant exists', async () => {
    await expectMdError(svc([]).assertAllowed({ principalId: 'prn_a', venue: 'mock', dataset: 'quotes', purpose: Purpose.INTERNAL_USE }), 'ENTITLEMENT_DENIED');
  });
  it('allows internal use with an internal_use grant but never redistribution', async () => {
    const s = svc([grant()]);
    expect(await s.assertAllowed({ principalId: 'prn_a', venue: 'mock', dataset: 'quotes', purpose: Purpose.INTERNAL_USE })).to.deep.equal({ allowed: true, entitlementId: 'mde_1', scope: 'internal_use' });
    await expectMdError(s.assertAllowed({ principalId: 'prn_a', venue: 'mock', dataset: 'quotes', purpose: Purpose.DISPLAY }), 'ENTITLEMENT_DENIED');
    await expectMdError(s.assertAllowed({ principalId: 'prn_a', venue: 'mock', dataset: 'quotes', purpose: Purpose.REDISTRIBUTION }), 'ENTITLEMENT_DENIED');
  });
  it('redistribution requires its own grant; display does not imply it', async () => {
    await expectMdError(svc([grant({ scope: 'display' })]).assertAllowed({ principalId: 'prn_a', venue: 'mock', dataset: 'quotes', purpose: Purpose.REDISTRIBUTION }), 'ENTITLEMENT_DENIED');
    expect((await svc([grant({ scope: 'redistribution' })]).assertAllowed({ principalId: 'prn_a', venue: 'mock', dataset: 'quotes', purpose: Purpose.REDISTRIBUTION })).scope).to.equal('redistribution');
    expect(SATISFYING_SCOPES[Purpose.REDISTRIBUTION]).to.deep.equal(['redistribution']);
  });
  it('denies other principal, venue, dataset, revoked, expired and not-yet-valid grants', async () => {
    const req = { principalId: 'prn_a', venue: 'mock', dataset: 'quotes', purpose: Purpose.INTERNAL_USE };
    for (const g of [grant({ principal_id: 'prn_b' }), grant({ venue: 'binance' }), grant({ dataset: 'candles' }), grant({ status: 'revoked' }),
      grant({ valid_until: '2025-12-31T23:59:59Z' }), grant({ valid_from: '2026-06-01T00:00:00Z' })]) {
      await expectMdError(svc([g]).assertAllowed(req), 'ENTITLEMENT_DENIED');
    }
    await expectMdError(svc([grant()]).assertAllowed({ ...req, purpose: 'resell' }), 'ENTITLEMENT_DENIED');
    await expectMdError(svc([grant()]).assertAllowed({ ...req, principalId: '' }), 'ENTITLEMENT_DENIED');
  });
  it('PgEntitlementStore issues a parameterized, deny-by-default query', async () => {
    const seen = [];
    const store = new PgEntitlementStore({ async query(sql, params) { seen.push({ sql, params }); return { rows: [] }; } });
    const s = new EntitlementService({ store, clock: () => T0 });
    await expectMdError(s.assertAllowed({ principalId: 'prn_a', venue: 'mock', dataset: 'quotes', purpose: Purpose.DISPLAY }), 'ENTITLEMENT_DENIED');
    expect(seen[0].params).to.deep.equal(['prn_a', 'mock', 'quotes', ['display', 'redistribution'], T0]);
    expect(seen[0].sql).to.match(/FROM market_data_entitlements/).and.match(/status = 'active'/);
  });
});

describe('market data: provider', () => {
  class FakeProvider extends MarketDataProvider {
    constructor(deps, { quoteAt }) { super(deps); this.fetches = 0; this.quoteAt = quoteAt; }
    capabilities() { return { venue: 'mock', datasets: ['quotes', 'candles'], candleIntervals: ['1m'], realtime: false }; }
    async _fetchQuote() { this.fetches += 1; return rawQuote(this.quoteAt()); }
    async _fetchCandles() {
      this.fetches += 1;
      return [{ venue: 'mock', instrument: 'BTC-USDT', interval: '1m', openTime: at(-120_000), open: '1', high: '2', low: '1', close: '2', volume: '1', closed: true, updatedAt: at(-60_000) }];
    }
  }
  const setup = ({ rows = [grant(), grant({ id: 'mde_2', dataset: 'candles' })], quoteAt } = {}) => {
    const clock = fakeClock();
    const cache = new InMemoryLruCache({ clock });
    const p = new FakeProvider({
      entitlements: new EntitlementService({ store: new InMemoryEntitlementStore(rows), clock }),
      cache, clock, staleness: { quotes: { maxAgeMs: 2_000 }, candles: { maxAgeMs: 90_000 } }, cacheTtlMs: { quotes: 1_000 },
    }, { quoteAt: quoteAt ?? (() => clock()) });
    return { p, clock, cache };
  };

  it('denies before fetching when not entitled', async () => {
    const { p } = setup({ rows: [] });
    await expectMdError(p.getQuote('prn_a', 'BTC-USDT', { purpose: Purpose.INTERNAL_USE }), 'ENTITLEMENT_DENIED');
    expect(p.fetches).to.equal(0);
  });
  it('miss → fetch → cache hit within TTL; TTL is below the staleness threshold', async () => {
    const { p, clock } = setup();
    const a = await p.getQuote('prn_a', 'BTC-USDT', { purpose: Purpose.INTERNAL_USE });
    expect([a.cache, a.freshness.stale, p.fetches]).to.deep.equal(['miss', false, 1]);
    clock.advance(999);
    const b = await p.getQuote('prn_a', 'BTC-USDT', { purpose: Purpose.INTERNAL_USE });
    expect([b.cache, b.freshness.ageMs, p.fetches]).to.deep.equal(['hit', 999, 1]);
    expect(p.cacheTtl(Dataset.QUOTES)).to.be.below(p.stalenessPolicy(Dataset.QUOTES).maxAgeMs);
    clock.advance(1); // TTL expired → refetch
    const c = await p.getQuote('prn_a', 'BTC-USDT', { purpose: Purpose.INTERNAL_USE });
    expect([c.cache, p.fetches]).to.deep.equal(['miss', 2]);
  });
  it('flags a stale upstream quote deterministically (acceptance)', async () => {
    const { p } = setup({ quoteAt: () => at(-2_001) });
    const r = await p.getQuote('prn_a', 'BTC-USDT', { purpose: Purpose.INTERNAL_USE });
    expect(r.freshness).to.deep.include({ stale: true, reason: 'stale_age', ageMs: 2_001, maxAgeMs: 2_000, evaluatedAt: T0.toISOString() });
    const again = await setup({ quoteAt: () => at(-2_001) }).p.getQuote('prn_a', 'BTC-USDT', { purpose: Purpose.INTERNAL_USE });
    expect(again.freshness).to.deep.equal(r.freshness);
  });
  it('re-evaluates cached data and refetches when a cached entry has gone stale', async () => {
    const clock = fakeClock();
    const cache = new InMemoryLruCache({ clock });
    const key = marketDataKey('quote', 'mock', 'BTC-USDT');
    await cache.set(key, normalizeQuote(rawQuote(at(-5_000))), 60_000); // planted stale entry (TTL longer than policy on purpose)
    const p = new FakeProvider({ entitlements: new EntitlementService({ store: new InMemoryEntitlementStore([grant()]), clock }), cache, clock, staleness: { quotes: { maxAgeMs: 2_000 }, candles: { maxAgeMs: 90_000 } } }, { quoteAt: () => clock() });
    const r = await p.getQuote('prn_a', 'BTC-USDT', { purpose: Purpose.INTERNAL_USE });
    expect([r.cache, r.freshness.stale, p.fetches]).to.deep.equal(['stale_refetched', false, 1]);
  });
  it('candles: freshness judged on the latest candle; interval/limit validated', async () => {
    const { p } = setup();
    const r = await p.getCandles('prn_a', 'BTC-USDT', '1m', { purpose: Purpose.INTERNAL_USE, limit: 1 });
    expect(r.data).to.have.length(1);
    expect(r.freshness).to.deep.include({ stale: false, ageMs: 60_000 });
    await expectMdError(p.getCandles('prn_a', 'BTC-USDT', '7m', { purpose: Purpose.INTERNAL_USE }), 'INVALID_DATA');
    await expectMdError(p.getCandles('prn_a', 'BTC-USDT', '1m', { purpose: Purpose.INTERNAL_USE, limit: 0 }), 'INVALID_DATA');
  });
  it('refuses a cache TTL at or above the staleness threshold at construction', () => {
    const clock = fakeClock();
    expect(() => new FakeProvider({ entitlements: new EntitlementService({ store: new InMemoryEntitlementStore([]), clock }), cache: new InMemoryLruCache({ clock }), clock,
      staleness: { quotes: { maxAgeMs: 2_000 }, candles: { maxAgeMs: 90_000 } }, cacheTtlMs: { quotes: 2_000 } }, { quoteAt: clock })).to.throw(/must be < staleness threshold/);
  });
  it('Binance public provider is a stub until Stage 21 (entitlement still enforced first)', async () => {
    const clock = fakeClock();
    const deps = (rows) => ({ entitlements: new EntitlementService({ store: new InMemoryEntitlementStore(rows), clock }), cache: new InMemoryLruCache({ clock }), clock, staleness: { quotes: { maxAgeMs: 2_000 }, candles: { maxAgeMs: 90_000 } } });
    await expectMdError(new BinancePublicDataProvider(deps([])).getQuote('prn_a', 'BTC-USDT', { purpose: Purpose.INTERNAL_USE }), 'ENTITLEMENT_DENIED');
    const b = new BinancePublicDataProvider(deps([grant({ venue: 'binance' })]));
    await expectMdError(b.getQuote('prn_a', 'BTC-USDT', { purpose: Purpose.INTERNAL_USE }), 'NOT_IMPLEMENTED');
    expect(b.capabilities()).to.deep.include({ venue: 'binance', implementedInStage: 21 });
  });
});
