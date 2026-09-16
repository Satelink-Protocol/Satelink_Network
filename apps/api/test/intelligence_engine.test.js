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
