// M3 — connectors + engine tests (offline: injected fetchImpl + in-memory pool).
import { expect } from 'chai';
import { fetchFundingRates, fetchOrderBooks } from '../src/intelligence/connectors.js';
import { refreshMetric, readMetric } from '../src/intelligence/engine.js';

// A fetchImpl stub: maps URL substrings → JSON, or simulates failure.
function stubFetch(map) {
  return async (url) => {
    for (const [needle, val] of Object.entries(map)) {
      if (url.includes(needle)) {
        if (val === 'FAIL') return { ok: false, status: 503, json: async () => ({}) };
        if (val === 'THROW') throw new Error('network down');
        return { ok: true, json: async () => val };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// Minimal in-memory pool: stores intelligence_snapshots rows; enough for the
// engine's INSERT + latest-SELECT. Not a real Postgres — deterministic.
function memPool() {
  const rows = [];
  return {
    _rows: rows,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX')) return { rows: [] };
      if (s.startsWith('INSERT INTO intelligence_snapshots')) {
        rows.push({ metric: params[0], payload: JSON.parse(params[1]), source_rows: params[2], captured_at: new Date() });
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('SELECT payload, source_rows, captured_at FROM intelligence_snapshots')) {
        const metric = params[0];
        // Latest = last row inserted for this metric (real engine uses
        // ORDER BY captured_at DESC; serial insertion order is the ground truth
        // and avoids same-millisecond tie ambiguity in this in-memory stub).
        const match = rows.filter((r) => r.metric === metric);
        return { rows: match.length ? [match[match.length - 1]] : [] };
      }
      return { rows: [] };
    },
  };
}

describe('intelligence/connectors (graceful degradation)', () => {
  it('parses Binance + Bybit funding into normalized rows', async () => {
    const f = stubFetch({
      'premiumIndex': [{ symbol: 'BTCUSDT', lastFundingRate: '0.0001', markPrice: '100' }],
      'tickers': { result: { list: [{ symbol: 'BTCUSDT', fundingRate: '0.0003' }] } },
    });
    const rows = await fetchFundingRates(f, ['BTCUSDT']);
    expect(rows).to.have.length(2);
    expect(rows.map((r) => r.exchange)).to.have.members(['binance', 'bybit']);
  });

  it('a thrown/failed upstream yields [] — never throws to the caller', async () => {
    expect(await fetchFundingRates(stubFetch({ premiumIndex: 'THROW', tickers: 'FAIL' }), ['BTCUSDT'])).to.deep.equal([]);
    expect(await fetchOrderBooks(stubFetch({ depth: 'FAIL' }), ['BTCUSDT'])).to.deep.equal([]);
  });
});

describe('intelligence/engine (snapshot cache + honest staleness)', () => {
  it('refreshMetric stores a snapshot; readMetric serves it fresh', async () => {
    const pool = memPool();
    const f = stubFetch({
      'premiumIndex': [{ symbol: 'BTCUSDT', lastFundingRate: '0.0001', markPrice: '100' }],
      'tickers': { result: { list: [{ symbol: 'BTCUSDT', fundingRate: '0.0003' }] } },
    });
    const res = await refreshMetric(pool, 'funding-rate-heatmap', { fetchImpl: f });
    expect(res.stored).to.equal(true);
    expect(res.source_rows).to.equal(2);

    const read = await readMetric(pool, 'funding-rate-heatmap', { now: () => Date.now() });
    expect(read.available).to.equal(true);
    expect(read.stale).to.equal(false);
    expect(read.data.symbols[0].symbol).to.equal('BTCUSDT');
  });

  it('empty upstream does NOT clobber a prior good snapshot', async () => {
    const pool = memPool();
    const good = stubFetch({ premiumIndex: [{ symbol: 'BTCUSDT', lastFundingRate: '0.0001', markPrice: '100' }], tickers: { result: { list: [] } } });
    await refreshMetric(pool, 'funding-rate-heatmap', { fetchImpl: good });
    const before = pool._rows.length;

    const empty = stubFetch({ premiumIndex: 'FAIL', tickers: 'FAIL' });
    const res = await refreshMetric(pool, 'funding-rate-heatmap', { fetchImpl: empty });
    expect(res.stored).to.equal(false);
    expect(res.reason).to.equal('no_upstream_data');
    expect(pool._rows.length).to.equal(before); // unchanged
  });

  it('readMetric on a metric with no snapshot → available:false (no fabrication)', async () => {
    const read = await readMetric(memPool(), 'market-microstructure', {});
    expect(read.available).to.equal(false);
  });

  it('flags a snapshot older than the freshness window as stale', async () => {
    const pool = memPool();
    await refreshMetric(pool, 'funding-rate-heatmap', {
      fetchImpl: stubFetch({ premiumIndex: [{ symbol: 'BTCUSDT', lastFundingRate: '0.0001', markPrice: '100' }], tickers: { result: { list: [] } } }),
    });
    // Read as if it's 10 minutes in the future (> 300s default window).
    const read = await readMetric(pool, 'funding-rate-heatmap', { now: () => Date.now() + 600_000 });
    expect(read.stale).to.equal(true);
  });

  it('open-interest-shifts uses the prior snapshot as its baseline', async () => {
    const pool = memPool();
    const mk = (oiContracts) =>
      stubFetch({
        'openInterest?symbol': { openInterest: String(oiContracts) },
        'premiumIndex': [{ symbol: 'BTCUSDT', markPrice: '100', lastFundingRate: '0.0001' }],
      });
    // First refresh: 10 contracts * $100 = $1000 OI, no baseline.
    await refreshMetric(pool, 'open-interest-shifts', { fetchImpl: mk(10) });
    let read = await readMetric(pool, 'open-interest-shifts', {});
    expect(read.data.symbols[0].change_usd).to.equal(null);
    // Second refresh: 12 contracts = $1200, baseline = $1000 → +$200.
    await refreshMetric(pool, 'open-interest-shifts', { fetchImpl: mk(12) });
    read = await readMetric(pool, 'open-interest-shifts', {});
    expect(read.data.symbols[0].open_interest_usd).to.equal(1200);
    expect(read.data.symbols[0].change_usd).to.equal(200);
  });
});

// US-region hosting: Binance futures answers 451 and Bybit 403 to US IPs, which
// left production with 0/4 metrics. The other venues must carry every metric.
describe('intelligence: US geo-block fallback (Binance 451 / Bybit 403)', () => {
  const hlCtx = [{ universe: [{ name: 'BTC' }, { name: 'ETH' }] },
    [{ funding: '0.0000125', openInterest: '100', markPx: '50000' }, { funding: '0.00001', openInterest: '1000', markPx: '3000' }]];
  const hlBook = { levels: [[{ px: '49999', sz: '2', n: 3 }], [{ px: '50001', sz: '1', n: 2 }]] };
  function usFetch({ okx = true, deribit = true } = {}) {
    return async (url, init = {}) => {
      if (url.includes('fapi.binance.com')) return { ok: false, status: 451, json: async () => ({}) };
      if (url.includes('api.bybit.com')) return { ok: false, status: 403, json: async () => ({}) };
      if (url.includes('api.hyperliquid.xyz/info')) {
        const body = JSON.parse(init.body || '{}');
        return { ok: true, status: 200, json: async () => (body.type === 'l2Book' ? hlBook : hlCtx) };
      }
      if (okx && url.includes('okx.com/api/v5/public/funding-rate')) return { ok: true, status: 200, json: async () => ({ data: [{ fundingRate: '0.0001', fundingTime: '0', nextFundingTime: String(8 * 3600e3) }] }) };
      if (okx && url.includes('okx.com/api/v5/public/open-interest')) return { ok: true, status: 200, json: async () => ({ data: [{ oiUsd: '5000000' }] }) };
      if (deribit && url.includes('deribit.com')) return { ok: true, status: 200, json: async () => ({ result: { funding_8h: 0.00002 } }) };
      return { ok: false, status: 403, json: async () => ({}) };
    };
  }
  const prevSyms = process.env.INTEL_SYMBOLS;
  before(() => { process.env.INTEL_SYMBOLS = 'BTCUSDT,ETHUSDT'; });
  after(() => { if (prevSyms === undefined) delete process.env.INTEL_SYMBOLS; else process.env.INTEL_SYMBOLS = prevSyms; });

  it('all four metrics are stored from OKX / Deribit / Hyperliquid, with per-venue status', async () => {
    const pool = memPool();
    for (const m of ['funding-rate-heatmap', 'open-interest-shifts', 'liquidation-clusters', 'market-microstructure']) {
      const r = await refreshMetric(pool, m, { fetchImpl: usFetch() });
      expect(r.stored, m).to.equal(true);
      expect(r.sources.find((v) => v.source === 'binance').status).to.equal(451);
    }
    const f = (await readMetric(pool, 'funding-rate-heatmap', {})).data;
    expect(f.sources).to.have.members(['okx', 'deribit', 'hyperliquid']);
    const btc = f.symbols.find((s) => s.symbol === 'BTCUSDT');
    // Hyperliquid funding is hourly: 0.0000125 × 8760 h = 0.1095 APR.
    expect(btc.per_exchange.find((e) => e.exchange === 'hyperliquid').funding_apr).to.be.closeTo(0.1095, 1e-9);
    expect((await readMetric(pool, 'open-interest-shifts', {})).data.sources).to.deep.equal(['okx']);
    const book = (await readMetric(pool, 'market-microstructure', {})).data.symbols.find((s) => s.symbol === 'BTCUSDT');
    expect(book.exchange).to.equal('hyperliquid');
    expect(book.spread).to.equal(2);
  });

  it('open-interest venue switch (OKX → Hyperliquid) never reads as an OI change', async () => {
    const pool = memPool();
    await refreshMetric(pool, 'open-interest-shifts', { fetchImpl: usFetch() }); // OKX
    await refreshMetric(pool, 'open-interest-shifts', { fetchImpl: usFetch({ okx: false }) }); // Hyperliquid
    const d = (await readMetric(pool, 'open-interest-shifts', {})).data;
    expect(d.sources).to.deep.equal(['hyperliquid']);
    expect(d.has_baseline).to.equal(false);
    expect(d.symbols.every((s) => s.change_usd === null)).to.equal(true);
    // Same venue again → a real baseline.
    await refreshMetric(pool, 'open-interest-shifts', { fetchImpl: usFetch({ okx: false }) });
    expect((await readMetric(pool, 'open-interest-shifts', {})).data.has_baseline).to.equal(true);
  });

  it('every venue down → nothing stored, the last good snapshot is kept', async () => {
    const pool = memPool();
    await refreshMetric(pool, 'liquidation-clusters', { fetchImpl: usFetch() });
    const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const r = await refreshMetric(pool, 'liquidation-clusters', { fetchImpl: down });
    expect(r.stored).to.equal(false);
    expect((await readMetric(pool, 'liquidation-clusters', {})).available).to.equal(true);
  });
});
