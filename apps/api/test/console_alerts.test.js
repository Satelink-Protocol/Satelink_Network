// D7 console alerts — preferences, evaluator, de-dup/cooldown, delivery
// outcomes, test send, tenant isolation. Real local Postgres in its own schema
// (same harness as console_accounts.test.js); skipped when
// CONSOLE_ACCOUNTS_TEST_DB is unset. No email is ever sent: every test injects
// a recording `send`.
//
//   CONSOLE_ACCOUNTS_TEST_DB=postgresql://postgres@127.0.0.1:55432/satelink_test \
//     npx mocha --no-config --exit test/console_alerts.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import express from 'express';
import { __resetSchemaCache, ensureConsoleAccountsSchema } from '../src/console_accounts/schema.mjs';
import { linkKey } from '../src/console_accounts/keys.mjs';
import { updateSettings } from '../src/console_accounts/settings.mjs';
import { createMeRouter } from '../src/console_accounts/router.mjs';
import { updateAlertPrefs, getAlerts, evaluateAccount, runAlertsTick, sendTestAlert } from '../src/console_accounts/alerts.mjs';

const URL_ = process.env.CONSOLE_ACCOUNTS_TEST_DB;
const here = path.dirname(fileURLToPath(import.meta.url));
const d = URL_ ? describe : describe.skip;

