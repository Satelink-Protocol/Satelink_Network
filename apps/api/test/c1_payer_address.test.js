// C1 regression — x-payer-address credit theft (finding C1, fixed in P0-2, 2026-09).
//
// The former x402 "Rail 1.5" trusted a client-supplied `x-payer-address` header
// to name the billing wallet, letting any caller drain another wallet's prepaid
// credits. The fix removes that path: the billing wallet is now derived ONLY
// from a facilitator-verified x402 payment, carried on the trusted request-scoped
// field req.x402.wallet. rpc_gateway reads that field, never a header.
//
// These tests assert on the DB row (not the response body) and run inside a
// rolled-back transaction (savepoint pattern), so nothing persists. They SKIP
// without a DATABASE_URL (a LOCAL one — see .env.test + the .mocharc guard).
//
//   NEGATIVE  x-payer-address:A (unauth, and as wallet B) → A never charged
//   POSITIVE  verified payer A (trusted req.x402.wallet)  → exactly one deduction
//   REPLAY    same settlement twice                        → 409, no double credit

import { expect } from 'chai';

// EXACT mirror of the billing-wallet resolution in rpc_gateway.js (the security
// contract under test): a settled x402 payment supplies the wallet on the
// trusted req.x402 field; every other request uses the x-wallet-address header.
// Written pre-fix, req.x402 is undefined and this collapses to the header — which
// is precisely how the vulnerable gateway billed the attacker-named wallet, so
// the negative tests FAIL against pre-fix code and PASS after the fix.
function effectiveBillingWallet(req) {
  return req.x402?.settled ? (req.x402.wallet || null) : req.headers['x-wallet-address'];
}

