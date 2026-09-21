import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { createDodoInternalRouter } from '../src/routes/internal_dodo.js';

// In-memory mock of a pg pool + a dedicated transactional client sharing the
// SAME state (mirrors a real pool.connect() seeing the same DB the pool
// queries against). SQL matched by substring, same pattern as
// credit_service.test.js / deposit_listener.test.js.
function makePool() {
  const state = {
    apiCredits: new Map(),      // api_key -> row
    apiDeposits: new Set(),     // tx_hash
    paymentSources: new Set(),  // tx_hash
    revenueEvents: [],
    subscriptions: new Map(),   // `${provider}:${provider_subscription_id}` -> row
    usageDaily: new Map(),
    unmatchedPayments: [],      // rows, in insertion order
  };

  function client() {
    return {
      async query(sql, params = []) {
        const s = sql.replace(/\s+/g, ' ').trim();

        if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };

        if (s.includes('SELECT 1 FROM payment_sources WHERE tx_hash')) {
          return { rows: state.paymentSources.has(params[0]) ? [{ '?column?': 1 }] : [] };
        }
        if (s.includes('INSERT INTO payment_sources')) {
          if (state.paymentSources.has(params[2])) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
          state.paymentSources.add(params[2]);
          return { rowCount: 1, rows: [] };
        }
        if (s.includes('INSERT INTO revenue_events_v2')) {
          state.revenueEvents.push({ requestId: params[2], amountUsd: params[1] });
          return { rowCount: 1, rows: [] };
        }

        // ── unmatched_payments (T-1.4)
        if (s.startsWith('INSERT INTO unmatched_payments')) {
          const [eventType, paymentId, subscriptionId, productId, customerEmail, currency,
            amountMinor, metadata, reason, rawPayload, isTest] = params;
          if (paymentId && state.unmatchedPayments.some((r) => r.payment_id === paymentId)) {
            return { rowCount: 0, rows: [] }; // ON CONFLICT DO NOTHING
          }
          state.unmatchedPayments.push({
            id: state.unmatchedPayments.length + 1, event_type: eventType, payment_id: paymentId,
            subscription_id: subscriptionId, product_id: productId, customer_email: customerEmail,
            currency, amount_minor: amountMinor, metadata, reason, raw_payload: rawPayload,
            is_test_data: isTest, resolved: false,
          });
          return { rowCount: 1, rows: [] };
        }

        // ── resolveAccount (credit_service.mjs) — used by both the strict
        // one-time-payment resolution and the checkout-time resolve-or-create.
        if (s.startsWith('SELECT api_key, wallet_address') && s.includes('WHERE api_key')) {
          const row = state.apiCredits.get(params[0]);
          return { rows: row ? [row] : [] };
        }
        if (s.includes('SELECT api_key FROM subscriptions WHERE')) {
          const row = state.subscriptions.get(`dodo:${params[0]}`);
          return { rows: row?.api_key ? [{ api_key: row.api_key }] : [] };
        }
        if (s.includes('SELECT api_key FROM api_credits WHERE lower(email)')) {
          for (const row of state.apiCredits.values()) {
            if (row.email && row.email.toLowerCase() === String(params[0]).toLowerCase()) return { rows: [{ api_key: row.api_key }] };
          }
          return { rows: [] };
        }
        if (s.startsWith('INSERT INTO api_credits') && s.includes('demand_source')) {
          const [apiKey, tier, dailyLimit, email] = params;
          if (!state.apiCredits.has(apiKey)) {
            state.apiCredits.set(apiKey, { api_key: apiKey, tier, daily_limit: dailyLimit, credits_usdt: 0, total_deposited: 0, total_spent: 0, email, status: 'active' });
          }
          return { rowCount: 1, rows: [] };
        }

        // ── creditAccount() (billing/credit_service.mjs)
        if (s.includes('SELECT 1 FROM api_deposits WHERE tx_hash')) {
          return { rows: state.apiDeposits.has(params[0]) ? [{ '?column?': 1 }] : [] };
        }
        if (s.includes('INSERT INTO api_deposits')) {
          if (state.apiDeposits.has(params[1])) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
          state.apiDeposits.add(params[1]);
          return { rowCount: 1, rows: [] };
        }
        if (s.startsWith('UPDATE api_credits') && s.includes('total_deposited')) {
          const [amount, tier, dailyLimit, apiKey] = params;
          const row = state.apiCredits.get(apiKey);
          if (!row) return { rowCount: 0, rows: [] };
          row.credits_usdt = +(row.credits_usdt + amount).toFixed(6);
          row.total_deposited = +(row.total_deposited + amount).toFixed(6);
          if (tier) row.tier = tier;
          if (dailyLimit) row.daily_limit = dailyLimit;
          return { rowCount: 1, rows: [{ credits_usdt: row.credits_usdt, tier: row.tier, daily_limit: row.daily_limit }] };
        }

        // ── subscriptions upsert — check the MORE SPECIFIC (cancelled_at-bearing,
        // upsertSubscriptionStatus) shape first: both queries start with the
        // same literal "INSERT INTO subscriptions" prefix.
        if (s.startsWith('INSERT INTO subscriptions') && s.includes('cancelled_at')) {
          // upsertSubscriptionStatus (non-entitling path)
          const [id, providerSubscriptionId, apiKey, plan, status, currency, amountMinor, periodStart, periodEnd, cancelledAt] = params;
          const existing = state.subscriptions.get(id);
          state.subscriptions.set(id, {
            id, provider: 'dodo', provider_subscription_id: providerSubscriptionId,
            api_key: existing?.api_key || apiKey, plan: existing?.plan || plan, status,
            currency: existing?.currency || currency, recurring_amount_minor: existing?.recurring_amount_minor || amountMinor,
            current_period_start: periodStart || existing?.current_period_start,
            current_period_end: periodEnd || existing?.current_period_end,
            cancelled_at: cancelledAt || existing?.cancelled_at,
          });
          return { rowCount: 1, rows: [] };
        }
        if (s.startsWith('INSERT INTO subscriptions')) {
          const [id, providerSubscriptionId, apiKey, plan, currency, amountMinor, periodStart, periodEnd] = params;
          const key = id;
          const existing = state.subscriptions.get(key);
          state.subscriptions.set(key, {
            id, provider: 'dodo', provider_subscription_id: providerSubscriptionId,
            api_key: existing?.api_key || apiKey, plan, status: 'active', currency,
            recurring_amount_minor: amountMinor, current_period_start: periodStart, current_period_end: periodEnd,
          });
          return { rowCount: 1, rows: [] };
        }

        throw new Error('unexpected SQL: ' + s);
      },
      release() {},
    };
  }

  return {
    state,
    async connect() { return client(); },
    async query(sql, params) { return client().query(sql, params); },
  };
}

