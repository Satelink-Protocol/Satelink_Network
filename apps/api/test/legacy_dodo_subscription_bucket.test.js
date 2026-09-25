// fix/legacy-dodo-subscription-bucket — end to end on a REAL Postgres, with
// the production shape: NO `subscriptions` table (migration 018 not applied).
// Skipped unless CONSOLE_ACCOUNTS_TEST_DB is set (local database only).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import pg from 'pg';

import { createDodoInternalRouter } from '../src/routes/internal_dodo.js';
import { ensureDodoRailSchema } from '../src/db/dodo_rail_schema.js';
import { ensurePlansSchema } from '../src/plans/plans_schema.mjs';
import { authorizeAndMeter } from '../src/billing/credit_service.mjs';

const URL_ = process.env.CONSOLE_ACCOUNTS_TEST_DB;
const d = URL_ ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));
const SECRET = 'test-internal-secret';
const PRO = 'pdt_test_pro_sub';
const PACK = 'pdt_test_pack_10';
const KEY = 'sk_basic_' + 'd'.repeat(48);

d('legacy Dodo webhook: subscriptions → Trading-Intelligence bucket (real Postgres)', function () {
  this.timeout(30000);
  let pool;
  let app;
  const schema = `dodo_sub_${Date.now()}`;
  const env = {};
  const credit = (body) => request(app).post('/internal/dodo/credit').set('x-dodo-internal-secret', SECRET).send(body);
  const reversal = (body) => request(app).post('/internal/dodo/reversal').set('x-dodo-internal-secret', SECRET).send(body);
  const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
  const ent = async () => (await q('SELECT included_calls_total t, included_calls_used u FROM plan_entitlements WHERE api_key = $1', [KEY]))[0];
  const credits = async () => Number((await q('SELECT credits_usdt FROM api_credits WHERE api_key = $1', [KEY]))[0].credits_usdt);
  const TI = { apiKey: KEY, methodPrice: 0.01, product: 'intelligence' };

  before(async () => {
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname));
    for (const [k, v] of Object.entries({ DODO_INTERNAL_SECRET: SECRET, DODO_PRODUCT_PRO_ID: PRO, DODO_CREDIT_PACK_USD_VALUES: `${PACK}:10`, DODO_LEGACY_SUB_BUCKET_ENABLED: 'true' })) { env[k] = process.env[k]; process.env[k] = v; }
    const admin = new pg.Pool({ connectionString: URL_ });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_, options: `-c search_path=${schema}`, max: 30 });
    await pool.query(fs.readFileSync(path.join(here, 'schema', 'billing_test_schema.sql'), 'utf8'));
    await pool.query(`ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS email TEXT, ADD COLUMN IF NOT EXISTS email_consent BOOLEAN DEFAULT false;
                      ALTER TABLE revenue_events_v2 ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT TRUE;
                      CREATE UNIQUE INDEX IF NOT EXISTS rev2_client_op_req ON revenue_events_v2 (client_id, op_type, request_id)`); // as in prod (sql/init.sql)
    const r = await ensureDodoRailSchema(pool, { logger: { log() {}, warn() {}, error() {} }, notifier: () => {} });
    assert.equal(r.ready, true, JSON.stringify(r));
    await ensurePlansSchema(pool);
    assert.equal((await q(`SELECT to_regclass('subscriptions') t`))[0].t, null, 'prod shape: no subscriptions table');
    await pool.query(`INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt, status) VALUES ($1, 'free', 100000, 0, 'active')`, [KEY]);
    app = express();
    app.use(express.json());
    app.use('/internal/dodo', createDodoInternalRouter(pool));
  });

  after(async () => {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    delete process.env.CONSOLE_ACCOUNTS_V1;
    await pool?.end();
  });

  it('flag OFF (default): a first subscription payment is refused exactly as today — no grant, no credits', async () => {
    delete process.env.DODO_LEGACY_SUB_BUCKET_ENABLED;
    try {
      const res = await credit({ eventType: 'payment.succeeded', paymentId: 'pay_sub_off', subscriptionId: 'sub_OFF', planProductId: PRO, apiKeyHint: KEY, currency: 'USD', amountMinor: 1900 });
      assert.deepEqual([res.status, res.body.entitled, res.body.reason], [200, false, 'product_not_allowlisted']);
      assert.equal((await q(`SELECT to_regclass('dodo_subscription_grants') t`))[0].t, null, 'no grants table touched');
      assert.equal(await credits(), 0);
    } finally { process.env.DODO_LEGACY_SUB_BUCKET_ENABLED = 'true'; }
  });

  it('first subscription payment (product not in the pack allowlist) grants the bucket, not credits', async () => {
    const res = await credit({ eventType: 'payment.succeeded', paymentId: 'pay_sub_1', subscriptionId: 'sub_A', planProductId: PRO, apiKeyHint: KEY, currency: 'USD', amountMinor: 1900, customerEmail: 'a@example.test' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.entitled, res.body.bucket, res.body.planId, res.body.includedCalls], [true, 'plan_entitlement', 'pro', 2500]);
    assert.equal(await credits(), 0, 'no fungible credits');
    assert.deepEqual(await ent(), { t: 2500, u: 0 });
    assert.equal((await q(`SELECT tier FROM api_credits WHERE api_key = $1`, [KEY]))[0].tier, 'pro', 'rate-limit tier lifted');
    assert.equal((await q(`SELECT count(*)::int n FROM revenue_events_v2 WHERE request_id = 'dodo:pay_sub_1'`))[0].n, 1, 'revenue still recognised');
  });

  it('Trading Intelligence draws the bucket; RPC cannot', async () => {
    const ti = await authorizeAndMeter(pool, TI);
    assert.deepEqual([ti.ok, ti.cost, ti.bucket?.source], [true, 0, 'plan_entitlement']);
    assert.equal((await ent()).u, 1);
    const rpc = await authorizeAndMeter(pool, { apiKey: KEY, product: 'rpc' });
    assert.deepEqual([rpc.ok, rpc.code], [false, 'insufficient_credits']);
    assert.equal((await ent()).u, 1, 'RPC never touches the bucket');
  });

  it('renewal resolves the account through the earlier grant (no subscriptions table) and resets the period', async () => {
    const res = await credit({ eventType: 'subscription.renewed', subscriptionId: 'sub_A', previousBillingDate: '2026-10-01T00:00:00Z', currency: 'USD', amountMinor: 1900 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.bucket, 'plan_entitlement');
    assert.deepEqual(await ent(), { t: 2500, u: 0 });
    assert.equal(await credits(), 0);
    const dup = await credit({ eventType: 'subscription.renewed', subscriptionId: 'sub_A', previousBillingDate: '2026-10-01T00:00:00Z', currency: 'USD', amountMinor: 1900 });
    assert.equal(dup.status, 409, 'duplicate renewal is idempotent');
  });

  it('one-time packs keep today\'s behaviour (credits)', async () => {
    const res = await credit({ eventType: 'payment.succeeded', paymentId: 'pay_pack_1', planProductId: PACK, apiKeyHint: KEY, currency: 'USD', amountMinor: 1000 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.creditedUsdt, 10);
    assert.equal(await credits(), 10);
  });

  it('dispute on the subscription payment suspends the bucket; winning restores it', async () => {
    // A dispute on a PAST period's payment pauses nothing: that bucket was already replaced by the renewal.
    const stale = await reversal({ eventType: 'dispute.opened', dodoRef: 'dsp_old', paymentId: 'pay_sub_1', amountMinor: 1900, currency: 'USD' });
    assert.deepEqual([stale.status, stale.body.action, stale.body.pausedCalls], [200, 'entitlement_suspended', 0], JSON.stringify(stale.body));
    assert.deepEqual(await ent(), { t: 2500, u: 0 }, 'current period untouched');
    // The current period's payment.
    const paid = await credit({ eventType: 'payment.succeeded', paymentId: 'pay_sub_2', subscriptionId: 'sub_B', planProductId: PRO, apiKeyHint: KEY, currency: 'USD', amountMinor: 1900 });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    await authorizeAndMeter(pool, TI); // 1 used
    const opened = await reversal({ eventType: 'dispute.opened', dodoRef: 'dsp_1', paymentId: 'pay_sub_2', amountMinor: 1900, currency: 'USD' });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.deepEqual([opened.body.funding, opened.body.action, opened.body.pausedCalls], ['entitlement', 'entitlement_suspended', 2499]);
    const during = await authorizeAndMeter(pool, TI);
    assert.equal(during.bucket, undefined, 'suspended bucket not drawn');
    assert.equal(during.cost, 0.01, 'falls back to credits');
    const won = await reversal({ eventType: 'dispute.won', dodoRef: 'dsp_1', paymentId: 'pay_sub_2' });
    assert.equal(won.body.action, 'entitlement_restored');
    assert.equal((await ent()).t - (await ent()).u, 2499);
    assert.equal(await credits(), 9.99, 'no credits clawed by the dispute');
  });

  it('refund of the subscription payment revokes the bucket and books the reversal — credits untouched', async () => {
    const res = await reversal({ eventType: 'refund.succeeded', dodoRef: 'ref_1', paymentId: 'pay_sub_2', amountMinor: 1900, currency: 'USD', isPartial: false });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.action, 'entitlement_revoked');
    const e = await ent();
    assert.equal(e.t - e.u, 0, 'nothing left to draw');
    assert.equal(await credits(), 9.99);
    const rev = await q(`SELECT amount_usdt::float a, is_billable FROM revenue_events_v2 WHERE request_id = 'dodo:refund:ref_1'`);
    assert.deepEqual(rev, [{ a: -19, is_billable: false }]);
  });

  it('a pack refund no longer 500s on the missing subscriptions table', async () => {
    const res = await reversal({ eventType: 'refund.succeeded', dodoRef: 'ref_pack', paymentId: 'pay_pack_1', amountMinor: 1000, currency: 'USD', isPartial: false });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.action, 'refund_full');
    assert.equal(await credits(), 0);
    // $10 refunded against $9.99 left → the existing shortfall rule holds the key (today's behaviour, unchanged).
    assert.equal((await q('SELECT payment_hold FROM api_credits WHERE api_key = $1', [KEY]))[0].payment_hold, true);
    await pool.query('UPDATE api_credits SET payment_hold = false WHERE api_key = $1', [KEY]); // support clears it
  });

  it('20 concurrent TI calls against a 5-call bucket draw exactly 5', async () => {
    await credit({ eventType: 'subscription.renewed', subscriptionId: 'sub_A', previousBillingDate: '2026-11-01T00:00:00Z', currency: 'USD', amountMinor: 1900 });
    await pool.query('UPDATE plan_entitlements SET included_calls_total = 5, included_calls_used = 0 WHERE api_key = $1', [KEY]);
    const res = await Promise.all(Array.from({ length: 20 }, () => authorizeAndMeter(pool, TI)));
    assert.equal(res.filter((r) => r.ok && r.bucket).length, 5);
    assert.equal(res.filter((r) => !r.ok).length, 15, 'rest refused (no credits left)');
    assert.deepEqual(await ent(), { t: 5, u: 5 });
  });

  it('a call refused by owner controls gives its bucket call back', async () => {
    process.env.CONSOLE_ACCOUNTS_V1 = 'true';
    const { ensureConsoleAccountsSchema, __resetSchemaCache } = await import('../src/console_accounts/schema.mjs');
    await pool.query(`CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT)`);
    await pool.query(`INSERT INTO "user" VALUES ('acct_sub', 's@example.test') ON CONFLICT DO NOTHING`);
    __resetSchemaCache();
    await ensureConsoleAccountsSchema(pool);
    const { linkKey } = await import('../src/console_accounts/keys.mjs');
    const { setAgentLimits } = await import('../src/console_accounts/settings.mjs');
    await linkKey(pool, 'acct_sub', { apiKey: KEY });
    await pool.query('UPDATE plan_entitlements SET included_calls_total = 5, included_calls_used = 0 WHERE api_key = $1', [KEY]);
    await setAgentLimits(pool, 'acct_sub', (await q('SELECT id FROM api_credits WHERE api_key = $1', [KEY]))[0].id, { paused: true });
    const r = await authorizeAndMeter(pool, TI);
    assert.equal(r.code, 'agent_paused');
    assert.deepEqual(await ent(), { t: 5, u: 0 }, 'the refused call did not use the allowance');
  });
});
