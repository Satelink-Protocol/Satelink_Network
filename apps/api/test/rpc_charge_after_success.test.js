// fix/rpc-charge-after-success — a paid RPC call is charged ONLY when the
// upstream call succeeded (same rule as Trading Intelligence, #429).
//
// Before the fix the canonical path deducted api_credits in enforceCapacity
// BEFORE proxying, and an upstream failure (provider 5xx, timeout, network
// error) returned 502 with the deduction kept.
//
// Hermetic: the real createRpcGateway router over supertest, a scripted fake
// pool (records every api_credits deduction), and a stubbed global fetch —
// the router's only upstream transport. No DB, no network, no Redis.
import { expect } from 'chai';
import express from 'express';
import request from 'supertest';

const KEY = 'sk_basic_rpccharge_test_000000000000000000000000000000000';
const PRICE = 0.00003;

function fakePool({ credits = 1, dailyUsed = 0, spentConcurrently = false, path = null, known = true } = {}) {
  const state = { credits, deductions: [], usageInserts: 0, revenueInserts: 0 };
  const pool = {
    state,
    async query(sql, params = []) {
      const s = String(sql);
      if (/platform_flags/.test(s)) return { rows: path ? [{ value: path }] : [] }; // default → 'legacy'
      if (/FROM principals/.test(s)) return { rows: [] }; // no authorization principal
      if (/FROM api_credits WHERE api_key = \$1/.test(s)) {
        if (!known) return { rows: [] };
        return { rows: [{ api_key: KEY, wallet_address: null, tier: 'basic', daily_limit: 1000000, credits_usdt: String(state.credits), status: 'active', payment_hold: null }] };
      }
      if (/SELECT request_count FROM api_usage_daily/.test(s)) return { rows: dailyUsed ? [{ request_count: dailyUsed }] : [] };
      if (/UPDATE api_credits\s+SET credits_usdt = credits_usdt - \$1/.test(s)) {
        const [cost] = params;
        // spentConcurrently: another call drained the balance between the
        // preflight read and this conditional UPDATE.
        if (spentConcurrently || state.credits + 1e-12 < cost) return { rowCount: 0, rows: [] };
        state.credits = +(state.credits - cost).toFixed(6);
        state.deductions.push(cost);
        return { rowCount: 1, rows: [{ credits_usdt: String(state.credits) }] };
      }
      if (/INSERT INTO api_usage_daily/.test(s)) { state.usageInserts += 1; return { rowCount: 1, rows: [] }; }
      if (/INSERT INTO revenue_events_v2/.test(s)) { state.revenueInserts += 1; return { rowCount: 1, rows: [] }; }
      return { rowCount: 0, rows: [] }; // node selection, pricing, misc → nothing
    },
  };
  return pool;
}

