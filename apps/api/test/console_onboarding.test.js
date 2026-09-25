// Console onboarding (CONSOLE_ONBOARDING_V1) — server-side resumable flow on a
// REAL local Postgres: consents (version, time, IP), step order and resume,
// plan → review → Dodo checkout, payment confirmed ONLY by a signed V2 webhook,
// spend protection. Dodo's checkout endpoint is stubbed at the fetch boundary.
// Skipped unless CONSOLE_ACCOUNTS_TEST_DB is set.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import pg from 'pg';

import { createMeRouter } from '../src/console_accounts/router.mjs';
import { __resetSchemaCache, ensureConsoleAccountsSchema } from '../src/console_accounts/schema.mjs';
import { linkKey } from '../src/console_accounts/keys.mjs';
import { __resetOnboardingSchema, LEGAL_DOCS, USE_CASES } from '../src/console_accounts/onboarding.mjs';
import { __resetCatalog, loadCatalog } from '../src/pricing_v2/catalog.mjs';
import { __resetPricingSchema, ensurePricingV2Schema, } from '../src/pricing_v2/schema.mjs';
import { createDodoV2WebhookHandler } from '../src/pricing_v2/webhooks.mjs';

const URL_ = process.env.CONSOLE_ACCOUNTS_TEST_DB;
const here = path.dirname(fileURLToPath(import.meta.url));
const d = URL_ ? describe : describe.skip;
const SECRET = 'whsec_' + Buffer.from('satelink-onboarding-test-secret!').toString('base64');
const ENV = {
  CONSOLE_ONBOARDING_V1: 'true', SATELINK_PLAN_BILLING_V2_ENABLED: 'true', DODO_MODE: 'test',
  DODO_API_KEY_TEST: 'test-key-not-real', DODO_WEBHOOK_SECRET: SECRET,
};

