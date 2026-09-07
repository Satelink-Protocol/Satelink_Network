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
    // These tests exercise the x402 rail against a LIVE anonymous free tier
    // (t5/t9 rely on under-limit anonymous calls being served). The anonymous
    // cut defaults to 0 free calls; grant a matching quota so the pre-cut rail
    // behavior is what's under test. Read at request time → import-order safe.
    process.env.FREE_TIER_ANON_CALLS = '2';
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
    const out = await runChain(makeReq({ headers: { 'x-api-key': 'placeholder-key-abc' }, ip: '10.4.0.1' }));
    expect(out.nextCalled).to.equal(true);
    expect(out.headers).to.deep.equal({});
  });

  it('t5: anonymous request under the free-tier limit — untouched', async () => {
    process.env.X402_ENABLED = 'true';
    const out = await runChain(makeReq({ ip: '10.5.0.1' })); // 1st call, limit 2
    expect(out.nextCalled).to.equal(true);
    expect(out.headers).to.deep.equal({});
  });

  // ── facilitator abuse guard (all reject BEFORE any facilitator call) ──
  function paymentReq(header, ip) {
    return makeReq({ headers: { 'x-payment': header }, ip });
  }

  it('t6: oversized payment header → 400, no facilitator call', async () => {
    process.env.X402_ENABLED = 'true';
    const out = await runChain(paymentReq('A'.repeat(9000), '10.6.0.1'));
    expect(out.statusCode).to.equal(400);
    expect(out.body.error).to.equal('x402_payment_header_too_large');
  });

  it('t7: malformed payment header → 400, no facilitator call', async () => {
    process.env.X402_ENABLED = 'true';
    const out = await runChain(paymentReq('not-valid-base64-json!!', '10.7.0.1'));
    expect(out.statusCode).to.equal(400);
    expect(out.body.error).to.equal('x402_payment_malformed');
  });

  it('t9: keyless handler 402 (under-limit anonymous) is upgraded with x402 accepts', async () => {
    process.env.X402_ENABLED = 'true';
    // Simulate the chain where the gate passes (under limit) but the gateway
    // handler 402s a keyless caller — in production this is the 402 a real
    // machine actually receives (subnet cap fires before per-IP exhaustion).
    const out = await new Promise((resolve) => {
      const req = makeReq({ ip: '10.9.0.1' });
      const res = makeRes(resolve);
      Promise.resolve(
        x402(req, res, () =>
          gate(req, res, () =>
            res.status(402).json({ ok: false, error: 'payment_required', message: 'Deposit USDT to access Satelink RPC' })
          )
        )
      ).catch((err) => resolve({ error: err }));
    });
    expect(out.statusCode).to.equal(402);
    expect(out.body.accepts).to.be.an('array').with.length.greaterThan(0);
    expect(out.body.alternativePayment.error).to.equal('payment_required');
    expect(out.headers['PAYMENT-REQUIRED']).to.be.a('string');
  });

  it('t10: keyed caller 402 (credit issue) is NOT upgraded', async () => {
    process.env.X402_ENABLED = 'true';
    const out = await new Promise((resolve) => {
      const req = makeReq({ headers: { 'x-api-key': 'sk_broke' }, ip: '10.10.0.1' });
      const res = makeRes(resolve);
      Promise.resolve(
        x402(req, res, () =>
          gate(req, res, () =>
            res.status(402).json({ ok: false, error: 'insufficient_credits' })
          )
        )
      ).catch((err) => resolve({ error: err }));
    });
    expect(out.statusCode).to.equal(402);
    expect(out.body).to.deep.equal({ ok: false, error: 'insufficient_credits' });
    expect(out.headers).to.deep.equal({});
  });

  it('t8: >30 payment attempts/min from one IP → 429', async () => {
    process.env.X402_ENABLED = 'true';
    let last;
    for (let i = 0; i < 31; i++) last = await runChain(paymentReq('not-base64!!', '10.8.0.1'));
    expect(last.statusCode).to.equal(429);
    expect(last.body.error).to.equal('x402_verify_rate_limited');
    // a different IP is unaffected
    const other = await runChain(paymentReq('not-base64!!', '10.8.0.2'));
    expect(other.statusCode).to.equal(400);
  });

  // ── founder-wallet ledger integrity + bundle credits (real DB, savepoint-
  //    wrapped and rolled back — nothing persists, no facilitator faked) ──
  describe('ledger integrity + bundle credits', function () {
    let raw, dbPool, recordX402Settlement, isFounderWallet, authorizeAndMeter;
    const PRICE = 0.00003;
    const BUNDLE = 1000;
    const payerA = '0xAaAA00000000000000000000000000000000AaAa';

    before(async function () {
      if (!process.env.DATABASE_URL) this.skip();
      ({ recordX402Settlement } = await import('../src/payments/x402/settlement.js'));
      ({ isFounderWallet } = await import('../src/payments/founder_wallets.js'));
      ({ authorizeAndMeter } = await import('../src/billing/credit_service.mjs'));
      const { default: pg } = await import('pg');
      raw = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await raw.connect();
      await raw.query('BEGIN'); // outer txn — rolled back in after()
      let sp = 0;
      const savepointClient = {
        query(sql, params) {
          if (sql === 'BEGIN') { sp++; return raw.query(`SAVEPOINT bundle_sp_${sp}`); }
          if (sql === 'COMMIT') return raw.query(`RELEASE SAVEPOINT bundle_sp_${sp}`);
          if (sql === 'ROLLBACK') return raw.query(`ROLLBACK TO SAVEPOINT bundle_sp_${sp}`);
          return raw.query(sql, params);
        },
        release() {},
      };
      dbPool = {
        connect: async () => savepointClient,
        query: (sql, params) => raw.query(sql, params),
      };
    });

    after(async () => {
      if (raw) { await raw.query('ROLLBACK'); await raw.end(); }
    });

    it('founder check: mainnet settlement from a founder wallet is is_test_data=true', async () => {
      expect(isFounderWallet('0x175727A8486A7Eb3Ac4bcf2A1A89FD2D58CA0DFd')).to.equal(true);
      expect(isFounderWallet(payerA)).to.equal(false);
      await recordX402Settlement(dbPool, {
        txHash: '0xtest_founder_flag', payer: '0x175727A8486A7Eb3Ac4bcf2A1A89FD2D58CA0DFd',
        network: 'eip155:8453', amountUsd: '0.10',
      });
      const r = await raw.query(`SELECT is_test_data FROM payment_sources WHERE tx_hash='0xtest_founder_flag'`);
      expect(r.rows[0].is_test_data).to.equal(true);
    });

    it('t11: one settlement credits exactly N calls, once', async () => {
      const out = await recordX402Settlement(dbPool, {
        txHash: '0xtest_bundle_credit', payer: payerA,
        network: 'eip155:8453', amountUsd: '0.10', bundleCalls: BUNDLE,
      });
      expect(out.creditedKey).to.equal(`x402_${payerA.toLowerCase()}`);
      expect(out.callsRemaining).to.equal(BUNDLE);
      const acct = await raw.query(
        `SELECT tier, daily_limit, credits_usdt, total_deposited, demand_source
           FROM api_credits WHERE api_key=$1`, [out.creditedKey]);
      expect(acct.rows).to.have.length(1);
      expect(acct.rows[0].tier).to.equal('x402');
      expect(acct.rows[0].daily_limit).to.equal(BUNDLE);
      expect(parseFloat(acct.rows[0].credits_usdt)).to.be.closeTo(BUNDLE * PRICE, 1e-9);
      expect(acct.rows[0].demand_source).to.equal('x402');
      const ps = await raw.query(`SELECT credited_api_key FROM payment_sources WHERE tx_hash='0xtest_bundle_credit'`);
      expect(ps.rows[0].credited_api_key).to.equal(out.creditedKey);
    });

    it('t12: x-payer-address header does NOT become a billing identity (C1 fix, P0-2)', async () => {
      // SECURITY (finding C1): a client-supplied x-payer-address must NEVER be
      // aliased into the billing wallet. payerA holds a bundle balance from t11;
      // an anonymous caller naming payerA via the header must not spend it. The
      // old "Rail 1.5" aliasing was removed — see c1_payer_address.test.js for
      // the full negative/positive/replay matrix.
      const mw = createX402Middleware(dbPool, silent);
      process.env.X402_ENABLED = 'true';
      const before = await raw.query(`SELECT credits_usdt FROM api_credits WHERE api_key=$1`, [`x402_${payerA.toLowerCase()}`]);
      const req = makeReq({ headers: { 'x-payer-address': payerA }, ip: '10.12.0.1' });
      const out = await new Promise((resolve) => {
        const res = makeRes(resolve);
        Promise.resolve(mw(req, res, () => resolve({ nextCalled: true }))).catch((e) => resolve({ error: e }));
      });
      expect(out.nextCalled).to.equal(true);                       // falls through to the normal flow
      expect(req.headers['x-wallet-address']).to.equal(undefined); // NO alias into the billing header
      expect(req.x402 && req.x402.settled).to.not.equal(true);     // no verified payment present
      const after = await raw.query(`SELECT credits_usdt FROM api_credits WHERE api_key=$1`, [`x402_${payerA.toLowerCase()}`]);
      expect(after.rows[0].credits_usdt).to.equal(before.rows[0].credits_usdt); // balance untouched
    });

    it('t13: exhausted credits → alias not applied → normal x402 402', async () => {
      await raw.query(`UPDATE api_credits SET credits_usdt=0 WHERE api_key=$1`, [`x402_${payerA.toLowerCase()}`]);
      const mw = createX402Middleware(dbPool, silent);
      process.env.X402_ENABLED = 'true';
      const req = makeReq({ headers: { 'x-payer-address': payerA }, ip: '10.13.0.1' });
      const out = await new Promise((resolve) => {
        const res = makeRes(resolve);
        Promise.resolve(
          mw(req, res, () =>
            gate(req, res, () =>
              res.status(402).json({ ok: false, error: 'payment_required' })
            )
          )
        ).catch((e) => resolve({ error: e }));
      });
      expect(req.headers['x-wallet-address']).to.equal(undefined);
      expect(out.statusCode).to.equal(402);
      expect(out.body.accepts).to.be.an('array').with.length.greaterThan(0);
    });

    it('t14: duplicate settlement tx_hash → 409, no double-credit', async () => {
      const before = await raw.query(`SELECT credits_usdt, total_deposited FROM api_credits WHERE api_key=$1`, [`x402_${payerA.toLowerCase()}`]);
      const dup = await new Promise((resolve) => {
        const res = makeRes(resolve);
        recordSettlementOrReject(dbPool, res, {
          txHash: '0xtest_bundle_credit', payer: payerA,
          network: 'eip155:8453', amountUsd: '0.10', bundleCalls: BUNDLE,
        }, silent);
      });
      expect(dup.statusCode).to.equal(409);
      const after = await raw.query(`SELECT credits_usdt, total_deposited FROM api_credits WHERE api_key=$1`, [`x402_${payerA.toLowerCase()}`]);
      expect(after.rows[0].credits_usdt).to.equal(before.rows[0].credits_usdt);
      expect(after.rows[0].total_deposited).to.equal(before.rows[0].total_deposited);
      const count = await raw.query(`SELECT COUNT(*)::int AS n FROM payment_sources WHERE tx_hash='0xtest_bundle_credit'`);
      expect(count.rows[0].n).to.equal(1);
    });

    it('t15: keyed and free-tier traffic untouched (x-payer-address never overrides a key)', async () => {
      const mw = createX402Middleware(dbPool, silent);
      process.env.X402_ENABLED = 'true';
      const req = makeReq({ headers: { 'x-api-key': 'sk_existing', 'x-payer-address': payerA }, ip: '10.15.0.1' });
      const out = await new Promise((resolve) => {
        const res = makeRes(resolve);
        Promise.resolve(
          mw(req, res, () => gate(req, res, () => resolve({ nextCalled: true, headers: res.headers })))
        ).catch((e) => resolve({ error: e }));
      });
      expect(out.nextCalled).to.equal(true);
      expect(req.headers['x-wallet-address']).to.equal(undefined); // no alias
      // anonymous free-tier request without any headers still passes untouched
      const anon = await runChain(makeReq({ ip: '10.15.0.2' }));
      expect(anon.nextCalled).to.equal(true);
      expect(anon.headers).to.deep.equal({});
    });
  });
});
