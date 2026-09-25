// Pricing V2 — Dodo test-mode lifecycle through the real webhook route and a
// real local Postgres. Events are Standard-Webhooks-signed exactly as Dodo
// signs them, using the catalog's real TEST-mode product ids. Skipped unless
// CONSOLE_ACCOUNTS_TEST_DB is set.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';

import { authorizeAndMeter } from '../src/billing/credit_service.mjs';
import { __resetSchemaCache, ensureConsoleAccountsSchema } from '../src/console_accounts/schema.mjs';
import { linkKey } from '../src/console_accounts/keys.mjs';
import { __resetCatalog, loadCatalog, publicCatalog } from '../src/pricing_v2/catalog.mjs';
import { __resetPricingSchema, ensurePricingV2Schema } from '../src/pricing_v2/schema.mjs';
import { createDodoV2WebhookHandler, verifyStandardWebhook } from '../src/pricing_v2/webhooks.mjs';
import { createCheckout } from '../src/pricing_v2/checkout.mjs';
import { reconcilePricingV2 } from '../src/pricing_v2/reconcile.mjs';

const URL_ = process.env.CONSOLE_ACCOUNTS_TEST_DB;
const here = path.dirname(fileURLToPath(import.meta.url));
const d = URL_ ? describe : describe.skip;
const SECRET = 'whsec_' + Buffer.from('satelink-test-webhook-secret-32b!').toString('base64');