function buildApp(pool) {
  const app = express();
  app.use('/internal/dodo', createDodoInternalRouter(pool));
  return app;
}

/** Seed a pre-existing account directly into the mock store — simulates an
 * account already provisioned by /internal/dodo/resolve-account (checkout
 * time) before any payment.succeeded webhook arrives. */
function seedAccount(pool, apiKey, { email, tier = 'free' } = {}) {
  pool.state.apiCredits.set(apiKey, {
    api_key: apiKey, tier, daily_limit: 500, credits_usdt: 0, total_deposited: 0, total_spent: 0,
    email: email || null, status: 'active',
  });
}

const SECRET = 'test-secret-xyz';
const CREDIT_PACK_PRODUCT_ID = 'prod_credit_pack_test';

describe('POST /internal/dodo/credit', () => {
  let pool, app;
  const prevSecret = process.env.DODO_INTERNAL_SECRET;
  const prevAllowlist = process.env.DODO_CREDIT_PACK_PRODUCT_IDS;
  const prevValues = process.env.DODO_CREDIT_PACK_USD_VALUES;
  before(() => {
    process.env.DODO_INTERNAL_SECRET = SECRET;
    process.env.DODO_CREDIT_PACK_PRODUCT_IDS = CREDIT_PACK_PRODUCT_ID;
  });
  after(() => {
    process.env.DODO_INTERNAL_SECRET = prevSecret;
    process.env.DODO_CREDIT_PACK_PRODUCT_IDS = prevAllowlist;
    process.env.DODO_CREDIT_PACK_USD_VALUES = prevValues;
  });

  beforeEach(() => {
    pool = makePool();
    app = buildApp(pool);
  });

  it('gate d: missing/tampered secret → 401', async () => {
    const res = await request(app)
      .post('/internal/dodo/credit')
      .set('x-dodo-internal-secret', 'wrong')
      .send({ eventType: 'payment.succeeded', paymentId: 'pay_1', currency: 'USD', amountMinor: 100000 });
    expect(res.status).to.equal(401);

    const res2 = await request(app)
      .post('/internal/dodo/credit')
      .send({ eventType: 'payment.succeeded', paymentId: 'pay_1', currency: 'USD', amountMinor: 100000 });
    expect(res2.status).to.equal(401);
  });

  it('gate a: payment.succeeded (with a pre-resolved account) credits payment_sources + revenue_events_v2 + api_credits', async () => {
    seedAccount(pool, 'sk_dodo_buyer1', { email: 'buyer@example.com' });
    const res = await request(app)
      .post('/internal/dodo/credit')
      .set('x-dodo-internal-secret', SECRET)
      .send({
        eventType: 'payment.succeeded', paymentId: 'pay_1', apiKeyHint: 'sk_dodo_buyer1',
        planProductId: CREDIT_PACK_PRODUCT_ID,
        customerEmail: 'buyer@example.com', currency: 'USD', amountMinor: 499_00,
      });

    expect(res.status).to.equal(200);
    expect(res.body.ok).to.equal(true);
    expect(res.body.entitled).to.equal(true);
    expect(res.body.apiKey).to.equal('sk_dodo_buyer1');
    expect(pool.state.paymentSources.has('dodo:pay_1')).to.equal(true);
    expect(pool.state.revenueEvents).to.have.length(1);
    expect(pool.state.revenueEvents[0].requestId).to.equal('dodo:pay_1');
    const account = pool.state.apiCredits.get('sk_dodo_buyer1');
    expect(account.credits_usdt).to.be.closeTo(499, 1e-6);
  });

  it('gate b: replaying the same payment_id → 409, no second credit', async () => {
    seedAccount(pool, 'sk_dodo_buyer2');
    const payload = { eventType: 'payment.succeeded', paymentId: 'pay_2', apiKeyHint: 'sk_dodo_buyer2', planProductId: CREDIT_PACK_PRODUCT_ID, customerEmail: 'b@example.com', currency: 'USD', amountMinor: 499_00 };
    const first = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET).send(payload);
    expect(first.status).to.equal(200);
    const balanceAfterFirst = pool.state.apiCredits.get('sk_dodo_buyer2').credits_usdt;

    const second = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET).send(payload);
    expect(second.status).to.equal(409);
    expect(pool.state.apiCredits.get('sk_dodo_buyer2').credits_usdt).to.equal(balanceAfterFirst);
    expect(pool.state.revenueEvents).to.have.length(1);
  });

  it('gate c: subscription.active alone → NO credit, NO entitlement', async () => {
    const res = await request(app)
      .post('/internal/dodo/credit')
      .set('x-dodo-internal-secret', SECRET)
      .send({ eventType: 'subscription.active', subscriptionId: 'sub_3', currency: 'USD', amountMinor: 499_00 });

    expect(res.status).to.equal(200);
    expect(res.body.entitled).to.equal(false);
    expect(pool.state.paymentSources.size).to.equal(0);
    expect(pool.state.revenueEvents).to.have.length(0);
    expect(pool.state.apiCredits.size).to.equal(0);
    const sub = pool.state.subscriptions.get('dodo:sub_3');
    expect(sub.status).to.equal('active');
  });

  it('subscription.on_hold and subscription.cancelled update status only', async () => {
    await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({ eventType: 'subscription.active', subscriptionId: 'sub_4' });
    const onHold = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({ eventType: 'subscription.on_hold', subscriptionId: 'sub_4' });
    expect(onHold.body.entitled).to.equal(false);
    expect(pool.state.subscriptions.get('dodo:sub_4').status).to.equal('on_hold');

    const cancelled = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({ eventType: 'subscription.cancelled', subscriptionId: 'sub_4' });
    expect(cancelled.body.entitled).to.equal(false);
    expect(pool.state.subscriptions.get('dodo:sub_4').status).to.equal('cancelled');
    expect(pool.state.apiCredits.size).to.equal(0); // never touched api_credits
  });

  it('subscription.renewed credits the account already linked on the subscriptions row (no email fallback, no creation)', async () => {
    // Simulates an account already linked to this subscription (e.g. by an
    // earlier payment.succeeded that also carried subscriptionId) — renewal
    // resolution reads ONLY this link, never guesses by email.
    pool.state.subscriptions.set('dodo:sub_5', { id: 'dodo:sub_5', provider: 'dodo', provider_subscription_id: 'sub_5', api_key: 'sk_dodo_sub5' });
    seedAccount(pool, 'sk_dodo_sub5', { email: 'c@example.com' });

    const payload = {
      eventType: 'subscription.renewed', subscriptionId: 'sub_5', customerEmail: 'c@example.com',
      currency: 'USD', amountMinor: 499_00, previousBillingDate: '2026-10-01T00:00:00Z',
    };
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET).send(payload);
    expect(res.status).to.equal(200);
    expect(res.body.entitled).to.equal(true);
    expect(res.body.apiKey).to.equal('sk_dodo_sub5');
    expect(pool.state.paymentSources.has('dodo:sub:sub_5:2026-10-01T00:00:00Z')).to.equal(true);

    // A different renewal cycle (different previousBillingDate) is a DIFFERENT charge, not a duplicate.
    const res2 = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({ ...payload, previousBillingDate: '2026-11-01T00:00:00Z' });
    expect(res2.status).to.equal(200);
    const account = pool.state.apiCredits.get('sk_dodo_sub5');
    expect(account.credits_usdt).to.be.closeTo(998, 1e-6); // two renewals credited
  });

  it('subscription.renewed with NO prior link (subscription.active never carried an account) → unmatched, not guessed', async () => {
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({
        eventType: 'subscription.renewed', subscriptionId: 'sub_orphan', customerEmail: 'orphan@example.com',
        currency: 'USD', amountMinor: 499_00, previousBillingDate: '2026-10-01T00:00:00Z',
      });
    expect(res.status).to.equal(200);
    expect(res.body.entitled).to.equal(false);
    expect(res.body.matched).to.equal(false);
    expect(pool.state.apiCredits.size).to.equal(0);
    expect(pool.state.unmatchedPayments).to.have.length(1);
    expect(pool.state.unmatchedPayments[0].reason).to.equal('account_not_found');
  });

  it('gate e: the credited key is a real, spendable api_credits paid tier (not free)', async () => {
    seedAccount(pool, 'sk_dodo_d', { email: 'd@example.com', tier: 'starter' });
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({ eventType: 'payment.succeeded', paymentId: 'pay_6', apiKeyHint: 'sk_dodo_d', planProductId: CREDIT_PACK_PRODUCT_ID, customerEmail: 'd@example.com', currency: 'USD', amountMinor: 499_00 });
    const account = pool.state.apiCredits.get(res.body.apiKey);
    // authorizeAndMeter's costFor() only exempts tier === 'free' — anything
    // else (here 'starter') is charged PRICE_PER_CALL_USDT and drawn from
    // credits_usdt, i.e. this account can make a billed call that deducts.
    expect(account.tier).to.not.equal('free');
    expect(account.credits_usdt).to.be.greaterThan(0);
  });

  it('INR settlement (no configured product USD value) is booked at the documented approximate rate, not silently as USD', async () => {
    seedAccount(pool, 'sk_dodo_e', { email: 'e@example.com' });
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({ eventType: 'payment.succeeded', paymentId: 'pay_inr', apiKeyHint: 'sk_dodo_e', planProductId: CREDIT_PACK_PRODUCT_ID, customerEmail: 'e@example.com', currency: 'INR', amountMinor: 49900 });
    expect(res.status).to.equal(200);
    const account = pool.state.apiCredits.get('sk_dodo_e');
    // 499 INR at the approx rate must be well under 499 USD-equivalent.
    expect(account.credits_usdt).to.be.lessThan(499);
    expect(account.credits_usdt).to.be.greaterThan(0);
  });

  it('T-1.3: a product with a configured USD value is credited THAT value, ignoring an INR total_amount entirely', async () => {
    process.env.DODO_CREDIT_PACK_USD_VALUES = `${CREDIT_PACK_PRODUCT_ID}:9.90`;
    seedAccount(pool, 'sk_dodo_f', { email: 'f@example.com' });
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({
        eventType: 'payment.succeeded', paymentId: 'pay_configured', apiKeyHint: 'sk_dodo_f',
        planProductId: CREDIT_PACK_PRODUCT_ID, customerEmail: 'f@example.com',
        // Mirrors the real reported payment: INR total_amount 100x the intended
        // USD value. If this were used, the account would be credited ~590 not 9.90.
        currency: 'INR', amountMinor: 58988,
      });
    expect(res.status).to.equal(200);
    expect(res.body.entitled).to.equal(true);
    const account = pool.state.apiCredits.get('sk_dodo_f');
    expect(account.credits_usdt).to.be.closeTo(9.90, 1e-6);
    delete process.env.DODO_CREDIT_PACK_USD_VALUES;
  });

  it('T-1.4: payment.succeeded with NO apiKeyHint (metadata.satelink_account_id missing) → unmatched, not guessed, not auto-created', async () => {
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({
        eventType: 'payment.succeeded', paymentId: 'pay_no_metadata', planProductId: CREDIT_PACK_PRODUCT_ID,
        customerEmail: 'stray@example.com', currency: 'USD', amountMinor: 999_00,
      });
    expect(res.status).to.equal(200);
    expect(res.body.ok).to.equal(true);
    expect(res.body.entitled).to.equal(false);
    expect(res.body.matched).to.equal(false);
    expect(res.body.reason).to.equal('no_account_metadata');
    expect(pool.state.apiCredits.size).to.equal(0); // critically: nothing auto-created
    expect(pool.state.paymentSources.size).to.equal(0);
    expect(pool.state.unmatchedPayments).to.have.length(1);
    expect(pool.state.unmatchedPayments[0].payment_id).to.equal('pay_no_metadata');
    expect(pool.state.unmatchedPayments[0].product_id).to.equal(CREDIT_PACK_PRODUCT_ID);
  });

  it('T-1.4: payment.succeeded with an apiKeyHint that resolves to NO account → unmatched, not guessed by email', async () => {
    // An account DOES exist for this email, under a DIFFERENT key — proves
    // the resolver never falls back to matching by email once a hint is given.
    seedAccount(pool, 'sk_dodo_real_g', { email: 'g@example.com' });
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({
        eventType: 'payment.succeeded', paymentId: 'pay_wrong_hint', apiKeyHint: 'sk_dodo_does_not_exist',
        planProductId: CREDIT_PACK_PRODUCT_ID, customerEmail: 'g@example.com', currency: 'USD', amountMinor: 999_00,
      });
    expect(res.status).to.equal(200);
    expect(res.body.entitled).to.equal(false);
    expect(res.body.reason).to.equal('account_not_found');
    expect(pool.state.apiCredits.get('sk_dodo_real_g').credits_usdt).to.equal(0); // untouched
    expect(pool.state.unmatchedPayments).to.have.length(1);
  });

  it('T-1.4: a repeated unmatched delivery for the same payment_id does not duplicate the unmatched_payments row', async () => {
    const payload = { eventType: 'payment.succeeded', paymentId: 'pay_retry', planProductId: CREDIT_PACK_PRODUCT_ID, customerEmail: 'h@example.com', currency: 'USD', amountMinor: 500_00 };
    await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET).send(payload);
    await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET).send(payload);
    expect(pool.state.unmatchedPayments).to.have.length(1);
  });

  it('a bare test-webhook payload with no amount fields is declined (200), not a 500 CHECK-constraint crash', async () => {
    seedAccount(pool, 'sk_dodo_i');
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({ eventType: 'payment.succeeded', paymentId: 'pay_bare_test', apiKeyHint: 'sk_dodo_i', planProductId: CREDIT_PACK_PRODUCT_ID, customerEmail: 'i@example.com' });
    expect(res.status).to.equal(200);
    expect(res.body.ok).to.equal(true);
    expect(res.body.entitled).to.equal(false);
    expect(res.body.reason).to.equal('non_positive_amount');
    expect(pool.state.paymentSources.size).to.equal(0);
    expect(pool.state.revenueEvents).to.have.length(0);
  });
});