d('D7 console alerts', function () {
  this.timeout(30000);
  let pool;
  const schema = `alerts_test_${Date.now()}`;
  const A = 'alert_user_a';
  const B = 'alert_user_b';
  const NOW = new Date();
  const TODAY = NOW.toISOString().slice(0, 10);

  // Recording sender: never touches the network.
  let sent;
  const send = async (m) => { sent.push(m); return 'sent'; };
  const env = { RESEND_API_KEY: 'test-only-not-a-key', CONSOLE_PUBLIC_URL: 'https://console.example.test' };

  before(async () => {
    const host = new URL(URL_).hostname;
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'CONSOLE_ACCOUNTS_TEST_DB must be a local database');
    const admin = new pg.Pool({ connectionString: URL_ });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_, options: `-c search_path=${schema}`, max: 10 });
    await pool.query(fs.readFileSync(path.join(here, 'schema', 'billing_test_schema.sql'), 'utf8'));
    await pool.query(`
      ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS email TEXT, ADD COLUMN IF NOT EXISTS frozen_usdt NUMERIC DEFAULT 0 NOT NULL,
        ADD COLUMN IF NOT EXISTS payment_hold BOOLEAN DEFAULT false NOT NULL, ADD COLUMN IF NOT EXISTS dodo_funded_usdt NUMERIC(18,6) NOT NULL DEFAULT 0;
      ALTER TABLE api_deposits ADD COLUMN IF NOT EXISTS credited_usdt NUMERIC(18,6);
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT);
      INSERT INTO "user" VALUES ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
    `);
    __resetSchemaCache();
    await ensureConsoleAccountsSchema(pool);
  });
  after(async () => { await pool?.end(); delete process.env.CONSOLE_ACCOUNTS_V1; });
  beforeEach(async () => {
    sent = [];
    await pool.query('TRUNCATE account_alert_events, account_alert_prefs, account_settings, account_api_keys, api_usage_daily, api_deposits, account_spend_counters CASCADE');
  });

  async function linkedKey(account, { credits = 1, dailyLimit = 1000, deposited = 1, fence = 0, label = 'Bot' } = {}) {
    const key = `sk_basic_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    const r = await pool.query(
      `INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt, total_deposited, dodo_funded_usdt, status)
       VALUES ($1, 'basic', $2, $3, $4, $5, 'active') RETURNING id`,
      [key, dailyLimit, credits, deposited, fence]
    );
    await linkKey(pool, account, { apiKey: key, label });
    return { key, id: r.rows[0].id };
  }
  const usedToday = (key, n) => pool.query(
    `INSERT INTO api_usage_daily (api_key, date, request_count, usdt_spent) VALUES ($1, $2, $3, 0)
     ON CONFLICT (api_key, date) DO UPDATE SET request_count = EXCLUDED.request_count`, [key, TODAY, n]);
  const events = async (account) => (await pool.query(
    'SELECT kind, dedupe_key, delivery, attempts FROM account_alert_events WHERE account_id = $1 ORDER BY id', [account])).rows;

  it('prefs: validated, unknown fields rejected, every change audited', async () => {
    await assert.rejects(updateAlertPrefs(pool, A, { lowBalanceUsdt: -1 }), /lowBalanceUsdt/);
    await assert.rejects(updateAlertPrefs(pool, A, { cooldownMinutes: 5 }), /cooldownMinutes/);
    await assert.rejects(updateAlertPrefs(pool, A, { errorRatePct: 0 }), /errorRatePct/);
    await assert.rejects(updateAlertPrefs(pool, A, { webhook: 'x' }), /Unknown alert setting/);
    const p = await updateAlertPrefs(pool, A, { lowBalanceUsdt: 0.5, cooldownMinutes: 60, errorRatePct: 5 });
    assert.equal(p.lowBalanceUsdt, 0.5);
    assert.equal(p.cooldownMinutes, 60);
    const audit = await pool.query(`SELECT count(*)::int n FROM account_audit WHERE account_id = $1 AND action = 'alerts.update'`, [A]);
    assert.equal(audit.rows[0].n, 1);
  });

  it('usage: sends the highest crossed level once, records lower ones as suppressed, never repeats', async () => {
    const k = await linkedKey(A, { dailyLimit: 1000 });
    await usedToday(k.key, 900); // 90% → crosses 70 and 85
    let c = await evaluateAccount(pool, A, { send, env, usageV2: false });
    assert.deepEqual(c, { suppressed: 1, sent: 1 });
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /85% of its daily request limit/);
    assert.equal(sent[0].to, 'a@example.test');
    assert.ok(!sent[0].text.includes(k.key), 'the full key never appears in an email');
    c = await evaluateAccount(pool, A, { send, env, usageV2: false });
    assert.deepEqual(c, {}, 'second pass: nothing new');
    await usedToday(k.key, 960); // 96% → 95 newly crossed
    c = await evaluateAccount(pool, A, { send, env, usageV2: false });
    assert.deepEqual(c, { sent: 1 });
    assert.match(sent[1].subject, /95%/);
  });

  it('usage alerts respect the Settings switch', async () => {
    const k = await linkedKey(A);
    await usedToday(k.key, 1000);
    await updateSettings(pool, A, { notifications: { email: true, usageAlerts: false, productUpdates: false } });
    assert.deepEqual(await evaluateAccount(pool, A, { send, env, usageV2: false }), {});
  });

  it('monthly spend cap: alert at 100% of the cap', async () => {
    await linkedKey(A);
    await updateSettings(pool, A, { monthlySpendCapUsdt: 2 });
    await pool.query(`INSERT INTO account_spend_counters (scope, scope_id, period, spent_usdt) VALUES ('account_month', $1, to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM'), 2)`, [A]);
    const c = await evaluateAccount(pool, A, { send, env, usageV2: false });
    assert.equal(c.sent, 1);
    assert.match(sent[0].subject, /100% of your monthly spend cap/);
  });

  it('low balance: RPC-spendable credits (Dodo ring-fence excluded), once per cooldown window', async () => {
    await linkedKey(A, { credits: 5, fence: 4.9, deposited: 5 }); // $0.10 spendable for RPC
    await updateAlertPrefs(pool, A, { lowBalanceUsdt: 1, cooldownMinutes: 60 });
    assert.equal((await evaluateAccount(pool, A, { send, env, usageV2: false, now: NOW })).sent, 1);
    assert.match(sent[0].text, /\$0\.10000 of USDT credits left for RPC/);
    assert.deepEqual(await evaluateAccount(pool, A, { send, env, usageV2: false, now: NOW }), {}, 'same window: no repeat');
    const later = new Date(NOW.getTime() + 61 * 60_000);
    assert.equal((await evaluateAccount(pool, A, { send, env, usageV2: false, now: later })).sent, 1, 'next window: alert again');
  });

  it('low balance ignores keys that were never funded', async () => {
    await linkedKey(A, { credits: 0, deposited: 0 });
    await updateAlertPrefs(pool, A, { lowBalanceUsdt: 1 });
    assert.deepEqual(await evaluateAccount(pool, A, { send, env, usageV2: false }), {});
  });

  it('deposit confirmed: one email per deposit transaction', async () => {
    const k = await linkedKey(A);
    await pool.query(`INSERT INTO api_deposits (api_key, tx_hash, amount_usdt, credited_usdt, created_at) VALUES ($1, '0xabc', 10, 10, NOW())`, [k.key]);
    assert.equal((await evaluateAccount(pool, A, { send, env, usageV2: false })).sent, 1);
    assert.match(sent[0].subject, /deposit of \$10\.00 confirmed/);
    assert.deepEqual(await evaluateAccount(pool, A, { send, env, usageV2: false }), {});
  });

  it('error rate is never alerted on (not measured) and the API says so', async () => {
    await updateAlertPrefs(pool, A, { errorRatePct: 1 });
    await evaluateAccount(pool, A, { send, env, usageV2: false });
    const r = await getAlerts(pool, A, { env });
    const rule = r.rules.find((x) => x.kind === 'error_rate');
    assert.equal(rule.status, 'not_measured');
    assert.equal(rule.thresholdPct, 1);
    assert.equal((await events(A)).filter((e) => e.kind === 'error_rate').length, 0);
  });

  it('no sender configured → recorded as skipped_no_sender (visible in history), not silently dropped', async () => {
    const k = await linkedKey(A);
    await usedToday(k.key, 1000);
    const { sendAlertEmail } = await import('../src/console_accounts/alerts.mjs');
    const c = await evaluateAccount(pool, A, { send: sendAlertEmail, env: {}, usageV2: false });
    assert.equal(c.skipped_no_sender, 1);
    assert.equal((await getAlerts(pool, A, { env: {} })).sender.configured, false);
  });

  it('a failed send is recorded with its error and retried later, at most 3 attempts', async () => {
    const k = await linkedKey(A);
    await usedToday(k.key, 1000);
    const boom = async () => { throw new Error('resend 503'); };
    let c = await evaluateAccount(pool, A, { send: boom, env, usageV2: false });
    assert.equal(c.failed, 1);
    c = await evaluateAccount(pool, A, { send, env, usageV2: false });
    assert.equal(c.sent ?? 0, 0, 'no retry within 30 minutes');
    await pool.query(`UPDATE account_alert_events SET last_attempt_at = NOW() - interval '31 minutes' WHERE delivery = 'failed'`);
    c = await evaluateAccount(pool, A, { send, env, usageV2: false });
    assert.equal(c.sent, 1, 'retried after 30 minutes');
    const top = (await events(A)).find((e) => e.dedupe_key.endsWith(':100'));
    assert.equal(top.attempts, 2);
    assert.equal(top.delivery, 'sent');
  });

  it('test alert: sent, recorded, audited, rate-limited to 3 per hour', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await sendTestAlert(pool, { accountId: A, email: 'a@example.test' }, { send, env })).delivery, 'sent');
    await assert.rejects(sendTestAlert(pool, { accountId: A, email: 'a@example.test' }, { send, env }), /3 test alerts per hour/);
    const audit = await pool.query(`SELECT count(*)::int n FROM account_audit WHERE account_id = $1 AND action = 'alerts.test'`, [A]);
    assert.equal(audit.rows[0].n, 3);
  });

  it('evaluator tick is inert without CONSOLE_ACCOUNTS_V1 and processes accounts with it', async () => {
    const k = await linkedKey(A);
    await usedToday(k.key, 1000);
    delete process.env.CONSOLE_ACCOUNTS_V1;
    assert.deepEqual(await runAlertsTick(pool, { send, env, usageV2: false }), { ran: false, reason: 'disabled' });
    process.env.CONSOLE_ACCOUNTS_V1 = 'true';
    const r = await runAlertsTick(pool, { send, env, usageV2: false });
    assert.equal(r.ran, true);
    assert.equal(r.sent, 1);
    assert.equal((await runAlertsTick(pool, { send, env: { ...env, CONSOLE_ALERTS_DISABLED: '1' }, usageV2: false })).ran, false, 'kill switch');
  });

  describe('HTTP /v1/me/alerts', () => {
    let server, base;
    before(async () => {
      process.env.CONSOLE_ACCOUNTS_V1 = 'true';
      const app = express();
      app.use('/v1/me', createMeRouter(pool, {
        resolveSession: async (req) => (req.get('x-test-account') ? { accountId: req.get('x-test-account'), email: `${req.get('x-test-account')}@example.test` } : null),
        logger: { error() {}, warn() {} },
      }));
      await new Promise((r) => { server = app.listen(0, r); });
      base = `http://127.0.0.1:${server.address().port}/v1/me`;
    });
    after(() => server?.close());
    const call = (account, method, p, body) => fetch(base + p, {
      method,
      headers: { ...(account ? { 'x-test-account': account } : {}), ...(body ? { 'content-type': 'application/json', 'x-satelink-console': '1' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

    it('requires a session, CSRF header on mutations, and isolates accounts', async () => {
      assert.equal((await call(null, 'GET', '/alerts')).status, 401);
      const noCsrf = await fetch(base + '/alerts', { method: 'PUT', headers: { 'x-test-account': A, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(noCsrf.status, 403);
      const put = await call(A, 'PUT', '/alerts', { lowBalanceUsdt: 2 });
      assert.equal(put.status, 200);
      await pool.query(`INSERT INTO account_alert_events (account_id, kind, dedupe_key, subject, delivery) VALUES ($1, 'test', 'test:iso', 'A only', 'sent')`, [A]);
      const a = await (await call(A, 'GET', '/alerts')).json();
      const b = await (await call(B, 'GET', '/alerts')).json();
      assert.equal(a.data.prefs.lowBalanceUsdt, 2);
      assert.equal(a.data.history.length, 1);
      assert.equal(b.data.prefs.lowBalanceUsdt, null, "B never sees A's preferences");
      assert.equal(b.data.history.length, 0, "B never sees A's history");
    });

    it('rejects an invalid preference with 400', async () => {
      const r = await call(A, 'PUT', '/alerts', { cooldownMinutes: 1 });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, 'invalid_setting');
    });
  });
});