d('console onboarding — server-side, resumable (real Postgres)', function () {
  this.timeout(30000);
  let pool;
  let app;
  let cat;
  const saved = {};
  const realFetch = globalThis.fetch;
  const checkouts = [];
  const schema = `onb_${Date.now()}`;

  const as = (acct, name = 'Asha Rao') => ({
    get: (p) => request(app).get(`/v1/me${p}`).set('x-test-account', acct).set('x-test-name', name),
    post: (p, body = {}) => request(app).post(`/v1/me${p}`).set('x-test-account', acct).set('x-test-name', name)
      .set('X-Satelink-Console', '1').set('X-Satelink-Client-IP', '203.0.113.9').set('X-Satelink-Client-UA', 'e2e-browser/1').send(body),
  });
  const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
  const ACCOUNT_OK = { termsAup: true, age18: true, dpdp: true, productUpdates: false };

  function sign(id, ts, body) {
    return 'v1,' + crypto.createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  }
  async function webhook(type, data) {
    const body = JSON.stringify({ type, business_id: 'bus_test', timestamp: new Date().toISOString(), data });
    const id = `msg_${crypto.randomUUID()}`;
    const ts = Math.floor(Date.now() / 1000);
    return request(app).post('/webhooks/dodo/v2').set('content-type', 'application/json')
      .set('webhook-id', id).set('webhook-timestamp', String(ts)).set('webhook-signature', sign(id, ts, body)).send(body);
  }

  before(async () => {
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname));
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
    const admin = new pg.Pool({ connectionString: URL_ });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_, options: `-c search_path=${schema}`, max: 10 });
    await pool.query(fs.readFileSync(path.join(here, 'schema', 'billing_test_schema.sql'), 'utf8'));
    await pool.query(`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT, "updatedAt" TIMESTAMPTZ);
                      INSERT INTO "user" (id, email, name) VALUES ('acct_a', 'a@example.test', 'Asha Rao'), ('acct_b', 'b@example.test', 'Ben'), ('acct_old', 'o@example.test', 'Old');
                      ALTER TABLE revenue_events_v2 ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT TRUE;`);
    delete process.env.PLAN_CATALOG_PATH;
    __resetCatalog(); __resetSchemaCache(); __resetPricingSchema(); __resetOnboardingSchema();
    await ensureConsoleAccountsSchema(pool);
    await ensurePricingV2Schema(pool);
    cat = loadCatalog();

    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://test.dodopayments.com/checkouts')) {
        const body = JSON.parse(init.body);
        checkouts.push(body);
        return new Response(JSON.stringify({ checkout_url: 'https://test.checkout.dodopayments.com/session/cks_test_1', session_id: `cks_${checkouts.length}` }), { status: 200 });
      }
      return realFetch(url, init);
    };

    app = express();
    app.set('trust proxy', false);
    app.post('/webhooks/dodo/v2', express.raw({ type: '*/*' }), createDodoV2WebhookHandler(pool, { secret: () => SECRET, ledger: { write: async () => {}, reverse: async () => {} }, mode: 'test', logger: { error() {} } }));
    app.use('/v1/me', createMeRouter(pool, {
      resolveSession: async (req) => (req.get('x-test-account') ? { accountId: req.get('x-test-account'), email: `${req.get('x-test-account')}@example.test`, name: req.get('x-test-name') } : null),
      logger: { error() {}, warn() {} },
    }));
  });

  after(async () => {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await pool?.end();
  });

  it('is off unless CONSOLE_ONBOARDING_V1=true', async () => {
    delete process.env.CONSOLE_ONBOARDING_V1;
    try { assert.equal((await as('acct_a').get('/onboarding')).status, 404); } finally { process.env.CONSOLE_ONBOARDING_V1 = 'true'; }
  });

  it('a new account starts at "account", name prefilled from the sign-in profile', async () => {
    const r = await as('acct_a').get('/onboarding');
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.data.step, r.body.data.displayName, r.body.data.legacy], ['account', 'Asha Rao', false]);
  });

  it('required consents are enforced; product updates must be an explicit choice', async () => {
    for (const [miss, code] of [['termsAup', 'terms_required'], ['age18', 'age_required'], ['dpdp', 'dpdp_required']]) {
      const r = await as('acct_a').post('/onboarding/account', { ...ACCOUNT_OK, [miss]: false });
      assert.deepEqual([r.status, r.body.error], [400, code]);
    }
    const { productUpdates, ...noChoice } = ACCOUNT_OK;
    assert.equal((await as('acct_a').post('/onboarding/account', noChoice)).body.error, 'product_updates_choice');
    assert.deepEqual(await q('SELECT count(*)::int n FROM consent_records'), [{ n: 0 }], 'nothing stored on a refused submit');
  });

  it('stores one consent record per purpose with document version, time, forwarded IP and UA', async () => {
    const r = await as('acct_a').post('/onboarding/account', ACCOUNT_OK);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.step, 'name');
    const rows = await q(`SELECT purpose, granted, document, document_version v, ip, ip_source, user_agent, created_at FROM consent_records WHERE account_id = 'acct_a' ORDER BY id`);
    assert.deepEqual(rows.map((x) => [x.purpose, x.granted, x.document, x.v]), [
      ['terms', true, 'terms', '2.0'],
      ['acceptable_use', true, 'acceptable-use', '2.0'],
      ['age_18_plus', true, 'terms', '2.0'],
      ['dpdp_processing', true, 'privacy', '2.0'],
      ['product_updates', false, 'privacy', '2.0'],
    ]);
    for (const x of rows) {
      assert.deepEqual([x.ip, x.ip_source, x.user_agent], ['203.0.113.9', 'console_forwarded', 'e2e-browser/1']);
      assert.ok(x.created_at instanceof Date);
    }
    assert.equal(r.body.data.consents.product_updates.granted, false);
  });

  it('steps cannot be skipped', async () => {
    const r = await as('acct_a').post('/onboarding/review', { authoriseRecurring: true });
    assert.deepEqual([r.status, r.body.error], [409, 'step_not_reached']);
  });

  it('name updates the profile; use case sets the recommended plan and suggested tasks', async () => {
    assert.equal((await as('acct_a').post('/onboarding/name', { name: '  ' })).body.error, 'invalid_name');
    const n = await as('acct_a').post('/onboarding/name', { name: 'Asha  R.' });
    assert.equal(n.body.data.step, 'use');
    assert.deepEqual(await q(`SELECT name FROM "user" WHERE id = 'acct_a'`), [{ name: 'Asha R.' }]);
    assert.equal((await as('acct_a').post('/onboarding/use', { useCase: 'automated_trading', firstTask: 'rpc' })).body.error, 'invalid_first_task');
    const u = await as('acct_a').post('/onboarding/use', { useCase: 'automated_trading', firstTask: 'market-data' });
    assert.deepEqual([u.body.data.step, u.body.data.recommendedPlan, u.body.data.suggestedTasks], ['plan', 'pro', USE_CASES.automated_trading.tasks]);
  });

  it('resumes from the server on any browser (same account, no client state)', async () => {
    const r = await as('acct_a').get('/onboarding');
    assert.deepEqual([r.body.data.step, r.body.data.displayName, r.body.data.useCase, r.body.data.firstTask], ['plan', 'Asha R.', 'automated_trading', 'market-data']);
  });

  it('plan: Launch has no yearly; Pro yearly → review', async () => {
    const l = await as('acct_a').post('/onboarding/plan', { planId: 'launch', period: 'year' });
    assert.deepEqual([l.status, l.body.error], [400, 'no_yearly']);
    const p = await as('acct_a').post('/onboarding/plan', { planId: 'pro', period: 'year' });
    assert.deepEqual([p.body.data.step, p.body.data.itemId, p.body.data.period], ['review', 'pro_yearly', 'year']);
  });

  it('review requires the recurring-charge authorisation, records it, then hands off to Dodo', async () => {
    assert.equal((await as('acct_a').post('/onboarding/review', { authoriseRecurring: false })).body.error, 'authorisation_required');
    assert.equal((await as('acct_a').post('/onboarding/review', { authoriseRecurring: true, returnUrl: 'https://evil.example/x' })).body.error, 'invalid_return_url');
    const r = await as('acct_a').post('/onboarding/review', { authoriseRecurring: true, returnUrl: 'http://localhost:3413/welcome?checkout=done' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.data.checkoutUrl, /^https:\/\/test\.checkout\.dodopayments\.com\//);
    assert.equal(checkouts.at(-1).product_cart[0].product_id, cat.plans.find((x) => x.id === 'pro_yearly').dodo.test);
    assert.equal(checkouts.at(-1).metadata.satelink_user_id, 'acct_a');
    const [c] = await q(`SELECT granted, document, document_version v, detail, ip FROM consent_records WHERE account_id = 'acct_a' AND purpose = 'recurring_charges'`);
    assert.deepEqual([c.granted, c.document, c.v, c.detail.itemId, c.detail.priceUsd, c.detail.interval, c.ip], [true, 'billing-policy', '1.0', 'pro_yearly', 190, 'year', '203.0.113.9']);
  });

  it('coming back from Dodo is PENDING until the webhook lands — the return URL confirms nothing', async () => {
    const r = await as('acct_a').get('/onboarding');
    assert.deepEqual([r.body.data.step, r.body.data.payment], ['payment', 'pending']);
  });

  it('a signed subscription.active webhook confirms it and moves on to safety', async () => {
    const product = cat.plans.find((x) => x.id === 'pro_yearly').dodo.test;
    const w = await webhook('subscription.active', { subscription_id: 'sub_onb_1', product_id: product, next_billing_date: new Date(Date.now() + 365 * 864e5).toISOString(), metadata: { satelink_checkout: 'v2', satelink_user_id: 'acct_a', satelink_product_id: 'pro_yearly', satelink_plan_version: cat.version } });
    assert.equal(w.body.outcome, 'entitlement_active', JSON.stringify(w.body));
    const r = await as('acct_a').get('/onboarding');
    assert.deepEqual([r.body.data.payment, r.body.data.step], ['confirmed', 'safety']);
  });

  it('safety: both acknowledgements required; the spend cap lands in account settings; then done', async () => {
    assert.equal((await as('acct_a').post('/onboarding/safety', { dataAck: true, spendCap: { enabled: true, amountUsd: 25 } })).body.error, 'advice_ack_required');
    assert.equal((await as('acct_a').post('/onboarding/safety', { adviceAck: true, dataAck: true, spendCap: { enabled: true, amountUsd: 0 } })).body.error, 'invalid_spend_cap');
    const r = await as('acct_a').post('/onboarding/safety', { adviceAck: true, dataAck: true, spendCap: { enabled: true, amountUsd: 25 } });
    assert.equal(r.body.data.step, 'done');
    assert.ok(r.body.data.completedAt);
    assert.equal((await as('acct_a').get('/settings')).body.data.monthlySpendCapUsdt, 25);
    assert.equal((await as('acct_a').post('/onboarding/name', { name: 'X' })).body.error, 'onboarding_complete');
  });

  it('Free path skips review and payment; spend protection can be switched off', async () => {
    const b = as('acct_b', 'Ben');
    await b.post('/onboarding/account', { ...ACCOUNT_OK, productUpdates: true });
    await b.post('/onboarding/name', { name: 'Ben' });
    await b.post('/onboarding/use', { useCase: 'research', firstTask: 'explore' });
    const p = await b.post('/onboarding/plan', { planId: 'free' });
    assert.deepEqual([p.body.data.step, p.body.data.itemId, p.body.data.recommendedPlan], ['safety', 'free', 'free']);
    const s = await b.post('/onboarding/safety', { adviceAck: true, dataAck: true, spendCap: { enabled: false } });
    assert.equal(s.body.data.step, 'done');
    assert.equal((await b.get('/settings')).body.data.monthlySpendCapUsdt, null);
    assert.equal((await q(`SELECT granted FROM consent_records WHERE account_id = 'acct_b' AND purpose = 'product_updates'`))[0].granted, true);
  });

  it('from review the customer can go back and choose another plan', async () => {
    const c = as('acct_c', 'Cy');
    await c.post('/onboarding/account', ACCOUNT_OK);
    await c.post('/onboarding/name', { name: 'Cy' });
    await c.post('/onboarding/use', { useCase: 'ai_agent', firstTask: 'agent-access' });
    assert.equal((await c.post('/onboarding/plan', { planId: 'launch', period: 'month' })).body.data.step, 'review');
    const back = await c.post('/onboarding/back', { to: 'plan' });
    assert.equal(back.body.data.step, 'plan');
    assert.equal((await c.post('/onboarding/back', { to: 'done' })).body.error, 'invalid_back');
  });

  it('an account that already had keys only records consent and safety', async () => {
    const oldKey = 'sk_basic_' + 'e'.repeat(48);
    await pool.query(`INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt, status) VALUES ($1, 'basic', 1000, 0, 'active')`, [oldKey]);
    await linkKey(pool, 'acct_old', { apiKey: oldKey });
    const o = as('acct_old', 'Old');
    assert.equal((await o.get('/onboarding')).body.data.legacy, true);
    assert.equal((await o.post('/onboarding/account', ACCOUNT_OK)).body.data.step, 'safety');
    assert.equal((await o.post('/onboarding/name', { name: 'Old' })).body.error, 'step_not_applicable');
  });

  it('the data export includes the consent history', async () => {
    const r = await as('acct_a').get('/export');
    assert.deepEqual(r.body.data.consents.map((x) => x.purpose), ['terms', 'acceptable_use', 'age_18_plus', 'dpdp_processing', 'product_updates', 'recurring_charges']);
  });

  it('consent document versions match the published legal pages', () => {
    const legal = fs.readFileSync(path.join(here, '..', '..', 'web', 'src', 'lib', 'legal.ts'), 'utf8');
    for (const [slug, doc] of Object.entries(LEGAL_DOCS)) {
      const m = legal.match(new RegExp(`slug: "${slug}",\\s*title: "[^"]+",\\s*version: "([^"]+)"`));
      assert.ok(m, `${slug} not found in legal.ts`);
      assert.equal(doc.version, m[1], `${slug} version`);
    }
  });
});