describe('POST /internal/dodo/credit — product allowlist (money-leak fix)', () => {
  let pool, app;
  const prevSecret = process.env.DODO_INTERNAL_SECRET;
  const prevAllowlist = process.env.DODO_CREDIT_PACK_PRODUCT_IDS;
  before(() => { process.env.DODO_INTERNAL_SECRET = SECRET; });
  after(() => {
    process.env.DODO_INTERNAL_SECRET = prevSecret;
    process.env.DODO_CREDIT_PACK_PRODUCT_IDS = prevAllowlist;
  });

  beforeEach(() => {
    pool = makePool();
    app = buildApp(pool);
  });

  it('allowlisted product credits normally', async () => {
    process.env.DODO_CREDIT_PACK_PRODUCT_IDS = CREDIT_PACK_PRODUCT_ID;
    seedAccount(pool, 'sk_dodo_allow1', { email: 'allow@example.com' });
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({
        eventType: 'payment.succeeded', paymentId: 'pay_allow_1', apiKeyHint: 'sk_dodo_allow1', planProductId: CREDIT_PACK_PRODUCT_ID,
        customerEmail: 'allow@example.com', currency: 'USD', amountMinor: 499_00,
      });
    expect(res.status).to.equal(200);
    expect(res.body.entitled).to.equal(true);
    expect(pool.state.paymentSources.has('dodo:pay_allow_1')).to.equal(true);
  });

  it('a tasks/lead-gen product id (not in the allowlist) does NOT credit, logs, and returns 200', async () => {
    process.env.DODO_CREDIT_PACK_PRODUCT_IDS = CREDIT_PACK_PRODUCT_ID;
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({
        eventType: 'payment.succeeded', paymentId: 'pay_tasks_1', planProductId: 'prod_tasks_leadgen',
        customerEmail: 'buyer@example.com', currency: 'USD', amountMinor: 500_00,
      });
    expect(res.status).to.equal(200);
    expect(res.body.ok).to.equal(true);
    expect(res.body.entitled).to.equal(false);
    expect(res.body.reason).to.equal('product_not_allowlisted');
    expect(pool.state.paymentSources.size).to.equal(0);
    expect(pool.state.revenueEvents).to.have.length(0);
    expect(pool.state.apiCredits.size).to.equal(0);
  });

  it('a payment.succeeded with no planProductId at all does NOT credit', async () => {
    process.env.DODO_CREDIT_PACK_PRODUCT_IDS = CREDIT_PACK_PRODUCT_ID;
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({ eventType: 'payment.succeeded', paymentId: 'pay_no_product', customerEmail: 'buyer2@example.com', currency: 'USD', amountMinor: 500_00 });
    expect(res.status).to.equal(200);
    expect(res.body.entitled).to.equal(false);
    expect(pool.state.apiCredits.size).to.equal(0);
  });

  it('unset allowlist fails closed — grants nothing even for what would be a legitimate product id', async () => {
    delete process.env.DODO_CREDIT_PACK_PRODUCT_IDS;
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({
        eventType: 'payment.succeeded', paymentId: 'pay_unset', planProductId: CREDIT_PACK_PRODUCT_ID,
        customerEmail: 'buyer3@example.com', currency: 'USD', amountMinor: 500_00,
      });
    expect(res.status).to.equal(200);
    expect(res.body.entitled).to.equal(false);
    expect(res.body.reason).to.equal('product_not_allowlisted');
    expect(pool.state.paymentSources.size).to.equal(0);
    expect(pool.state.apiCredits.size).to.equal(0);
  });

  it('empty-string allowlist also fails closed', async () => {
    process.env.DODO_CREDIT_PACK_PRODUCT_IDS = '';
    const res = await request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET)
      .send({
        eventType: 'payment.succeeded', paymentId: 'pay_empty', planProductId: CREDIT_PACK_PRODUCT_ID,
        customerEmail: 'buyer4@example.com', currency: 'USD', amountMinor: 500_00,
      });
    expect(res.status).to.equal(200);
    expect(res.body.entitled).to.equal(false);
    expect(pool.state.apiCredits.size).to.equal(0);
  });
});

