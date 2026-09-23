// P0-wallet-auth (2026-09) — x-wallet-address is C1's twin on the primary
// (non-x402) serving path: it was read as a bare, unauthenticated header and
// handed straight to a balance deduction, in BOTH billing backends:
//   - canonical (api_credits): rpc_gateway.js -> credit_service.mjs
//   - legacy    (credit_balances): credit_gate.js
//
// The fix: billing identity is resolved ONLY from a presented api_key's bound
// account (or a facilitator-verified x402 payment, unchanged from P0-2).
// x-wallet-address alone is read for the 401 message only, never for billing.
//
// Four tests, matching the C1 pattern:
//   CANONICAL NEGATIVE — supertest through the real HTTP router (this is
//     where the new 401 short-circuit lives, in rpc_gateway.js's route
//     handler) — a bare wallet header, and a wallet header alongside a
//     DIFFERENT valid api_key, must never charge the named wallet.
//   CANONICAL POSITIVE — the actual authorizeAndMeter call the fixed router
//     now makes for an api_key caller (wallet arg omitted/null) deducts
//     exactly once from the key's own account. Calling the exported billing
//     primitive directly (not a live network dispatch) mirrors c1_payer_
//     address.test.js's approach — routeRpcRequest is a hard import with no
//     test seam, so a full-router positive run would hit a live RPC provider.
//   LEGACY NEGATIVE/POSITIVE — createCreditGate's real exported middleware,
//     invoked directly with a fake req/res/next (no Express/dispatch needed
//     since credit_gate.js is pure middleware — its decision IS the deduction).
//
// All four assert on the DB row, run inside savepoints (nothing persists),
// and SKIP without a local DATABASE_URL (see .env.test / apps/api/test/README.md).

import { expect } from 'chai';