describe('RPC charge-after-success (fix/rpc-charge-after-success)', function () {
  this.timeout(20000);
  let createRpcGateway, realFetch, prevCanonical, prevRedis;

  before(async () => {
    prevCanonical = process.env.CREDIT_CANONICAL;
    prevRedis = process.env.REDIS_URL;
    process.env.CREDIT_CANONICAL = 'true';
    delete process.env.REDIS_URL; // cache disabled → every call goes upstream
    ({ createRpcGateway } = await import('../src/workloads/rpc_gateway/rpc_gateway.js'));
    realFetch = globalThis.fetch;
  });
  after(() => {
    globalThis.fetch = realFetch;
    if (prevCanonical === undefined) delete process.env.CREDIT_CANONICAL; else process.env.CREDIT_CANONICAL = prevCanonical;
    if (prevRedis !== undefined) process.env.REDIS_URL = prevRedis;
  });
  // The capacity path is cached for 10 s; every case starts from a clean read.
  beforeEach(async () => { (await import('../src/lib/flags.js')).bustCapacityPathCache(); });
  afterEach(async () => { globalThis.fetch = realFetch; (await import('../src/lib/flags.js')).bustCapacityPathCache(); });

  function app(pool) {
    const a = express();
    a.use(express.json());
    a.use('/rpc', createRpcGateway(pool));
    return a;
  }
  const call = (pool) => request(app(pool))
    .post('/rpc/polygon').set('X-API-Key', KEY)
    .send({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 7 });

  const upstreamFailures = {
    'provider 5xx': async () => new Response('bad gateway', { status: 503 }),
    'provider JSON-RPC error': async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, error: { code: -32000, message: 'boom' } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    'network error / timeout': async () => { throw new Error('ECONNRESET'); },
  };

  for (const [name, impl] of Object.entries(upstreamFailures)) {
    it(`does NOT charge when the upstream fails (${name})`, async () => {
      const pool = fakePool({ credits: 1 });
      globalThis.fetch = impl;
      const res = await call(pool);
      expect(res.status, JSON.stringify(res.body)).to.be.at.least(500);
      expect(pool.state.deductions, 'deductions').to.deep.equal([]);
      expect(pool.state.credits).to.equal(1);
      expect(pool.state.revenueInserts).to.equal(0);
    });
  }

  it('charges exactly once when the upstream succeeds, and serves the result', async () => {
    const pool = fakePool({ credits: 1 });
    globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: '0x10' }), { status: 200, headers: { 'content-type': 'application/json' } });
    const res = await call(pool);
    expect(res.status, JSON.stringify(res.body)).to.equal(200);
    expect(pool.state.deductions).to.deep.equal([PRICE]);
    expect(pool.state.usageInserts).to.equal(1);
    expect(res.headers['x-credit-balance']).to.equal(String(+(1 - PRICE).toFixed(6)));
  });

  it('withholds the data when the post-call charge is refused (balance spent concurrently)', async () => {
    const pool = fakePool({ credits: 1, spentConcurrently: true });
    globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 7, result: '0xSECRETDATA' }), { status: 200, headers: { 'content-type': 'application/json' } });
    const res = await call(pool);
    expect(res.status).to.equal(402);
    expect(res.body.error).to.equal('insufficient_credits');
    expect(JSON.stringify(res.body)).to.not.contain('0xSECRETDATA');
    expect(pool.state.deductions).to.deep.equal([]);
    expect(pool.state.revenueInserts).to.equal(0);
  });

  // Production runs capacity_enforcement_path = 'new' (platform_flags). The
  // preflight must still refuse an unfunded / unknown key before any upstream
  // work (regression from #438, which skipped the preflight on 'new').
  for (const [name, opts] of [['unfunded key', { credits: 0 }], ['unknown key', { known: false }]]) {
    it(`'new' capacity path: ${name} with no authorization → 402 before any upstream call`, async () => {
      const pool = fakePool({ ...opts, path: 'new' });
      let upstreamCalls = 0;
      globalThis.fetch = async (_u, init) => { if (String(init?.body || '').includes('"id":7')) upstreamCalls += 1; return new Response('{}', { status: 200 }); };
      const res = await call(pool);
      expect(res.status, JSON.stringify(res.body)).to.equal(402);
      expect(upstreamCalls).to.equal(0);
      expect(pool.state.deductions).to.deep.equal([]);
    });
  }

  it('an unfunded key is refused with 402 BEFORE any upstream call', async () => {
    const pool = fakePool({ credits: 0 });
    let upstreamCalls = 0;
    globalThis.fetch = async () => { upstreamCalls += 1; return new Response('{}', { status: 200 }); };
    const res = await call(pool);
    expect(res.status).to.equal(402);
    expect(res.body.error).to.equal('insufficient_credits');
    expect(upstreamCalls).to.equal(0);
    expect(pool.state.deductions).to.deep.equal([]);
  });

  it('a key over its daily limit gets 429 BEFORE any upstream call', async () => {
    const pool = fakePool({ credits: 1, dailyUsed: 1000000 });
    let upstreamCalls = 0;
    globalThis.fetch = async () => { upstreamCalls += 1; return new Response('{}', { status: 200 }); };
    const res = await call(pool);
    expect(res.status).to.equal(429);
    expect(upstreamCalls).to.equal(0);
  });
});
