// x402 v2 parallel payment rail — regression + behavior tests.
//
// t1  flag OFF  → exhausted-tier 402 is byte-identical to today's custom 402
// t2  flag ON   → 402 body carries BOTH x402 accepts AND alternativePayment (USDT)
// t3  duplicate settlement tx_hash → 409, exactly one payment_sources row
//     (real Postgres UNIQUE constraint, run inside a rolled-back transaction —
//      no facilitator faked, no test rows persisted)
// t4  keyed request (X-API-Key) → completely unaffected, no x402 headers, no 402
// t5  anonymous request under the free-tier limit → unaffected
//
// t2 talks to the real CDP facilitator's unauthenticated list/supported
// endpoint during resource-server sync (network required, no credentials).

import 'dotenv/config';
import { expect } from 'chai';

describe('x402 payment rail', function () {
  this.timeout(30000);

  let createFreeTierGate;
  let createX402Middleware;
  let recordSettlementOrReject;
  let gate;
  let x402;
  const silent = { info() {}, warn() {}, error() {} };

  before(async () => {
    // Low limit so the gate trips on the 3rd anonymous call. Must be set
    // BEFORE import: free_tier_gate.js reads it at module load.
    process.env.FREE_TIER_DAILY_LIMIT = '2';
    ({ createFreeTierGate } = await import('../src/middleware/free_tier_gate.js'));
    ({ createX402Middleware, recordSettlementOrReject } = await import('../src/payments/x402/middleware.js'));
    gate = createFreeTierGate(silent, null); // no redis → in-memory counters
    x402 = createX402Middleware(null, silent); // pool unused outside settle path
  });

  function makeReq({ headers = {}, ip = '10.0.0.1' } = {}) {
    return {
      headers,
      header(name) {
        const v = this.headers[name.toLowerCase()];
        return Array.isArray(v) ? v[0] : v;
      },
      method: 'POST',
      originalUrl: '/rpc',
      url: '/rpc',
      path: '/rpc',
      query: {},
      protocol: 'https',
      body: { id: 1 },
      socket: { remoteAddress: ip },
    };
  }

  function makeRes(resolve) {
    return {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      getHeaders() { return this.headers; },
      set() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ nextCalled: false, statusCode: this.statusCode, body: b, headers: this.headers }); return this; },
      send(b) { resolve({ nextCalled: false, statusCode: this.statusCode, body: b, headers: this.headers }); return this; },
    };
  }

  // Full chain as mounted in app_factory: x402 middleware, then the gate.
  function runChain(req) {
    return new Promise((resolve) => {
      const res = makeRes(resolve);
      Promise.resolve(
        x402(req, res, () =>
          gate(req, res, () => resolve({ nextCalled: true, statusCode: null, body: null, headers: res.headers }))
        )
      ).catch((err) => resolve({ error: err }));
    });
  }

  // The gate alone — today's production behavior, the byte-identical baseline.
  function runGateOnly(req) {
    return new Promise((resolve) => {
      const res = makeRes(resolve);
      Promise.resolve(
        gate(req, res, () => resolve({ nextCalled: true, statusCode: null, body: null, headers: res.headers }))
      ).catch((err) => resolve({ error: err }));
    });
  }

  // free_tier_gate.js reads FREE_TIER_DAILY_LIMIT at module load, and in a
  // full-suite run another file may have imported it first with the default
  // limit — so exhaust by looping until the 402 appears instead of assuming
  // the limit is 2. In-memory counters make 500 iterations trivial.
  async function exhaust(runner, ip) {
    for (let i = 0; i < 5100; i++) {
      const out = await runner(makeReq({ ip }));
      if (!out.nextCalled) return out;
    }
    throw new Error('gate never tripped within 5100 calls');
  }

  it('t1: flag OFF — exhausted-tier 402 is byte-identical to the legacy 402', async () => {
    process.env.X402_ENABLED = 'false';
    const viaChain = await exhaust(runChain, '10.1.0.1');
    const baseline = await exhaust(runGateOnly, '10.1.0.2');

    expect(viaChain.statusCode).to.equal(402);
    expect(baseline.statusCode).to.equal(402);
    expect(JSON.stringify(viaChain.body)).to.equal(JSON.stringify(baseline.body));
    expect(viaChain.headers).to.deep.equal(baseline.headers);
  });

  it('t2: flag ON — 402 carries x402 accepts AND alternativePayment USDT instructions', async () => {
    process.env.X402_ENABLED = 'true';
    const out = await exhaust(runChain, '10.2.0.1');

    expect(out.statusCode).to.equal(402);
    // spec-compliant x402 PaymentRequired
    expect(out.body.accepts).to.be.an('array').with.length.greaterThan(0);
    const req0 = out.body.accepts[0];
    expect(req0.scheme).to.equal('exact');
    expect(req0.network).to.equal('eip155:8453');
    expect(req0.payTo.toLowerCase()).to.equal('0x966e1ae22996545015b1414b35234b10719d7ad4');
    expect(out.headers['PAYMENT-REQUIRED'], 'PAYMENT-REQUIRED header').to.be.a('string');
    // legacy USDT vault rail preserved
    const alt = out.body.alternativePayment;
    expect(alt.error.data.error_code).to.equal('FREE_TIER_LIMIT_REACHED');
    expect(alt.deposit.vault_address).to.be.a('string');
    expect(alt.error.data.payment.token).to.equal('USDT');
  });

  it('t3: duplicate settlement tx_hash → 409, exactly one payment_sources row', async function () {
    if (!process.env.DATABASE_URL) this.skip();
    const { default: pg } = await import('pg');
    const raw = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await raw.connect();
    await raw.query('BEGIN'); // outer txn — rolled back below, nothing persists
    const savepointClient = {
      query(sql, params) {
        if (sql === 'BEGIN') return raw.query('SAVEPOINT x402_t3');
        if (sql === 'COMMIT') return raw.query('RELEASE SAVEPOINT x402_t3');
        if (sql === 'ROLLBACK') return raw.query('ROLLBACK TO SAVEPOINT x402_t3');
        return raw.query(sql, params);
      },
      release() {},
    };
    const pool = { connect: async () => savepointClient };
    const params = {
      txHash: '0xx402_test_duplicate_settlement',
      payer: '0x1111111111111111111111111111111111111111',
      network: 'eip155:8453',
      amountUsd: '0.0005',
    };
    try {
      const first = await new Promise((resolve) => {
        const res = makeRes(resolve);
        recordSettlementOrReject(pool, res, params, silent).then((ok) => ok && resolve({ recorded: true }));
      });
      expect(first.recorded).to.equal(true);

      const second = await new Promise((resolve) => {
        const res = makeRes(resolve);
        recordSettlementOrReject(pool, res, params, silent);
      });
      expect(second.statusCode).to.equal(409);
      expect(second.body.error).to.equal('duplicate_settlement');

      const count = await raw.query(
        'SELECT COUNT(*)::int AS n FROM payment_sources WHERE tx_hash = $1',
        [params.txHash]
      );
      expect(count.rows[0].n).to.equal(1);
    } finally {
      await raw.query('ROLLBACK');
      await raw.end();
    }
  });

  it('t4: keyed request with credits — untouched, no x402 headers, no 402', async () => {
    process.env.X402_ENABLED = 'true';
    const out = await runChain(makeReq({ headers: { 'x-api-key': 'sk_test_abc' }, ip: '10.4.0.1' }));
    expect(out.nextCalled).to.equal(true);
    expect(out.headers).to.deep.equal({});
  });

  it('t5: anonymous request under the free-tier limit — untouched', async () => {
    process.env.X402_ENABLED = 'true';
    const out = await runChain(makeReq({ ip: '10.5.0.1' })); // 1st call, limit 2
    expect(out.nextCalled).to.equal(true);
    expect(out.headers).to.deep.equal({});
  });
});