describe('POST /internal/dodo/resolve-account (T-1.4: pre-payment account provisioning)', () => {
  let pool, app;
  const prevSecret = process.env.DODO_INTERNAL_SECRET;
  before(() => { process.env.DODO_INTERNAL_SECRET = SECRET; });
  after(() => { process.env.DODO_INTERNAL_SECRET = prevSecret; });

  beforeEach(() => {
    pool = makePool();
    app = buildApp(pool);
  });

  it('missing secret → 401', async () => {
    const res = await request(app).post('/internal/dodo/resolve-account').send({ email: 'x@example.com' });
    expect(res.status).to.equal(401);
  });

  it('missing email and apiKeyHint → 400', async () => {
    const res = await request(app).post('/internal/dodo/resolve-account').set('x-dodo-internal-secret', SECRET).send({});
    expect(res.status).to.equal(400);
  });

  it('invalid email → 400', async () => {
    const res = await request(app).post('/internal/dodo/resolve-account').set('x-dodo-internal-secret', SECRET).send({ email: 'not-an-email' });
    expect(res.status).to.equal(400);
  });

  it('new email provisions a fresh account', async () => {
    const res = await request(app).post('/internal/dodo/resolve-account').set('x-dodo-internal-secret', SECRET).send({ email: 'new@example.com' });
    expect(res.status).to.equal(200);
    expect(res.body.ok).to.equal(true);
    expect(res.body.created).to.equal(true);
    expect(res.body.apiKey).to.match(/^sk_dodo_/);
    expect(pool.state.apiCredits.get(res.body.apiKey).email).to.equal('new@example.com');
  });

  it('same email twice resolves the SAME account, does not create a second one', async () => {
    const first = await request(app).post('/internal/dodo/resolve-account').set('x-dodo-internal-secret', SECRET).send({ email: 'repeat@example.com' });
    const second = await request(app).post('/internal/dodo/resolve-account').set('x-dodo-internal-secret', SECRET).send({ email: 'repeat@example.com' });
    expect(second.body.apiKey).to.equal(first.body.apiKey);
    expect(second.body.created).to.equal(false);
    expect(pool.state.apiCredits.size).to.equal(1);
  });

  it('an existing apiKeyHint resolves that exact account, ignoring email', async () => {
    seedAccount(pool, 'sk_dodo_existing', { email: 'old@example.com' });
    const res = await request(app).post('/internal/dodo/resolve-account').set('x-dodo-internal-secret', SECRET)
      .send({ email: 'different@example.com', apiKeyHint: 'sk_dodo_existing' });
    expect(res.body.apiKey).to.equal('sk_dodo_existing');
    expect(res.body.created).to.equal(false);
    expect(pool.state.apiCredits.size).to.equal(1); // no new account for the "different" email
  });
});
