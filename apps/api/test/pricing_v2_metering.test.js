// Pricing V2 — UU metering in the live metering path (real local Postgres).
// Skipped unless CONSOLE_ACCOUNTS_TEST_DB is set (see console_accounts.test.js).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { authorizeAndMeter } from '../src/billing/credit_service.mjs';
import { __resetSchemaCache, ensureConsoleAccountsSchema } from '../src/console_accounts/schema.mjs';
import { linkKey } from '../src/console_accounts/keys.mjs';
import { updateSettings } from '../src/console_accounts/settings.mjs';
import { __resetCatalog, loadCatalog } from '../src/pricing_v2/catalog.mjs';
import { __resetPricingSchema, ensurePricingV2Schema } from '../src/pricing_v2/schema.mjs';

const URL_ = process.env.CONSOLE_ACCOUNTS_TEST_DB;
const here = path.dirname(fileURLToPath(import.meta.url));
const d = URL_ ? describe : describe.skip;

d('Pricing V2 — UU metering', function () {
  this.timeout(30000);
  let pool;
  const schema = `pv2_test_${Date.now()}`;
  const TI = { methodPrice: 0.01, product: 'intelligence' };
  let n = 0;

  before(async () => {
    assert.ok(['127.0.0.1', 'localhost'].includes(new URL(URL_).hostname));
    const admin = new pg.Pool({ connectionString: URL_ });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_, options: `-c search_path=${schema}`, max: 40 });
    await pool.query(fs.readFileSync(path.join(here, 'schema', 'billing_test_schema.sql'), 'utf8'));
    await pool.query(`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT)`);
    // Small allowances so windows are easy to hit: TI request = 10 UU.
    const cat = JSON.parse(fs.readFileSync(path.join(here, '..', 'config', 'plan_catalog.v2.json'), 'utf8'));
    cat.plans.find((p) => p.id === 'free').allowance = { session_uu: 20, weekly_uu: 40 };
    cat.plans.find((p) => p.id === 'pro').allowance = { session_uu: 50, weekly_uu: 60 };
    const f = path.join(os.tmpdir(), `catalog-${Date.now()}.json`);
    fs.writeFileSync(f, JSON.stringify(cat));
    process.env.PLAN_CATALOG_PATH = f;
    __resetCatalog();
    __resetSchemaCache();
    __resetPricingSchema();
    await ensureConsoleAccountsSchema(pool);
    await ensurePricingV2Schema(pool);
    process.env.CONSOLE_ACCOUNTS_V1 = 'true';
    process.env.SATELINK_USAGE_LIMITS_V2_ENABLED = 'true';
  });

  after(async () => {
    delete process.env.CONSOLE_ACCOUNTS_V1;
    delete process.env.SATELINK_USAGE_LIMITS_V2_ENABLED;
    delete process.env.PLAN_CATALOG_PATH;
    __resetCatalog();
    await pool?.end();
  });

  async function account({ credits = 1, plan = null, pack = 0, autoUse = true } = {}) {
    const id = `acct_${++n}_${Date.now()}`;
    await pool.query(`INSERT INTO "user" VALUES ($1, 'x@example.test')`, [id]);
    const key = `sk_basic_${id.replace(/\W/g, '')}${'0'.repeat(20)}`;
    await pool.query(`INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt) VALUES ($1, 'basic', 1000000, $2)`, [key, credits]);
    await linkKey(pool, id, { apiKey: key });
    if (plan) await pool.query(`INSERT INTO pv2_entitlements (account_id, plan_id, catalog_version, session_uu, weekly_uu, status) VALUES ($1, $2, 't', $3, $4, 'active')`, [id, plan.id, plan.session, plan.weekly]);
    if (pack) await pool.query(`INSERT INTO pv2_pack_balances (account_id, uu_balance) VALUES ($1, $2)`, [id, pack]);
    if (!autoUse) await updateSettings(pool, id, { creditAutoUse: false });
    return { id, key };
  }
  const credits = async (key) => Number((await pool.query('SELECT credits_usdt FROM api_credits WHERE api_key = $1', [key])).rows[0].credits_usdt);
  const buckets = async (id) => (await pool.query('SELECT bucket, COUNT(*)::int n, SUM(uu)::int uu FROM pv2_usage_ledger WHERE account_id = $1 GROUP BY bucket ORDER BY bucket', [id])).rows;

  it('free allowance first, then credits; covered calls report cost 0', async () => {
    const a = await account({ credits: 1 });
    const r1 = await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    const r2 = await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    assert.deepEqual([r1.ok, r1.cost, r1.uu.bucket], [true, 0, 'plan']);
    assert.equal(r2.uu.bucket, 'plan');
    const r3 = await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    assert.deepEqual([r3.ok, r3.cost, r3.uu.bucket], [true, 0.01, 'credits']);
    assert.equal(await credits(a.key), 0.99);
    assert.deepEqual(await buckets(a.id), [{ bucket: 'credits', n: 1, uu: 10 }, { bucket: 'plan', n: 2, uu: 20 }]);
    const led = (await pool.query('SELECT pricing_version, meter, native_units FROM pv2_usage_ledger WHERE account_id = $1 LIMIT 1', [a.id])).rows[0];
    assert.equal(led.meter, 'intelligence_request');
    assert.equal(led.pricing_version, loadCatalog().version); // stamped with the catalog in force
  });

  it('auto-use off: hard stop with wait / enable credits / upgrade actions, nothing deducted', async () => {
    const a = await account({ credits: 1, autoUse: false });
    await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    const r = await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    assert.deepEqual([r.ok, r.code, r.http, r.window, r.terminal], [false, 'usage_limit_reached', 402, 'session', true]);
    assert.deepEqual(r.actions.map((x) => x.action), ['wait', 'enable_credits', 'upgrade']);
    assert.ok(r.actions[0].until);
    assert.equal(await credits(a.key), 1);
  });

  it('pack UU is used after the plan window, before credits', async () => {
    const a = await account({ credits: 1, pack: 20 });
    for (let i = 0; i < 4; i++) await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    const pack = (await pool.query('SELECT uu_balance FROM pv2_pack_balances WHERE account_id = $1', [a.id])).rows[0].uu_balance;
    assert.equal(Number(pack), 0);
    assert.equal(await credits(a.key), 1, 'plan + pack covered all four');
    const r5 = await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    assert.equal(r5.uu.bucket, 'credits');
  });

  it('session cap holds exactly under 30 concurrent requests (auto-use off)', async () => {
    const a = await account({ credits: 1, plan: { id: 'pro', session: 50, weekly: 60 }, autoUse: false });
    const res = await Promise.all(Array.from({ length: 30 }, () => authorizeAndMeter(pool, { apiKey: a.key, ...TI })));
    assert.equal(res.filter((r) => r.ok).length, 5);
    assert.ok(res.filter((r) => !r.ok).every((r) => r.code === 'usage_limit_reached'));
    assert.deepEqual(await buckets(a.id), [{ bucket: 'plan', n: 5, uu: 50 }]);
    assert.equal(await credits(a.key), 1);
  });

  it('weekly window binds when it is tighter than the session', async () => {
    const a = await account({ credits: 1, plan: { id: 'pro', session: 100, weekly: 30 }, autoUse: false });
    for (let i = 0; i < 3; i++) assert.equal((await authorizeAndMeter(pool, { apiKey: a.key, ...TI })).ok, true);
    const r = await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    assert.equal(r.window, 'weekly');
  });

  it('an entitlement on hold falls back to Free', async () => {
    const a = await account({ credits: 0, plan: { id: 'pro', session: 1000, weekly: 1000 }, autoUse: false });
    await pool.query(`UPDATE pv2_entitlements SET status = 'on_hold' WHERE account_id = $1`, [a.id]);
    const ok = await Promise.all(Array.from({ length: 5 }, () => authorizeAndMeter(pool, { apiKey: a.key, ...TI })));
    assert.equal(ok.filter((r) => r.ok).length, 2, 'Free session is 20 UU = 2 calls');
  });

  it('RPC never draws on Dodo-funded UU (payments boundary)', async () => {
    const a = await account({ credits: 1, pack: 1000 });
    const r = await authorizeAndMeter(pool, { apiKey: a.key, product: 'rpc' });
    assert.equal(r.cost, 0.00003);
    assert.equal(r.uu, undefined);
    assert.deepEqual(await buckets(a.id), []);
  });

  it('70/85/95/100% notices are recorded once per window', async () => {
    const a = await account({ credits: 0, plan: { id: 'pro', session: 100, weekly: 1000 }, autoUse: false });
    for (let i = 0; i < 12; i++) await authorizeAndMeter(pool, { apiKey: a.key, ...TI });
    const rows = (await pool.query(`SELECT threshold FROM pv2_usage_notices WHERE account_id = $1 AND win = 'session' ORDER BY threshold`, [a.id])).rows.map((r) => r.threshold);
    assert.deepEqual(rows, [70, 85, 95, 100]);
  });
});
