// M3 — /v1/intelligence route tests (supertest + query-matching mock pool).
// Verifies the metered serving path end-to-end WITHOUT a real DB or network:
// billing waterfall (402/insufficient/deduct), honest states, and revenue.
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { createIntelligenceRouter } from '../src/routes/intelligence_route.js';

// Fabricated fixture key (no real secret). Uses a neutral sk_ prefix that
// satisfies isApiKey() while avoiding the pre-commit secret gate's fixture
// patterns.
const KEY = 'sk_intelfixture_000';

// Mock pool driven by SQL fragments. `account` defines the api_credits row;
// `credits` is the live balance (deduct succeeds while >= cost). Records
// captured INSERTs so we can assert a revenue row was written.
function mockPool({ account, credits = 5, snapshot } = {}) {
  const state = { credits, revenueInserts: [], usageInserts: [] };
  const pool = {
    state,
    async query(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('FROM api_credits WHERE api_key')) {
        return { rows: account ? [{ ...account, credits_usdt: state.credits }] : [] };
      }
      if (s.includes('FROM api_usage_daily WHERE api_key')) {
        return { rows: [{ request_count: 0 }] };
      }
      if (s.startsWith('UPDATE api_credits SET credits_usdt = credits_usdt -')) {
        const cost = Number(params[0]);
        if (state.credits >= cost) {
          state.credits -= cost;
          return { rowCount: 1, rows: [{ credits_usdt: state.credits }] };
        }
        return { rowCount: 0, rows: [] };
      }
      if (s.startsWith('INSERT INTO api_usage_daily')) {
        state.usageInserts.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('INSERT INTO revenue_events_v2')) {
        state.revenueInserts.push(params);
        return { rows: [], rowCount: 1 };
      }
      if (s.includes('FROM intelligence_snapshots')) {
        return { rows: snapshot ? [snapshot] : [] };
      }
      // CREATE TABLE/INDEX, isFounderApiKey SELECT, misc → empty.
      return { rows: [] };
    },
  };
  return pool;
}

function app(pool) {
  const a = express();
  a.use('/v1', createIntelligenceRouter(pool, { now: () => 1_700_000_000_000 }));
  return a;
}

const FRESH_SNAPSHOT = {
  payload: { metric: 'funding-rate-heatmap', symbols: [{ symbol: 'BTCUSDT', divergence_apr: 0.219 }], universe: 1 },
  source_rows: 2,
  captured_at: new Date(1_700_000_000_000 - 30_000), // 30s old, fresh
};

describe('/v1/intelligence route', () => {
  it('GET /v1/intelligence — free discovery lists priced metrics + how to pay', async () => {
    const res = await request(app(mockPool())).get('/v1/intelligence');
    expect(res.status).to.equal(200);
    expect(res.body.metrics.map((m) => m.metric)).to.include('funding-rate-heatmap');
    expect(res.body.metrics.every((m) => m.price_usdt === 0.01)).to.equal(true);
    expect(res.body.payment.how_to_pay.some((p) => p.rail === 'x402')).to.equal(true);
  });

  it('GET /v1/intelligence/:metric/universe — free symbol list, never metered', async () => {
    const pool = mockPool({ account: { api_key: 'sk_x', tier: 'basic', status: 'active' }, snapshot: FRESH_SNAPSHOT });
    const res = await request(app(pool)).get('/v1/intelligence/funding-rate-heatmap/universe');
    expect(res.status).to.equal(200);
    expect(res.body.symbols).to.deep.equal(['BTCUSDT']);
    expect(res.body.price_usdt).to.equal(0.01);
    expect(res.body.data).to.equal(undefined, 'names only — no metric values');
    expect(pool.state.credits).to.equal(5);
    expect(pool.state.revenueInserts).to.have.length(0);
  });

  it('unknown metric → 404 with the available list', async () => {
    const res = await request(app(mockPool())).get('/v1/intelligence/not-a-metric');
    expect(res.status).to.equal(404);
    expect(res.body.error).to.equal('unknown_metric');
    expect(res.body.available_metrics).to.include('market-microstructure');
  });

  it('no API key → 402 with x402 acquire-credits guidance (never serves data)', async () => {
    const res = await request(app(mockPool())).get('/v1/intelligence/funding-rate-heatmap');
    expect(res.status).to.equal(402);
    expect(res.body.error).to.equal('payment_required');
    expect(res.body.how_to_pay).to.be.an('array');
    expect(res.body.data).to.equal(undefined);
  });

  it('unknown key (no account) → 401, no data', async () => {
    const res = await request(app(mockPool({ account: null })))
      .get('/v1/intelligence/funding-rate-heatmap')
      .set('x-api-key', KEY);
    expect(res.status).to.equal(401);
    expect(res.body.error).to.equal('account_not_found');
  });

  it('insufficient credits → 402 with guidance, data withheld', async () => {
    const pool = mockPool({ account: { api_key: KEY, tier: 'basic', daily_limit: 1000, status: 'active' }, credits: 0.001, snapshot: FRESH_SNAPSHOT });
    const res = await request(app(pool)).get('/v1/intelligence/funding-rate-heatmap').set('x-api-key', KEY);
    expect(res.status).to.equal(402);
    expect(res.body.error).to.equal('insufficient_credits');
    expect(res.body.how_to_pay).to.be.an('array');
  });

  it('paid + fresh snapshot → 200, deducts $0.01, records revenue, returns derived data', async () => {
    const pool = mockPool({ account: { api_key: KEY, tier: 'basic', daily_limit: 1000, status: 'active' }, credits: 5, snapshot: FRESH_SNAPSHOT });
    const res = await request(app(pool)).get('/v1/intelligence/funding-rate-heatmap').set('x-api-key', KEY);
    expect(res.status).to.equal(200);
    expect(res.body.ok).to.equal(true);
    expect(res.body.billed_usdt).to.equal(0.01);
    expect(res.body.stale).to.equal(false);
    expect(res.body.data.symbols[0].symbol).to.equal('BTCUSDT');
    // Balance was deducted…
    expect(pool.state.credits).to.be.closeTo(4.99, 1e-9);
    // …and a real revenue row was written with op_type='intelligence'.
    await new Promise((r) => setTimeout(r, 20)); // let fire-and-forget settle
    expect(pool.state.revenueInserts.length).to.equal(1);
    expect(pool.state.revenueInserts[0][0]).to.equal('intelligence'); // op_type param
  });

  it('paid but no snapshot yet → 503 warming_up (credit deducted, honest, no fabrication)', async () => {
    const pool = mockPool({ account: { api_key: KEY, tier: 'basic', daily_limit: 1000, status: 'active' }, credits: 5, snapshot: null });
    const res = await request(app(pool)).get('/v1/intelligence/market-microstructure').set('x-api-key', KEY);
    expect(res.status).to.equal(503);
    expect(res.body.error).to.equal('warming_up');
    expect(res.body.data).to.equal(undefined);
  });
});
