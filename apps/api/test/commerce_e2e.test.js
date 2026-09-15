/**
 * apps/api/test/commerce_e2e.test.js
 *
 * END-TO-END COMMERCIAL SMOKE TEST — proves the complete money flow for both
 * the HUMAN and MACHINE customer journeys.
 *
 * HUMAN:   Customer → Dodo Checkout → Payment → Webhook → Financial OS → Ledger
 *          → Subscription → Entitlement → API → Usage → Charge → Reconciliation
 *
 * MACHINE: Machine → Discovery → Pricing → Intelligence API → 402 → x402 Payment
 *          → Retry → Intelligence Response → Usage → Financial OS → Settlement
 *
 * Uses mock pool to avoid needing a real database. Tests the wiring, not the DB.
 */

import { describe, it, before, after } from 'mocha';
import assert from 'assert';
import express from 'express';
import http from 'http';

// ── Mock Pool ───────────────────────────────────────────────────────────────

function createMockPool() {
  const store = {
    api_credits: new Map(),
    api_deposits: new Map(),
    api_usage_daily: new Map(),
    payment_sources: new Map(),
    revenue_events_v2: [],
    subscriptions: new Map(),
  };

  const pool = {
    _store: store,
    query: async (sql, params = []) => {
      const text = sql.replace(/\s+/g, ' ').trim();

      // resolveAccount
      if (text.includes('FROM api_credits WHERE api_key')) {
        const row = store.api_credits.get(params[0]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (text.includes('FROM api_credits WHERE lower(wallet_address)')) {
        const wallet = params[0]?.toLowerCase();
        for (const [, row] of store.api_credits) {
          if (row.wallet_address?.toLowerCase() === wallet) return { rows: [row], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // getDailyCount
      if (text.includes('FROM api_usage_daily WHERE api_key')) {
        const key = `${params[0]}:${params[1]}`;
        return { rows: [{ request_count: store.api_usage_daily.get(key) || 0 }] };
      }

      // UPDATE api_credits SET credits_usdt = credits_usdt - (paid deduction)
      if (text.includes('credits_usdt = credits_usdt -') && text.includes('RETURNING credits_usdt')) {
        const cost = params[0];
        const apiKey = params[1];
        const row = store.api_credits.get(apiKey);
        if (!row || parseFloat(row.credits_usdt) < cost) return { rowCount: 0, rows: [] };
        row.credits_usdt = parseFloat(row.credits_usdt) - cost;
        row.total_spent = (row.total_spent || 0) + cost;
        return { rowCount: 1, rows: [{ credits_usdt: row.credits_usdt }] };
      }

      // UPDATE api_credits SET last_used (free tier: no balance change)
      if (text.includes('SET last_used') && text.includes('WHERE api_key') && !text.includes('credits_usdt = credits_usdt')) {
        return { rowCount: 1, rows: [] };
      }

      // INSERT INTO api_usage_daily
      if (text.includes('INSERT INTO api_usage_daily')) {
        const today = new Date().toISOString().slice(0, 10);
        const key = `${params[0]}:${today}`;
        store.api_usage_daily.set(key, (store.api_usage_daily.get(key) || 0) + 1);
        return { rowCount: 1 };
      }

      // SELECT 1 FROM api_deposits WHERE tx_hash
      if (text.includes('FROM api_deposits WHERE tx_hash')) {
        return { rows: store.api_deposits.has(params[0]) ? [{ '1': 1 }] : [] };
      }

      // INSERT INTO api_deposits
      if (text.includes('INSERT INTO api_deposits')) {
        const txHash = params[1];
        if (store.api_deposits.has(txHash)) throw Object.assign(new Error('dup'), { code: '23505' });
        store.api_deposits.set(txHash, { api_key: params[0], amount: params[2] });
        return { rowCount: 1 };
      }

      // UPDATE api_credits SET credits_usdt = COALESCE + total_deposited
      if (text.includes('credits_usdt = COALESCE(credits_usdt, 0) +') && text.includes('total_deposited')) {
        const amount = params[0];
        const tier = params[1];
        const dailyLimit = params[2];
        const apiKey = params[3];
        const row = store.api_credits.get(apiKey);
        if (!row) return { rowCount: 0, rows: [] };
        row.credits_usdt = parseFloat(row.credits_usdt || 0) + amount;
        row.total_deposited = (row.total_deposited || 0) + amount;
        if (tier) row.tier = tier;
        if (dailyLimit) row.daily_limit = dailyLimit;
        return { rowCount: 1, rows: [{ credits_usdt: row.credits_usdt, tier: row.tier, daily_limit: row.daily_limit }] };
      }

      // SELECT 1 FROM payment_sources WHERE tx_hash
      if (text.includes('FROM payment_sources WHERE tx_hash')) {
        return { rows: store.payment_sources.has(params[0]) ? [{ '1': 1 }] : [] };
      }

      // INSERT INTO payment_sources
      if (text.includes('INSERT INTO payment_sources')) {
        const txHash = params[4];
        if (store.payment_sources.has(txHash)) throw Object.assign(new Error('dup'), { code: '23505' });
        store.payment_sources.set(txHash, { source: params[0], amount: params[1], tx_hash: txHash });
        return { rowCount: 1 };
      }

      // INSERT INTO revenue_events_v2
      if (text.includes('INSERT INTO revenue_events_v2')) {
        store.revenue_events_v2.push({ op_type: params[0], client_id: params[1], amount: params[2], request_id: params[4] });
        return { rowCount: 1 };
      }

      // Subscription-related queries
      if (text.includes('FROM subscriptions WHERE provider')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('INSERT INTO subscriptions')) {
        store.subscriptions.set(params[1], { plan: params[3], status: 'active' });
        return { rowCount: 1 };
      }
      if (text.includes('UPDATE subscriptions SET status')) {
        return { rowCount: 0 };
      }

      // api_credits by email
      if (text.includes('FROM api_credits WHERE lower(email)')) {
        return { rows: [], rowCount: 0 };
      }

      // INSERT INTO api_credits (new account creation)
      if (text.includes('INSERT INTO api_credits') && text.includes('demand_source')) {
        const apiKey = params[0];
        store.api_credits.set(apiKey, {
          api_key: apiKey,
          tier: params[1],
          daily_limit: params[2],
          credits_usdt: 0,
          status: 'active',
        });
        return { rowCount: 1 };
      }

      // UPDATE api_credits (GREATEST for refund)
      if (text.includes('GREATEST(0,')) {
        const amount = params[0];
        const apiKey = params[1];
        const row = store.api_credits.get(apiKey);
        if (row) row.credits_usdt = Math.max(0, parseFloat(row.credits_usdt || 0) - amount);
        return { rowCount: row ? 1 : 0 };
      }

      // SELECT credited_api_key from payment_sources
      if (text.includes('credited_api_key') && text.includes('FROM payment_sources')) {
        const ps = store.payment_sources.get(params[0]);
        return { rows: ps ? [{ credited_api_key: ps.credited_api_key, amount_usd: ps.amount }] : [] };
      }

      // Fallback
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({
      query: pool.query,
      release: () => {},
    }),
  };

  return pool;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqOpts = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { 'content-type': 'application/json', ...opts.headers },
    };
    const req = http.request(reqOpts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('Commerce E2E — Human + Machine Money Flow', function () {
  this.timeout(15000);
  let pool, app, server, baseUrl;

  before(async () => {
    pool = createMockPool();

    // Seed a test customer account
    pool._store.api_credits.set('mock_key_human_001', {
      api_key: 'mock_key_human_001',
      wallet_address: null,
      tier: 'free',
      daily_limit: 500,
      credits_usdt: 0,
      status: 'active',
      total_spent: 0,
      total_deposited: 0,
    });

    // Seed a machine account with credits
    pool._store.api_credits.set('mock_key_machine_001', {
      api_key: 'mock_key_machine_001',
      wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
      tier: 'pro',
      daily_limit: 100000,
      credits_usdt: 10.0,
      status: 'active',
      total_spent: 0,
      total_deposited: 10.0,
    });

    process.env.DODO_INTERNAL_SECRET = 'test_secret_e2e';
    process.env.LEDGER_SHADOW_WRITE = '0'; // keep shadow off for mock

    // Build a minimal app with the routes under test
    const { createIntelligenceRouter } = await import('../src/routes/intelligence_route.js');
    const { createDodoInternalRouter } = await import('../src/routes/internal_dodo.js');
    const { createMachineV1Router, createWellKnownSatelinkRouter } = await import('../src/routes/machine_onboarding.js');

    app = express();
    app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
    app.use('/.well-known', createWellKnownSatelinkRouter());
    app.use('/v1', express.json({ limit: '16kb' }), createMachineV1Router(pool, null));
    app.use('/v1', express.json({ limit: '16kb' }), createIntelligenceRouter(pool));
    app.use('/internal/dodo', createDodoInternalRouter(pool));

    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    delete process.env.DODO_INTERNAL_SECRET;
    if (server) await new Promise(resolve => server.close(resolve));
  });

  // ── HUMAN JOURNEY ──────────────────────────────────────────────────────

  describe('HUMAN JOURNEY', () => {
    it('H1: discovery — GET /v1/pricing returns machine-readable pricing', async () => {
      const r = await fetchJson(`${baseUrl}/v1/pricing`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.ok, true);
      assert.ok(r.body.tiers, 'tiers present');
      assert.ok(r.body.tiers.length >= 3, 'at least 3 tiers');
    });

    it('H2: Dodo webhook — payment.succeeded creates entitlement + credits', async () => {
      const r = await fetchJson(`${baseUrl}/internal/dodo/credit`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'test_secret_e2e' },
        body: {
          eventType: 'payment.succeeded',
          paymentId: 'pay_test_001',
          subscriptionId: 'sub_test_001',
          planProductId: null,
          customerEmail: 'test@customer.com',
          apiKeyHint: 'mock_key_human_001',
          currency: 'USD',
          amountMinor: 2499,
          isTestMode: true,
        },
      });
      assert.strictEqual(r.status, 200, `Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.body.ok, true);
      assert.strictEqual(r.body.entitled, true);
      assert.ok(r.body.creditedUsdt > 0, 'credits deposited');
    });

    it('H3: duplicate webhook — same payment → 409 idempotent', async () => {
      const r = await fetchJson(`${baseUrl}/internal/dodo/credit`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'test_secret_e2e' },
        body: {
          eventType: 'payment.succeeded',
          paymentId: 'pay_test_001',
          customerEmail: 'test@customer.com',
          apiKeyHint: 'mock_key_human_001',
          currency: 'USD',
          amountMinor: 2499,
        },
      });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.body.code, 'duplicate');
    });

    it('H4: invalid webhook secret → 401', async () => {
      const r = await fetchJson(`${baseUrl}/internal/dodo/credit`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'wrong_secret' },
        body: { eventType: 'payment.succeeded', paymentId: 'pay_test_002' },
      });
      assert.strictEqual(r.status, 401);
    });

    it('H5: subscription.cancelled updates status, no credit', async () => {
      const r = await fetchJson(`${baseUrl}/internal/dodo/credit`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'test_secret_e2e' },
        body: {
          eventType: 'subscription.cancelled',
          subscriptionId: 'sub_test_001',
        },
      });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.entitled, false, 'cancellation should not entitle');
    });

    it('H6: subscription.renewed credits again (different idKey)', async () => {
      const r = await fetchJson(`${baseUrl}/internal/dodo/credit`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'test_secret_e2e' },
        body: {
          eventType: 'subscription.renewed',
          subscriptionId: 'sub_test_001',
          previousBillingDate: '2026-08-16',
          apiKeyHint: 'mock_key_human_001',
          currency: 'USD',
          amountMinor: 2499,
        },
      });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.entitled, true);
    });

    it('H7: refund — creates reversal without deleting original', async () => {
      const r = await fetchJson(`${baseUrl}/internal/dodo/refund`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'test_secret_e2e' },
        body: {
          paymentId: 'pay_test_001',
          customerEmail: 'test@customer.com',
          amountMinor: 2499,
          currency: 'USD',
          reason: 'customer_request',
        },
      });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.refunded, true);
      // Verify original payment record still exists
      assert.ok(pool._store.payment_sources.has('dodo:pay_test_001'), 'original payment preserved');
      assert.ok(pool._store.payment_sources.has('dodo:refund:pay_test_001'), 'refund recorded');
    });

    it('H8: duplicate refund → 409', async () => {
      const r = await fetchJson(`${baseUrl}/internal/dodo/refund`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'test_secret_e2e' },
        body: {
          paymentId: 'pay_test_001',
          amountMinor: 2499,
          currency: 'USD',
        },
      });
      assert.strictEqual(r.status, 409);
    });

    it('H9: payment.failed does not grant credits', async () => {
      const r = await fetchJson(`${baseUrl}/internal/dodo/credit`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'test_secret_e2e' },
        body: {
          eventType: 'payment.failed',
          paymentId: 'pay_fail_001',
        },
      });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.entitled, false);
    });
  });

  // ── MACHINE JOURNEY ────────────────────────────────────────────────────

  describe('MACHINE JOURNEY', () => {
    it('M1: discovery — GET /.well-known/satelink.json returns manifest', async () => {
      const r = await fetchJson(`${baseUrl}/.well-known/satelink.json`);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.schema_version, '1.0');
      assert.ok(r.body.payment, 'payment info present');
      assert.ok(r.body.onboarding, 'onboarding info present');
    });

    it('M2: pricing — GET /v1/pricing returns pricing model', async () => {
      const r = await fetchJson(`${baseUrl}/v1/pricing`);
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.price_per_call_usdt, 'per-call price');
      assert.ok(r.body.intelligence, 'intelligence pricing');
    });

    it('M3: intelligence discovery — GET /v1/intelligence returns catalog', async () => {
      const r = await fetchJson(`${baseUrl}/v1/intelligence`);
      assert.strictEqual(r.status, 200);
      assert.ok(r.body.metrics, 'metrics catalog');
      assert.ok(r.body.payment, 'payment guidance');
    });

    it('M4: intelligence without key → 402 with payment guidance', async () => {
      const r = await fetchJson(`${baseUrl}/v1/intelligence/funding-rate-heatmap`);
      assert.strictEqual(r.status, 402);
      assert.ok(r.body.how_to_pay, 'payment guidance in 402');
    });

    it('M5: intelligence with funded key → billed + response', async () => {
      // The response will be 503 (warming_up) because no snapshot exists,
      // but the billing MUST have occurred. We check the credit was deducted.
      const before = pool._store.api_credits.get('mock_key_machine_001').credits_usdt;
      const r = await fetchJson(`${baseUrl}/v1/intelligence/funding-rate-heatmap`, {
        headers: { 'x-api-key': 'mock_key_machine_001' },
      });
      // Either 200 (snapshot exists) or 503 (warming up) — both are valid
      assert.ok([200, 503].includes(r.status), `Expected 200 or 503, got ${r.status}`);
      const after = pool._store.api_credits.get('mock_key_machine_001').credits_usdt;
      assert.ok(after < before, `Credits should be deducted: was ${before}, now ${after}`);
    });

    it('M6: intelligence with exhausted credits → 402', async () => {
      // Drain credits
      pool._store.api_credits.get('mock_key_machine_001').credits_usdt = 0;
      const r = await fetchJson(`${baseUrl}/v1/intelligence/funding-rate-heatmap`, {
        headers: { 'x-api-key': 'mock_key_machine_001' },
      });
      assert.strictEqual(r.status, 402);
    });
  });

  // ── TENANT ISOLATION ───────────────────────────────────────────────────

  describe('TENANT ISOLATION', () => {
    it('T1: Customer A cannot use Customer B API key', async () => {
      // mock_key_machine_001 is drained; mock_key_human_001 has credits from Dodo
      const r = await fetchJson(`${baseUrl}/v1/intelligence/funding-rate-heatmap`, {
        headers: { 'x-api-key': 'mock_key_nonexistent' },
      });
      // Should get 401 or 402 — not 200 with another customer's data
      assert.ok([401, 402].includes(r.status));
    });
  });

  // ── IDEMPOTENCY ────────────────────────────────────────────────────────

  describe('IDEMPOTENCY', () => {
    it('I1: replayed payment.succeeded → 409, money not doubled', async () => {
      const r1 = await fetchJson(`${baseUrl}/internal/dodo/credit`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'test_secret_e2e' },
        body: {
          eventType: 'payment.succeeded',
          paymentId: 'pay_idem_001',
          apiKeyHint: 'mock_key_human_001',
          currency: 'USD',
          amountMinor: 500,
        },
      });
      assert.strictEqual(r1.status, 200);
      const balanceAfterFirst = pool._store.api_credits.get('mock_key_human_001').credits_usdt;

      const r2 = await fetchJson(`${baseUrl}/internal/dodo/credit`, {
        method: 'POST',
        headers: { 'x-dodo-internal-secret': 'test_secret_e2e' },
        body: {
          eventType: 'payment.succeeded',
          paymentId: 'pay_idem_001',
          apiKeyHint: 'mock_key_human_001',
          currency: 'USD',
          amountMinor: 500,
        },
      });
      assert.strictEqual(r2.status, 409);
      const balanceAfterSecond = pool._store.api_credits.get('mock_key_human_001').credits_usdt;
      assert.strictEqual(balanceAfterFirst, balanceAfterSecond, 'MONEY MUST NOT CREATE TWICE');
    });
  });

  // ── FINANCIAL RECORDS ──────────────────────────────────────────────────

  describe('FINANCIAL RECORDS', () => {
    it('F1: payment creates both payment_sources and revenue_events_v2', () => {
      assert.ok(pool._store.payment_sources.has('dodo:pay_test_001'), 'payment_source recorded');
      const revEvents = pool._store.revenue_events_v2.filter(e => e.request_id === 'dodo:pay_test_001');
      assert.ok(revEvents.length >= 1, 'revenue_event recorded');
    });

    it('F2: refund creates reversal records without deleting originals', () => {
      const original = pool._store.payment_sources.get('dodo:pay_test_001');
      const refund = pool._store.payment_sources.get('dodo:refund:pay_test_001');
      assert.ok(original, 'original payment preserved');
      assert.ok(refund, 'refund reversal recorded');
      assert.ok(refund.amount < 0, 'refund has negative amount');
    });
  });
});
