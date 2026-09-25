// fix/ti-charge-after-success — Trading Intelligence charges only when it
// actually returns data. Never data without payment, never payment without data.
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { createIntelligenceRouter } from '../src/routes/intelligence_route.js';

const KEY = 'sk_basic_' + 'ab'.repeat(24);
const NOW = 1_700_000_000_000;
const SNAP = { payload: { metric: 'funding-rate-heatmap', symbols: [{ symbol: 'BTCUSDT' }] }, source_rows: 2, captured_at: new Date(NOW - 1000) };

function pool({ credits = 1, snapshot = SNAP, snapshotQuery } = {}) {
  const st = { credits, deductions: 0, usage: 0, revenue: 0 };
  return {
    st,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('FROM api_credits WHERE api_key')) return { rows: [{ api_key: KEY, tier: 'basic', daily_limit: 100000, credits_usdt: st.credits, status: 'active' }] };
      if (s.includes('FROM api_usage_daily WHERE api_key')) return { rows: [{ request_count: 0 }] };
      if (s.startsWith('UPDATE api_credits SET credits_usdt = credits_usdt -')) {
        await new Promise((r) => setImmediate(r)); // let concurrent requests interleave
        const cost = Number(params[0]);
        if (Math.round(st.credits * 1e6) >= Math.round(cost * 1e6)) { st.credits = +(st.credits - cost).toFixed(6); st.deductions++; return { rowCount: 1, rows: [{ credits_usdt: st.credits }] }; }
        return { rowCount: 0, rows: [] };
      }
      if (s.startsWith('INSERT INTO api_usage_daily')) { st.usage++; return { rowCount: 1, rows: [] }; }
      if (s.startsWith('INSERT INTO revenue_events_v2')) { st.revenue++; return { rowCount: 1, rows: [] }; }
      if (s.includes('FROM intelligence_snapshots')) return snapshotQuery ? snapshotQuery() : { rows: snapshot ? [snapshot] : [] };
      return { rows: [] };
    },
  };
}
const app = (p, deps = {}) => { const a = express(); a.use('/v1', createIntelligenceRouter(p, { now: () => NOW, ...deps })); return a; };
const get = (a) => request(a).get('/v1/intelligence/funding-rate-heatmap').set('x-api-key', KEY);
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('Trading Intelligence charges only after it has data (charge-after-success)', () => {
  it('warming up (no snapshot) → 503, nothing charged or metered', async () => {
    const p = pool({ snapshot: null });
    const res = await get(app(p));
    expect(res.status).to.equal(503);
    expect(res.body).to.include({ error: 'warming_up', charged: false });
    await settle();
    expect(p.st).to.deep.include({ credits: 1, deductions: 0, usage: 0, revenue: 0 });
  });

  it('read failure → 503, nothing charged', async () => {
    const p = pool({ snapshotQuery: () => { throw new Error('db down'); } });
    const res = await get(app(p));
    expect(res.status).to.equal(503);
    expect(res.body.charged).to.equal(false);
    expect(p.st.deductions).to.equal(0);
  });

  it('timeout → 503 read_timeout, nothing charged (and a late read changes nothing)', async () => {
    const p = pool({ snapshotQuery: () => new Promise((r) => setTimeout(() => r({ rows: [SNAP] }), 200)) });
    const res = await get(app(p, { readTimeoutMs: 30 }));
    expect(res.status).to.equal(503);
    expect(res.body.message).to.equal('read_timeout');
    await new Promise((r) => setTimeout(r, 250));
    expect(p.st.deductions).to.equal(0);
  });

  it('partial failure: unserialisable snapshot → 503, nothing charged', async () => {
    const p = pool({ snapshot: { ...SNAP, payload: { big: 10n } } });
    const res = await get(app(p));
    expect(res.status).to.equal(503);
    expect(res.body.message).to.equal('bad_snapshot');
    expect(p.st.deductions).to.equal(0);
  });

  it('success → charged exactly once, one revenue row, data returned', async () => {
    const p = pool();
    const res = await get(app(p));
    expect(res.status).to.equal(200);
    expect(res.body.billed_usdt).to.equal(0.01);
    expect(res.body.data.symbols[0].symbol).to.equal('BTCUSDT');
    await settle();
    expect(p.st).to.deep.include({ credits: 0.99, deductions: 1, usage: 1, revenue: 1 });
  });

  it('insufficient credits with data available → 402 and NO data returned', async () => {
    const p = pool({ credits: 0.005 });
    const res = await get(app(p));
    expect(res.status).to.equal(402);
    expect(res.body.data).to.equal(undefined);
    expect(p.st.deductions).to.equal(0);
  });

  it('10 concurrent calls with credit for 5 → exactly 5 served and charged, 5 refused uncharged', async () => {
    const p = pool({ credits: 0.05 });
    const a = app(p);
    const res = await Promise.all(Array.from({ length: 10 }, () => get(a)));
    expect(res.filter((r) => r.status === 200).length).to.equal(5);
    expect(res.filter((r) => r.status === 402).length).to.equal(5);
    expect(res.filter((r) => r.status === 402).every((r) => r.body.data === undefined)).to.equal(true);
    await settle();
    expect(p.st).to.deep.include({ credits: 0, deductions: 5, revenue: 5 });
  });
});
