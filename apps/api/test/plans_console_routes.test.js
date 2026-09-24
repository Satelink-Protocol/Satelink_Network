import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { createPlansRouter } from '../src/routes/plans.js';
import { createConsoleRouter } from '../src/routes/console.js';

function makePool(handlers = {}) {
  return {
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      for (const [needle, fn] of Object.entries(handlers)) {
        if (s.includes(needle)) return fn(params, s);
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

describe('GET /v1/plans', () => {
  const app = express();
  app.use('/v1', createPlansRouter(makePool({
    'FROM plans WHERE active': () => ({ rows: [
      { id: 'free', name: 'Free', price_monthly_usd: '0', price_yearly_usd: '0', included_calls: '300', overage_per_call_usd: null, api_keys: '1', rate_limit: 'low' },
    ] }),
    'FROM plans WHERE id': (p) => ({ rows: p[0] === 'pro' ? [{ id: 'pro', name: 'Pro' }] : [] }),
  })));

  it('returns the catalogue', async () => {
    const res = await request(app).get('/v1/plans');
    expect(res.status).to.equal(200);
    expect(res.body.ok).to.equal(true);
    expect(res.body.plans[0].id).to.equal('free');
  });

  it('returns 404 for an unknown plan id', async () => {
    const res = await request(app).get('/v1/plans/nope');
    expect(res.status).to.equal(404);
  });
});

describe('GET /v1/console/summary', () => {
  function buildApp(pool) {
    const app = express();
    app.use('/v1', createConsoleRouter(pool));
    return app;
  }
  const account = { api_key: 'sk_dodo_abc123', credits_usdt: 12.5, tier: 'free' };
  const pool = makePool({
    'FROM api_credits WHERE api_key': (p) => ({ rows: p[0] === account.api_key ? [account] : [] }),
    'FROM plan_entitlements WHERE api_key': () => ({ rows: [{
      api_key: account.api_key, plan_id: 'free', source: 'free', included_calls_total: 300, included_calls_used: 12, period_start: null, period_end: null,
    }] }),
    'FROM subscriptions': () => ({ rows: [] }),
    'FROM api_usage_daily': () => ({ rows: [{ n: '5' }] }),
  });

  it('401s without an api key', async () => {
    const res = await request(buildApp(pool)).get('/v1/console/summary');
    expect(res.status).to.equal(401);
    expect(res.body.error).to.equal('api_key_required');
  });

  it('401s for an unknown api key', async () => {
    const res = await request(buildApp(pool)).get('/v1/console/summary').set('Authorization', 'Bearer sk_wrong');
    expect(res.status).to.equal(401);
    expect(res.body.error).to.equal('invalid_api_key');
  });

  it('returns a masked summary with balance, entitlement, and usage', async () => {
    const res = await request(buildApp(pool)).get('/v1/console/summary').set('Authorization', `Bearer ${account.api_key}`);
    expect(res.status).to.equal(200);
    expect(res.body.data.balanceUsd).to.equal(12.5);
    expect(res.body.data.apiKey).to.equal('sk_dodo…');
    expect(res.body.data.entitlement.remaining).to.equal(288);
    expect(res.body.data.usage).to.deep.equal({ callsToday: 5, callsThisMonth: 5 });
    expect(res.body.data.plan).to.equal('free');
  });

  it('degrades usage to null when the table is unavailable (never errors)', async () => {
    const degraded = makePool({
      'FROM api_credits WHERE api_key': () => ({ rows: [account] }),
      'FROM plan_entitlements WHERE api_key': () => ({ rows: [] }),
      'FROM subscriptions': () => ({ rows: [] }),
      'FROM api_usage_daily': () => { throw new Error('relation does not exist'); },
    });
    const res = await request(buildApp(degraded)).get('/v1/console/summary').set('X-Api-Key', account.api_key);
    expect(res.status).to.equal(200);
    expect(res.body.data.usage).to.equal(null);
    expect(res.body.data.entitlement).to.equal(null);
  });
});
