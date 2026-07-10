// Anonymous free taste — war room 2026-07-10 action 1.
//
// t1  anonymous request passes the gateway's 402 guard (proven by reaching
//     the chain validator: unsupported chain → 400, NOT 402)
// t2  ANON_FREE_TIER_ENABLED=false restores the hard 402, with the legible
//     how_to_pay body (kill switch works without a deploy)
// t3  unknown API key → 402 whose body carries the canonical deposit block
//     (real $0.50 minimum, register block, how_to_pay) — not the stale
//     static body ($1 minimum, dead deposit URL) it replaces
//
// The free-tier WALL itself (per-IP daily limit → 402) lives in
// free_tier_gate.js, mounted before this router — covered by
// free_tier_gate.test.js and x402_rail.test.js t1/t2. These tests cover the
// gateway's own guard only.

import { expect } from 'chai';
import express from 'express';
import request from 'supertest';

describe('anonymous free taste (rpc_gateway 402 guard)', function () {
  this.timeout(20000);

  let app;
  const mockDb = { query: async () => ({ rows: [] }) };

  before(async () => {
    process.env.CREDIT_CANONICAL = 'true';
    delete process.env.ANON_FREE_TIER_ENABLED;
    const { createRpcGateway } = await import('../src/workloads/rpc_gateway/rpc_gateway.js');
    app = express();
    app.use('/rpc', express.json(), createRpcGateway(mockDb));
  });

  after(() => {
    delete process.env.ANON_FREE_TIER_ENABLED;
    delete process.env.CREDIT_CANONICAL;
  });

  const anonCall = (chain, body) =>
    request(app).post(`/rpc/${chain}`).set('Content-Type', 'application/json').send(body);

  it('t1: anonymous request is admitted past the 402 guard (default on)', async () => {
    // An unsupported chain proves the request got PAST the guard to the
    // chain validator — under the old unconditional 402 this returned 402.
    const res = await anonCall('notachain', { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });
    expect(res.status).to.equal(400);
    expect(res.body.error).to.include('Unsupported chain');
  });

  it('t2: ANON_FREE_TIER_ENABLED=false restores the hard 402 with a legible body', async () => {
    process.env.ANON_FREE_TIER_ENABLED = 'false';
    try {
      const res = await anonCall('notachain', { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });
      expect(res.status).to.equal(402);
      expect(res.body.error).to.equal('payment_required');
      expect(res.body.how_to_pay).to.be.an('array').with.length.greaterThan(1);
      expect(res.body.deposit.minimum_usdt).to.equal('0.50');
      expect(res.body.register.url).to.include('/v1/machine/register');
    } finally {
      delete process.env.ANON_FREE_TIER_ENABLED;
    }
  });

  it('t3: unknown API key → 402 with canonical deposit block, not the stale static body', async () => {
    const res = await request(app)
      .post('/rpc/polygon')
      .set('X-API-Key', 'sk_definitely_not_a_real_key')
      .set('Content-Type', 'application/json')
      .send({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });
    expect(res.status).to.equal(402);
    expect(res.body.how_to_pay).to.be.an('array');
    expect(res.body.deposit.minimum_usdt).to.equal('0.50'); // was hardcoded '1'
    expect(res.body.pricing_url).to.include('/v1/pricing');
    expect(JSON.stringify(res.body)).to.not.include('developer.satelink.network'); // dead URL purged
  });
});
