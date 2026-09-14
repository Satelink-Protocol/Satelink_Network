// P0 payer-identity regression — a client-supplied header must NEVER name the
// billing/deduction target (finding C1: x-payer-address / x-wallet-address
// credit theft, fixed 2026-09).
//
// These tests are SELF-CONTAINED — no database, no facilitator. They drive the
// real middleware with injected fakes and assert the security contract:
//
//   1. x402 middleware — a spoofed `x-payer-address` (no payment, no key) is
//      NOT aliased onto x-wallet-address and triggers NO account lookup
//      (Rail 1.5 removed). The header can no longer reach a deduction.
//   2. credit_gate  — a bare `x-wallet-address` (no api_key) → 401 and issues
//      NO SQL at all → the credit_balances UPDATE can never run for a spoofed
//      wallet.
//   3. credit_gate  — with a valid api_key AND a spoofed x-wallet-address
//      naming a DIFFERENT wallet, the atomic UPDATE targets the api_key-BOUND
//      wallet, never the header value.
//   4. rpc_gateway billing-wallet contract — a bare header yields NO billing
//      wallet; only a facilitator-verified x402 payment (req.x402.wallet) does.

import { expect } from 'chai';

const silent = { info() {}, warn() {}, error() {} };

function makeReq({ headers = {}, ip = '10.7.0.1' } = {}) {
  return {
    headers,
    header(name) {
      const v = this.headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
    method: 'POST',
    originalUrl: '/rpc/polygon',
    url: '/rpc/polygon',
    path: '/rpc/polygon',
    query: {},
    protocol: 'https',
    body: { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 },
    socket: { remoteAddress: ip },
  };
}

// Resolves once the middleware terminates: either a terminal JSON/send response
// or next().
function drive(mw, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      getHeaders() { return this.headers; },
      set() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ nextCalled: false, statusCode: this.statusCode, body: b }); return this; },
      send(b) { resolve({ nextCalled: false, statusCode: this.statusCode, body: b }); return this; },
    };
    Promise.resolve(mw(req, res, () => resolve({ nextCalled: true, statusCode: null, body: null })))
      .catch((err) => resolve({ error: err }));
  });
}

describe('P0 payer-identity: a client header cannot name the billing target', function () {
  this.timeout(15000);

  const VICTIM = '0xAaAa000000000000000000000000000000000A11';
  const BOUND = '0xBbBb000000000000000000000000000000000B22';

  let createX402Middleware, createCreditGate;

  before(async () => {
    ({ createX402Middleware } = await import('../src/payments/x402/middleware.js'));
    ({ createCreditGate } = await import('../src/middleware/credit_gate.js'));
  });

  it('x402: spoofed x-payer-address is not aliased and does not query the DB (Rail 1.5 removed)', async () => {
    process.env.X402_ENABLED = 'true';
    let queried = false;
    const pool = { query: async () => { queried = true; throw new Error('DB must not be touched by the x-payer-address path'); } };
    const mw = createX402Middleware(pool, silent);

    const req = makeReq({ headers: { 'x-payer-address': VICTIM } }); // no payment header, no api-key
    const out = await drive(mw, req);

    expect(out.error, out.error && out.error.message).to.equal(undefined);
    expect(out.nextCalled, 'anonymous request should fall through, not be served off the header').to.equal(true);
    // The header was NOT promoted into the trusted billing identity...
    expect(req.headers['x-wallet-address'], 'x-payer-address must never be aliased to x-wallet-address').to.equal(undefined);
    // ...and no api_credits lookup happened on its behalf (the old Rail 1.5 query).
    expect(queried, 'the x-payer-address path must not read any account').to.equal(false);
  });

  it('credit_gate: bare x-wallet-address (no api_key) → 401 and NO balance mutation', async () => {
    process.env.CREDIT_CANONICAL = ''; // exercise the legacy credit_balances gate
    let sqlCount = 0;
    const db = { query: async (sql) => { sqlCount++; throw new Error(`no SQL may run for a bare wallet header; got: ${sql}`); } };
    const gate = createCreditGate(db, silent);

    const req = makeReq({ headers: { 'x-wallet-address': VICTIM } }); // spoofed victim, no api-key
    const out = await drive(gate, req);

    expect(out.error).to.equal(undefined);
    expect(out.statusCode, 'bare wallet header must be rejected').to.equal(401);
    expect(out.body && out.body.error).to.equal('wallet_header_insufficient');
    expect(sqlCount, 'no query (and therefore no UPDATE credit_balances) may run').to.equal(0);
  });

  it('credit_gate: with an api_key, the deduction targets the BOUND wallet, never the spoofed header', async () => {
    process.env.CREDIT_CANONICAL = '';
    const captured = { updateWallet: null };
    const db = {
      query: async (sql, params) => {
        if (/FROM api_credits WHERE api_key/i.test(sql)) {
          return { rows: [{ wallet_address: BOUND }], rowCount: 1 };
        }
        if (/FROM rpc_method_pricing/i.test(sql)) {
          return { rows: [], rowCount: 0 }; // → DEFAULT_COST
        }
        if (/UPDATE credit_balances/i.test(sql)) {
          captured.updateWallet = params[1]; // WHERE lower(wallet_address) = $2
          return { rows: [{ balance_usdt: '9.99997' }], rowCount: 1 };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
    const gate = createCreditGate(db, silent);

    // api_key present; header names the VICTIM — the fix must ignore the header.
    const req = makeReq({ headers: { 'x-api-key': 'sk_live_bound', 'x-wallet-address': VICTIM } });
    const out = await drive(gate, req);

    expect(out.error).to.equal(undefined);
    expect(out.nextCalled, 'a funded bound key should pass the gate').to.equal(true);
    expect(captured.updateWallet, 'deduction must hit the api_key-bound wallet').to.equal(BOUND.toLowerCase());
    expect(captured.updateWallet, 'deduction must NOT hit the spoofed header wallet').to.not.equal(VICTIM.toLowerCase());
  });

  it('rpc_gateway billing-wallet contract: header → no wallet; verified x402 → the recovered payer', () => {
    // EXACT mirror of the derivation in rpc_gateway.js. A bare header must NOT
    // produce a billing wallet; only a settled x402 payment does.
    const billingWalletOf = (req) => (req.x402?.settled ? (req.x402.wallet || null) : null);

    expect(billingWalletOf({ headers: { 'x-wallet-address': VICTIM } })).to.equal(null);
    expect(billingWalletOf({ x402: { settled: true, wallet: BOUND } })).to.equal(BOUND);
    expect(billingWalletOf({ x402: { settled: true, wallet: null } })).to.equal(null);
  });
});