describe('C1: x-payer-address credit theft is closed', function () {
  this.timeout(30000);

  const silent = { info() {}, warn() {}, error() {} };
  const PRICE = 0.00003;
  const walletA = '0xAaAa000000000000000000000000000000000A11'; // victim (funded)
  const walletB = '0xBbBb000000000000000000000000000000000B22'; // attacker (funded)

  let pg, raw, dbPool, sp;
  let createX402Middleware, authorizeAndMeter, recordX402Settlement,
      recordSettlementOrReject, recordRpcRevenue, isFounderWallet;

  before(async function () {
    if (!process.env.DATABASE_URL) this.skip();
    ({ createX402Middleware, recordSettlementOrReject } = await import('../src/payments/x402/middleware.js'));
    ({ authorizeAndMeter } = await import('../src/billing/credit_service.mjs'));
    ({ recordX402Settlement } = await import('../src/payments/x402/settlement.js'));
    ({ recordRpcRevenue } = await import('../src/workloads/rpc_gateway/rpc_billing.js'));
    ({ isFounderWallet } = await import('../src/payments/founder_wallets.js'));

    ({ default: pg } = await import('pg'));
    raw = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await raw.connect();
    await raw.query('BEGIN'); // outer txn — rolled back in after(); nothing persists
    sp = 0;
    const savepointClient = {
      query(sql, params) {
        if (sql === 'BEGIN') { sp++; return raw.query(`SAVEPOINT c1_sp_${sp}`); }
        if (sql === 'COMMIT') return raw.query(`RELEASE SAVEPOINT c1_sp_${sp}`);
        if (sql === 'ROLLBACK') return raw.query(`ROLLBACK TO SAVEPOINT c1_sp_${sp}`);
        return raw.query(sql, params);
      },
      release() {},
    };
    dbPool = { connect: async () => savepointClient, query: (sql, params) => raw.query(sql, params) };
  });

  after(async () => {
    if (raw) { await raw.query('ROLLBACK'); await raw.end(); }
  });

  // Per-test isolation that survives a FAILED assertion: a savepoint around each
  // test, unconditionally rolled back in afterEach (rolling back to a savepoint
  // also clears an aborted-transaction state). Nothing a test writes leaks to
  // the next test or the DB.
  beforeEach(async function () {
    if (!raw) this.skip();
    await raw.query('SAVEPOINT c1_test');
  });
  afterEach(async () => {
    if (!raw) return;
    await raw.query('ROLLBACK TO SAVEPOINT c1_test');
    await raw.query('RELEASE SAVEPOINT c1_test');
  });

  // Fresh funded accounts per test; each test wraps itself in a savepoint so its
  // seeds and any (attempted) deductions roll back and cannot leak across tests.
  async function seedAccount(wallet, credits, tier = 'basic') {
    await raw.query(
      `INSERT INTO api_credits (api_key, wallet_address, tier, daily_limit, credits_usdt, status)
       VALUES ($1, $2, $3, 1000000, $4, 'active')`,
      [`sk_${wallet.toLowerCase()}`, wallet, tier, credits]
    );
  }
  async function balanceOf(wallet) {
    const r = await raw.query(
      `SELECT credits_usdt FROM api_credits WHERE lower(wallet_address) = lower($1) ORDER BY created_at ASC LIMIT 1`,
      [wallet]
    );
    return r.rows[0] ? parseFloat(r.rows[0].credits_usdt) : null;
  }

  function makeReq(headers = {}, ip = '10.99.0.1') {
    return {
      headers,
      header(name) { const v = this.headers[name.toLowerCase()]; return Array.isArray(v) ? v[0] : v; },
      method: 'POST', originalUrl: '/rpc', url: '/rpc', path: '/rpc', query: {},
      protocol: 'https', body: { id: 1 }, socket: { remoteAddress: ip },
    };
  }
  function makeRes(resolve) {
    return {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; }, getHeaders() { return this.headers; },
      set() { return this; }, status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
      send(b) { resolve({ statusCode: this.statusCode, body: b }); return this; },
    };
  }
  // Run x402 middleware to completion (next() OR a terminal response).
  function runMw(mw, req) {
    return new Promise((resolve) => {
      const res = makeRes(resolve);
      Promise.resolve(mw(req, res, () => resolve({ nextCalled: true }))).catch((e) => resolve({ error: e }));
    });
  }

  it('NEGATIVE: unauthenticated caller with x-payer-address:A never charges A', async () => {
    process.env.X402_ENABLED = 'true';
    await seedAccount(walletA, 10);
    const before = await balanceOf(walletA);

    const mw = createX402Middleware(dbPool, silent);
    const req = makeReq({ 'x-payer-address': walletA }); // attacker names the victim
    await runMw(mw, req);

    // The middleware must NOT hand downstream a billing identity for A.
    expect(req.headers['x-wallet-address'], 'header must not be mutated to A').to.equal(undefined);
    const billed = effectiveBillingWallet(req);
    expect(billed, 'effective billing wallet must not be A').to.not.equal(walletA);

    // Drive the real deduction with whatever identity the gateway would use.
    const verdict = await authorizeAndMeter(dbPool, { apiKey: undefined, wallet: billed || undefined });
    expect(verdict.ok, 'no account resolved → not served/charged').to.equal(false);

    const after = await balanceOf(walletA);
    expect(after, "victim A's balance is unchanged").to.equal(before);
  });

  it('NEGATIVE: caller authed as wallet B with x-payer-address:A charges B, never A', async () => {
    process.env.X402_ENABLED = 'true';
    await seedAccount(walletA, 10);
    await seedAccount(walletB, 10);
    const aBefore = await balanceOf(walletA);
    const bBefore = await balanceOf(walletB);

    const mw = createX402Middleware(dbPool, silent);
    const req = makeReq({ 'x-wallet-address': walletB, 'x-payer-address': walletA });
    await runMw(mw, req);

    const billed = effectiveBillingWallet(req);
    expect(billed, 'billing wallet is the authenticated B, not the header-named A').to.equal(walletB);

    const verdict = await authorizeAndMeter(dbPool, { wallet: billed });
    expect(verdict.ok).to.equal(true);

    expect(await balanceOf(walletA), "victim A untouched").to.equal(aBefore);
    expect(await balanceOf(walletB), 'B charged exactly one call').to.be.closeTo(bBefore - PRICE, 1e-9);
  });

  it('POSITIVE: a facilitator-verified payer (trusted req.x402.wallet) is charged exactly once', async () => {
    await seedAccount(walletA, 10);
    const before = await balanceOf(walletA);

    // In production req.x402 is populated ONLY by the verified-payment path in
    // middleware.js (the negative tests above prove a header cannot set it).
    const req = makeReq({});
    req.x402 = { settled: true, payer: walletA, wallet: walletA, txHash: '0xc1_pos_tx' };

    const billed = effectiveBillingWallet(req);
    expect(billed).to.equal(walletA);

    const verdict = await authorizeAndMeter(dbPool, { wallet: billed });
    expect(verdict.ok).to.equal(true);
    expect(verdict.cost).to.be.closeTo(PRICE, 1e-12);
    expect(await balanceOf(walletA)).to.be.closeTo(before - PRICE, 1e-9);

    // usage metered exactly once
    const usage = await raw.query(
      `SELECT request_count FROM api_usage_daily WHERE api_key=$1 AND date=CURRENT_DATE`,
      [verdict.apiKey]
    );
    expect(parseInt(usage.rows[0].request_count, 10)).to.equal(1);

    // revenue recorded for the real deduction, is_test_data correct (A is not a founder)
    expect(isFounderWallet(walletA)).to.equal(false);
    await recordRpcRevenue({
      pool: dbPool, chain: 'polygon', method: 'eth_blockNumber',
      apiKey: verdict.apiKey, source: 'external_provider',
      requestId: 'c1_pos_rev', amountUsdt: verdict.cost,
    });
    const rev = await raw.query(
      `SELECT amount_usdt, is_test_data FROM revenue_events_v2 WHERE request_id='c1_pos_rev'`
    );
    expect(rev.rows, 'exactly one revenue row').to.have.length(1);
    expect(parseFloat(rev.rows[0].amount_usdt)).to.be.closeTo(PRICE, 1e-9);
    expect(rev.rows[0].is_test_data).to.equal(false);
  });

  it('REPLAY: the same settlement submitted twice → 409, no double credit', async () => {
    const params = {
      txHash: '0xc1_replay_tx', payer: walletA,
      network: 'eip155:8453', amountUsd: '0.10', bundleCalls: 1000,
    };
    const first = await recordX402Settlement(dbPool, params);
    expect(first.creditedKey).to.equal(`x402_${walletA.toLowerCase()}`);
    const afterFirst = await raw.query(
      `SELECT credits_usdt FROM api_credits WHERE api_key=$1`, [first.creditedKey]);

    const dup = await new Promise((resolve) => {
      const res = makeRes(resolve);
      recordSettlementOrReject(dbPool, res, params, silent);
    });
    expect(dup.statusCode).to.equal(409);
    expect(dup.body.error).to.equal('duplicate_settlement');

    const afterDup = await raw.query(
      `SELECT credits_usdt FROM api_credits WHERE api_key=$1`, [first.creditedKey]);
    expect(afterDup.rows[0].credits_usdt).to.equal(afterFirst.rows[0].credits_usdt);
    const count = await raw.query(
      `SELECT COUNT(*)::int AS n FROM payment_sources WHERE tx_hash=$1`, [params.txHash]);
    expect(count.rows[0].n).to.equal(1);
  });
});