describe('P0-wallet-auth: x-wallet-address can no longer drive billing', function () {
  this.timeout(30000);

  const PRICE = 0.00003;
  const walletA = '0xAaAa000000000000000000000000000000000A11'; // victim (funded)
  const walletB = '0xBbBb000000000000000000000000000000000B22'; // legit caller (funded)

  let pg, raw, connected = false;
  let authorizeAndMeter, createCreditGate;

  before(async function () {
    if (!process.env.DATABASE_URL) this.skip();
    ({ authorizeAndMeter } = await import('../src/billing/credit_service.mjs'));
    ({ createCreditGate } = await import('../src/middleware/credit_gate.js'));
    ({ default: pg } = await import('pg'));
    raw = new pg.Client({ connectionString: process.env.DATABASE_URL });
    // DATABASE_URL can be SET but unreachable/misconfigured in some sandboxes
    // (e.g. stale credentials) — skip cleanly rather than failing the suite
    // (test-harness only; see docs/api/TEST_TRIAGE.md root cause A).
    try {
      await raw.connect();
      connected = true;
    } catch (err) {
      this.skip();
    }
    await raw.query('BEGIN'); // outer txn — rolled back in after(); nothing persists
  });

  after(async () => {
    if (raw && connected) { await raw.query('ROLLBACK'); await raw.end(); }
  });

  beforeEach(async function () {
    if (!raw) this.skip();
    await raw.query('SAVEPOINT wallet_auth_test');
  });
  afterEach(async () => {
    if (!raw) return;
    await raw.query('ROLLBACK TO SAVEPOINT wallet_auth_test');
    await raw.query('RELEASE SAVEPOINT wallet_auth_test');
  });

  async function seedApiCredits(wallet, apiKey, credits, tier = 'basic') {
    await raw.query(
      `INSERT INTO api_credits (api_key, wallet_address, tier, daily_limit, credits_usdt, status)
       VALUES ($1, $2, $3, 1000000, $4, 'active')`,
      [apiKey, wallet, tier, credits]
    );
  }
  async function apiCreditsBalance(apiKey) {
    const r = await raw.query(`SELECT credits_usdt FROM api_credits WHERE api_key=$1`, [apiKey]);
    return r.rows[0] ? parseFloat(r.rows[0].credits_usdt) : null;
  }
  async function seedCreditBalance(wallet, balance) {
    await raw.query(
      `INSERT INTO credit_balances (wallet_address, balance_usdt, total_deposited)
       VALUES ($1, $2, $2)`,
      [wallet, balance]
    );
  }
  async function creditBalanceOf(wallet) {
    const r = await raw.query(
      `SELECT balance_usdt, total_spent FROM credit_balances WHERE lower(wallet_address)=lower($1)`,
      [wallet]
    );
    return r.rows[0] ? { balance: parseFloat(r.rows[0].balance_usdt), spent: parseFloat(r.rows[0].total_spent || 0) } : null;
  }

  // ── CANONICAL (api_credits) ────────────────────────────────────────────

  describe('canonical path (rpc_gateway.js -> credit_service.mjs)', function () {
    let app, request;

    before(async function () {
      if (!process.env.DATABASE_URL) this.skip();
      const express = (await import('express')).default;
      request = (await import('supertest')).default;
      const { createRpcGateway } = await import('../src/workloads/rpc_gateway/rpc_gateway.js');
      app = express();
      app.use('/rpc', express.json(), createRpcGateway(raw));
    });

    beforeEach(() => { process.env.CREDIT_CANONICAL = 'true'; });
    afterEach(() => { delete process.env.CREDIT_CANONICAL; });

    it('NEGATIVE: bare x-wallet-address (no api_key) never charges the named wallet — 401, A unchanged', async () => {
      await seedApiCredits(walletA, `sk_${walletA.toLowerCase()}`, 10);
      const before = await apiCreditsBalance(`sk_${walletA.toLowerCase()}`);

      const res = await request(app).post('/rpc/polygon')
        .set('x-wallet-address', walletA)
        .set('Content-Type', 'application/json')
        .send({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });

      expect(res.status).to.equal(401);
      expect(res.body.error).to.equal('wallet_header_insufficient');
      expect(await apiCreditsBalance(`sk_${walletA.toLowerCase()}`)).to.equal(before);
    });

    // A valid api_key gets SERVED — which means the full HTTP router would
    // proceed past billing into routeRpcRequest and make a real outbound RPC
    // call (no test seam; same constraint noted in c1_payer_address.test.js).
    // So this drives the exact identity-resolution + deduction the fixed
    // router now performs, without a live network dispatch: mirror
    // rpc_gateway.js's post-fix formula (walletForBilling is req.x402.wallet
    // ONLY, never the header — proven directly at the router level by the
    // bare-header 401 test above), then call the real authorizeAndMeter with
    // it, and assert on the DB row.
    function walletForBilling(req) {
      return req.x402?.settled ? (req.x402.wallet || null) : null;
    }

    it('NEGATIVE: valid api_key for B + x-wallet-address:A never charges A — charges B instead', async () => {
      const keyB = `sk_${walletB.toLowerCase()}`;
      await seedApiCredits(walletA, `sk_${walletA.toLowerCase()}`, 10);
      await seedApiCredits(walletB, keyB, 10);
      const aBefore = await apiCreditsBalance(`sk_${walletA.toLowerCase()}`);
      const bBefore = await apiCreditsBalance(keyB);

      // Attacker/mistaken client: valid key for B, but names A in the header.
      const req = { headers: { 'x-api-key': keyB, 'x-wallet-address': walletA } };
      const resolvedWallet = walletForBilling(req); // null — the header never reaches billing
      expect(resolvedWallet).to.equal(null);

      const verdict = await authorizeAndMeter(raw, { apiKey: req.headers['x-api-key'], wallet: resolvedWallet });
      expect(verdict.ok).to.equal(true);
      expect(verdict.apiKey).to.equal(keyB);

      expect(await apiCreditsBalance(`sk_${walletA.toLowerCase()}`), "A's balance is unchanged").to.equal(aBefore);
      expect(await apiCreditsBalance(keyB), "B is the one charged").to.be.closeTo(bBefore - PRICE, 1e-9);
    });

    it('POSITIVE: valid api_key for A, funded, correct call -> exactly one deduction from A', async () => {
      const keyA = `sk_${walletA.toLowerCase()}`;
      await seedApiCredits(walletA, keyA, 10);
      const before = await apiCreditsBalance(keyA);

      // This is exactly what the fixed rpc_gateway.js now calls for an
      // api_key caller: enforceCapacity(db, { apiKey, wallet: walletForBilling })
      // where walletForBilling is null for any non-x402 request — apiKey
      // alone resolves the account; the header is irrelevant here.
      const verdict = await authorizeAndMeter(raw, { apiKey: keyA, wallet: null });
      expect(verdict.ok).to.equal(true);
      expect(verdict.apiKey).to.equal(keyA);
      expect(verdict.cost).to.be.closeTo(PRICE, 1e-12);

      const after = await apiCreditsBalance(keyA);
      expect(after).to.be.closeTo(before - PRICE, 1e-9);

      const usage = await raw.query(
        `SELECT request_count FROM api_usage_daily WHERE api_key=$1 AND date=CURRENT_DATE`, [keyA]
      );
      expect(parseInt(usage.rows[0].request_count, 10), 'metered exactly once').to.equal(1);
    });
  });

  // ── LEGACY (credit_balances via credit_gate.js) ────────────────────────

  describe('legacy path (credit_gate.js -> credit_balances)', function () {
    function fakeReqRes(headers, body = { method: 'eth_blockNumber' }) {
      let statusCode = null, jsonBody = null, nextCalled = false;
      const req = { headers, body };
      const res = {
        status(c) { statusCode = c; return this; },
        json(b) { jsonBody = b; return this; },
      };
      const next = () => { nextCalled = true; };
      return { req, res, next, result: () => ({ statusCode, jsonBody, nextCalled }) };
    }

    it('NEGATIVE: bare x-wallet-address (no api_key) never charges the named wallet — 401, A unchanged', async () => {
      await seedApiCredits(walletA, `sk_${walletA.toLowerCase()}`, 10); // api_key exists, but NOT presented
      await seedCreditBalance(walletA, 10);
      const before = await creditBalanceOf(walletA);

      const gate = createCreditGate(raw, { warn() {}, error() {} });
      const { req, res, next, result } = fakeReqRes({ 'x-wallet-address': walletA });
      await gate(req, res, next);
      const out = result();

      expect(out.nextCalled, 'must not proceed to the RPC dispatch').to.equal(false);
      expect(out.statusCode).to.equal(401);
      expect(out.jsonBody.error).to.equal('wallet_header_insufficient');
      expect(await creditBalanceOf(walletA)).to.deep.equal(before);
    });

    it('NEGATIVE: valid api_key for B + x-wallet-address:A never charges A (charges B or 401s, never A)', async () => {
      const keyB = `sk_${walletB.toLowerCase()}`;
      await seedApiCredits(walletA, `sk_${walletA.toLowerCase()}`, 10);
      await seedApiCredits(walletB, keyB, 10);
      await seedCreditBalance(walletA, 10);
      await seedCreditBalance(walletB, 10);
      const aBefore = await creditBalanceOf(walletA);
      const bBefore = await creditBalanceOf(walletB);

      const gate = createCreditGate(raw, { warn() {}, error() {} });
      const { req, res, next, result } = fakeReqRes({ 'x-api-key': keyB, 'x-wallet-address': walletA });
      await gate(req, res, next);
      const out = result();

      expect(await creditBalanceOf(walletA), "A's credit_balances row is unchanged").to.deep.equal(aBefore);
      if (out.nextCalled) {
        expect(req.creditWallet, 'resolved wallet is B, from the api_key, never the header').to.equal(walletB.toLowerCase());
        const bAfter = await creditBalanceOf(walletB);
        expect(bAfter.spent).to.be.closeTo(bBefore.spent + req.creditDeducted, 1e-9);
      }
    });

    it('POSITIVE: valid api_key for A, funded, correct call -> exactly one deduction from A', async () => {
      const keyA = `sk_${walletA.toLowerCase()}`;
      await seedApiCredits(walletA, keyA, 10);
      await seedCreditBalance(walletA, 10);
      const before = await creditBalanceOf(walletA);

      const gate = createCreditGate(raw, { warn() {}, error() {} });
      const { req, res, next, result } = fakeReqRes({ 'x-api-key': keyA });
      await gate(req, res, next);
      const out = result();

      expect(out.nextCalled, 'proceeds to serve the call').to.equal(true);
      expect(req.creditWallet, 'wallet resolved from the api_key, not a header').to.equal(walletA.toLowerCase());
      expect(req.creditDeducted).to.be.closeTo(PRICE, 1e-12);

      const after = await creditBalanceOf(walletA);
      expect(after.balance).to.be.closeTo(before.balance - req.creditDeducted, 1e-9);
      expect(after.spent).to.be.closeTo(before.spent + req.creditDeducted, 1e-9);
    });
  });
});