function sign(id, ts, body) {
  const key = Buffer.from(SECRET.slice(6), 'base64');
  return 'v1,' + crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

d('Pricing V2 — Dodo test-mode lifecycle', function () {
  this.timeout(30000);
  let pool;
  let server;
  let base;
  const schema = `pv2_life_${Date.now()}`;
  const ACCT = 'acct_life';
  let cat;
  const ledgerCalls = [];

  before(async () => {
    const admin = new pg.Pool({ connectionString: URL_ });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_, options: `-c search_path=${schema}`, max: 20 });
    await pool.query(fs.readFileSync(path.join(here, 'schema', 'billing_test_schema.sql'), 'utf8'));
    await pool.query(`
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT);
      INSERT INTO "user" VALUES ('${ACCT}', 'life@example.test');
      ALTER TABLE revenue_events_v2 ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT TRUE;
    `);
    delete process.env.PLAN_CATALOG_PATH;
    __resetCatalog();
    __resetSchemaCache();
    __resetPricingSchema();
    await ensureConsoleAccountsSchema(pool);
    await ensurePricingV2Schema(pool);
    cat = loadCatalog();
    process.env.DODO_WEBHOOK_SECRET = SECRET;
    process.env.DODO_MODE = 'test';

    const app = express();
    // The SHIPPED handler, with an observable ledger (the real writer skips test data).
    const ledger = { write: async (_p, e) => ledgerCalls.push(['write', e]), reverse: async (_p, e) => ledgerCalls.push(['reverse', e]) };
    app.post('/webhooks/dodo/v2', express.raw({ type: '*/*' }), createDodoV2WebhookHandler(pool, { secret: () => SECRET, ledger, mode: 'test', logger: { error() {} } }));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    delete process.env.DODO_WEBHOOK_SECRET;
    delete process.env.DODO_MODE;
    await pool?.end();
  });

  let seq = 0;
  async function send(type, data, { id = `msg_${++seq}_${Date.now()}`, ts = Math.floor(Date.now() / 1000), badSig = false } = {}) {
    const body = JSON.stringify({ type, business_id: 'bus_test', timestamp: new Date().toISOString(), data });
    const r = await fetch(`${base}/webhooks/dodo/v2`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': badSig ? 'v1,AAAA' : sign(id, ts, body) },
      body,
    });
    return { status: r.status, body: await r.json(), id };
  }
  const product = (id) => cat.plans.concat(cat.packs).find((x) => x.id === id).dodo.test;
  const meta = (id) => ({ satelink_checkout: 'v2', satelink_user_id: ACCT, satelink_product_id: id, satelink_plan_version: cat.version });
  const ent = async () => (await pool.query('SELECT plan_id, status, session_uu, weekly_uu FROM pv2_entitlements WHERE account_id = $1', [ACCT])).rows[0];
  const revenue = async () => (await pool.query(`SELECT request_id, op_type, amount_usdt::float AS amt, is_test_data, is_billable FROM revenue_events_v2 WHERE client_id = $1 ORDER BY id`, ['acct:' + ACCT])).rows;

  it('the catalog carries the real test-mode product ids, Launch = $19 with a $5 first cycle', () => {
    for (const id of ['launch', 'pro', 'max', 'pack_10', 'pack_50', 'pack_200']) assert.match(product(id), /^pdt_/);
    const pub = publicCatalog(cat, { mode: 'test' });
    const launch = pub.plans.find((p) => p.id === 'launch');
    assert.deepEqual([launch.priceUsd, launch.intro.amountUsd, launch.purchasable], [19, 5, true]);
    assert.equal(launch.intro.copy, '$5 for your first month. Renews at $19/month.');
    assert.equal(pub.plans.find((p) => p.id === 'free').purchasable, false);
  });

  it('rejects a bad signature and a stale timestamp', async () => {
    assert.equal((await send('payment.succeeded', {}, { badSig: true })).status, 401);
    assert.equal((await send('payment.succeeded', {}, { ts: Math.floor(Date.now() / 1000) - 3600 })).status, 401);
  });

  it('ignores legacy (non-V2) events entirely', async () => {
    const r = await send('payment.succeeded', { payment_id: 'pay_legacy', total_amount: 999, currency: 'USD', product_cart: [{ product_id: 'pdt_0No6Ru7Y8wFFG8Da7lsOm' }], metadata: { satelink_account_id: 'sk_x' } });
    assert.equal(r.body.outcome, 'ignored_not_v2');
    assert.deepEqual(await revenue(), []);
  });

  it('Launch intro: $5 payment + subscription.active → Pro allowance, revenue $5 (test data), ledger write', async () => {
    const r1 = await send('payment.succeeded', { payment_id: 'pay_intro', subscription_id: 'sub_1', total_amount: 500, currency: 'USD', product_id: product('launch'), metadata: meta('launch') });
    assert.equal(r1.body.outcome, 'plan_payment_recorded');
    const r2 = await send('subscription.active', { subscription_id: 'sub_1', product_id: product('launch'), next_billing_date: new Date(Date.now() + 30 * 864e5).toISOString(), metadata: meta('launch') });
    assert.equal(r2.body.outcome, 'entitlement_active');
    assert.deepEqual(await ent(), { plan_id: 'launch', status: 'active', session_uu: 1500, weekly_uu: 7500 });
    assert.deepEqual(await revenue(), [{ request_id: 'dodo:v2:pay_intro', op_type: 'subscription_payment', amt: 5, is_test_data: true, is_billable: true }]);
    assert.deepEqual(ledgerCalls.at(-1), ['write', { requestId: 'dodo:v2:pay_intro', amountUsdt: 5, isTestData: true, opType: 'dodo_v2' }]);
    const sub = (await pool.query(`SELECT intro FROM pv2_subscriptions WHERE dodo_subscription_id = 'sub_1'`)).rows[0];
    assert.equal(sub.intro, true);
  });

  it('duplicate webhook (same webhook-id) applies nothing', async () => {
    const data = { payment_id: 'pay_dup', subscription_id: 'sub_1', total_amount: 1900, currency: 'USD', product_id: product('launch') };
    const first = await send('payment.succeeded', data, { id: 'msg_dup' });
    const again = await send('payment.succeeded', data, { id: 'msg_dup' });
    assert.equal(again.body.duplicate, true);
    const retried = await send('payment.succeeded', data); // Dodo retry under a NEW id
    assert.equal(retried.body.outcome, 'payment_already_applied');
    assert.equal((await revenue()).filter((r) => r.request_id === 'dodo:v2:pay_dup').length, 1);
    assert.equal(first.body.outcome, 'plan_payment_recorded');
  });

  it('renewal to Pro price: $19 payment + subscription.renewed keeps Pro allowance', async () => {
    await send('payment.succeeded', { payment_id: 'pay_renew', subscription_id: 'sub_1', total_amount: 1900, currency: 'USD', product_id: product('launch') });
    const r = await send('subscription.renewed', { subscription_id: 'sub_1', product_id: product('launch'), next_billing_date: new Date(Date.now() + 60 * 864e5).toISOString() });
    assert.equal(r.body.outcome, 'entitlement_renewed');
    assert.equal((await ent()).status, 'active');
    assert.ok((await revenue()).some((x) => x.request_id === 'dodo:v2:pay_renew' && x.amt === 19));
    const sub = (await pool.query(`SELECT intro FROM pv2_subscriptions WHERE dodo_subscription_id = 'sub_1'`)).rows[0];
    assert.equal(sub.intro, false, 'no longer in the intro cycle');
  });

  it('failed renewal → on_hold; UU falls back to Free until it recovers', async () => {
    const r = await send('subscription.on_hold', { subscription_id: 'sub_1', product_id: product('launch') });
    assert.equal(r.body.outcome, 'entitlement_on_hold');
    assert.equal((await ent()).status, 'on_hold');
    await send('subscription.renewed', { subscription_id: 'sub_1', product_id: product('launch') });
    assert.equal((await ent()).status, 'active');
  });

  it('refund of the renewal → negative, non-billable revenue row; entitlement revoked; ledger reversal', async () => {
    const r = await send('refund.succeeded', { refund_id: 'ref_1', payment_id: 'pay_renew', amount: 1900 });
    assert.equal(r.body.outcome, 'refund_reversed');
    const rev = (await revenue()).find((x) => x.request_id === 'dodo:v2:refund:ref_1');
    assert.deepEqual([rev.amt, rev.op_type, rev.is_billable], [-19, 'refund_reversal', false]);
    assert.equal((await ent()).status, 'revoked');
    assert.deepEqual(ledgerCalls.at(-1), ['reverse', { requestId: 'dodo:v2:refund:ref_1', amountUsdt: 19, isTestData: true }]);
    // A redelivered refund under a new id does not reverse twice.
    await send('refund.succeeded', { refund_id: 'ref_1', payment_id: 'pay_renew', amount: 1900 });
    assert.equal((await revenue()).filter((x) => x.request_id === 'dodo:v2:refund:ref_1').length, 1);
  });

  it('dispute: opened → on hold; lost → reversal', async () => {
    await send('subscription.renewed', { subscription_id: 'sub_1', product_id: product('launch') });
    const o = await send('dispute.opened', { dispute_id: 'dsp_1', payment_id: 'pay_intro', amount: 500 });
    assert.equal(o.body.outcome, 'dispute_hold');
    assert.equal((await ent()).status, 'on_hold');
    const l = await send('dispute.lost', { dispute_id: 'dsp_1', payment_id: 'pay_intro', amount: 500 });
    assert.equal(l.body.outcome, 'dispute_reversed');
    assert.ok((await revenue()).some((x) => x.request_id === 'dodo:v2:dispute:dsp_1' && x.amt === -5));
  });

  it('cancellation → revoked', async () => {
    await send('subscription.renewed', { subscription_id: 'sub_1', product_id: product('launch') });
    const r = await send('subscription.cancelled', { subscription_id: 'sub_1', product_id: product('launch') });
    assert.equal(r.body.outcome, 'entitlement_revoked');
    assert.equal((await ent()).status, 'revoked');
  });

  it('pack purchase grants UU that pays for Trading Intelligence (never RPC)', async () => {
    const r = await send('payment.succeeded', { payment_id: 'pay_pack', total_amount: 5000, currency: 'USD', product_cart: [{ product_id: product('pack_50'), quantity: 1 }], metadata: meta('pack_50') });
    assert.equal(r.body.outcome, 'pack_granted');
    const bal = async () => Number((await pool.query('SELECT uu_balance FROM pv2_pack_balances WHERE account_id = $1', [ACCT])).rows[0].uu_balance);
    assert.equal(await bal(), 50000);
    const key = 'sk_basic_' + 'b'.repeat(48);
    await pool.query(`INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt) VALUES ($1, 'basic', 100000, 0)`, [key]);
    await linkKey(pool, ACCT, { apiKey: key });
    process.env.CONSOLE_ACCOUNTS_V1 = 'true';
    process.env.SATELINK_USAGE_LIMITS_V2_ENABLED = 'true';
    try {
      // Burn the Free window, then the pack pays.
      for (let i = 0; i < 12; i++) await authorizeAndMeter(pool, { apiKey: key, methodPrice: 0.01, product: 'intelligence' });
      assert.equal(await bal(), 50000 - 20);
      const rpc = await authorizeAndMeter(pool, { apiKey: key, product: 'rpc' });
      assert.equal(rpc.ok, false, 'RPC needs crypto credits; the Dodo pack never pays for it');
      assert.equal(rpc.code, 'insufficient_credits');
    } finally {
      delete process.env.CONSOLE_ACCOUNTS_V1;
      delete process.env.SATELINK_USAGE_LIMITS_V2_ENABLED;
    }
  });

  it('checkout: V2 metadata bound to the account; unknown / free items refused', async () => {
    let sent;
    const request = async (mode, method, p, body) => { sent = { mode, method, p, body }; return { checkout_url: 'https://test.checkout.dodopayments.com/x', session_id: 'cks_1' }; };
    const out = await createCheckout({ accountId: ACCT, email: 'life@example.test', itemId: 'launch', returnUrl: 'https://console.satelink.network/billing', mode: 'test', catalog: cat, request });
    assert.equal(out.checkoutUrl, 'https://test.checkout.dodopayments.com/x');
    assert.deepEqual([sent.method, sent.p, sent.body.product_cart[0].product_id], ['POST', '/checkouts', product('launch')]);
    assert.deepEqual(sent.body.metadata, meta('launch'));
    await assert.rejects(createCheckout({ accountId: ACCT, itemId: 'free', mode: 'test', catalog: cat, request }), { code: 'unknown_item' });
    await assert.rejects(createCheckout({ accountId: ACCT, itemId: 'launch', mode: 'live', catalog: cat, request }), { code: 'not_purchasable' });
  });

  it('reconciliation finds missing / mismatched payments', async () => {
    const request = async () => ({ items: [
      { payment_id: 'pay_intro', status: 'succeeded', total_amount: 500, metadata: { satelink_checkout: 'v2' } },
      { payment_id: 'pay_pack', status: 'succeeded', total_amount: 4999, metadata: { satelink_checkout: 'v2' } },
      { payment_id: 'pay_ghost', status: 'succeeded', total_amount: 1900, metadata: { satelink_checkout: 'v2' } },
      { payment_id: 'pay_other', status: 'succeeded', total_amount: 999, metadata: {} },
    ] });
    const r = await reconcilePricingV2(pool, { mode: 'test', request });
    const kinds = r.mismatches.map((m) => `${m.kind}:${m.payment_id}`).sort();
    assert.ok(kinds.includes('missing_locally:pay_ghost'));
    assert.ok(kinds.includes('amount_mismatch:pay_pack'));
    assert.ok(kinds.includes('missing_in_dodo:pay_dup') && kinds.includes('missing_in_dodo:pay_renew'));
    assert.ok(!kinds.some((k) => k.includes('pay_other')), 'non-V2 payments are out of scope');
    const stored = await pool.query('SELECT jsonb_array_length(mismatches) n FROM pv2_reconciliation_runs WHERE id = $1', [r.runId]);
    assert.equal(stored.rows[0].n, r.mismatches.length);
  });
});
