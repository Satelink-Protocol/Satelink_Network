// CONSOLE_ACCOUNTS_V1 — account ↔ key links, owner controls in the metering
// path, request log, wallet links. Runs against a REAL local Postgres (the
// concurrency guarantees are the point); skipped when CONSOLE_ACCOUNTS_TEST_DB
// is unset. Each run uses its own schema, so it never touches other data.
//
//   CONSOLE_ACCOUNTS_TEST_DB=postgresql://postgres@127.0.0.1:55432/satelink_test \
//     npx mocha --no-config --exit test/console_accounts.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import express from 'express';
import { Wallet } from 'ethers';

import { authorizeAndMeter } from '../src/billing/credit_service.mjs';
import { enforceCapacity } from '../src/capacity/capacity_enforcement.js';
import { __resetSchemaCache, ensureConsoleAccountsSchema } from '../src/console_accounts/schema.mjs';
import { createKey, linkKey, listKeys, renameKey, revokeKey, rotateKey } from '../src/console_accounts/keys.mjs';
import { setAgentLimits, updateSettings, getSettings, spendSummary } from '../src/console_accounts/settings.mjs';
import { createMeRouter } from '../src/console_accounts/router.mjs';

const URL_ = process.env.CONSOLE_ACCOUNTS_TEST_DB;
const here = path.dirname(fileURLToPath(import.meta.url));
const d = URL_ ? describe : describe.skip;

d('CONSOLE_ACCOUNTS_V1', function () {
  this.timeout(30000);
  let pool;
  const schema = `ca_test_${Date.now()}`;
  const A = 'user_a';
  const B = 'user_b';

  before(async () => {
    const host = new URL(URL_).hostname;
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(host), 'CONSOLE_ACCOUNTS_TEST_DB must be a local database');
    const admin = new pg.Pool({ connectionString: URL_ });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_, options: `-c search_path=${schema}`, max: 30 });
    await pool.query(fs.readFileSync(path.join(here, 'schema', 'billing_test_schema.sql'), 'utf8'));
    await pool.query(`
      ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS email TEXT, ADD COLUMN IF NOT EXISTS email_consent BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS frozen_usdt NUMERIC DEFAULT 0 NOT NULL, ADD COLUMN IF NOT EXISTS payment_hold BOOLEAN DEFAULT false NOT NULL;
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT);
      INSERT INTO "user" VALUES ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
      CREATE TABLE IF NOT EXISTS plan_entitlements (api_key TEXT, plan_id TEXT, period_end TIMESTAMPTZ);
      CREATE TABLE IF NOT EXISTS webhook_subscriptions (id SERIAL, api_key TEXT, status TEXT);
      -- Production has payment_sources.created_at TIMESTAMPTZ (verified
      -- 2026-09-25); billing_test_schema.sql still says BIGINT. Match prod here.
      ALTER TABLE payment_sources ALTER COLUMN created_at DROP DEFAULT,
        ALTER COLUMN created_at TYPE TIMESTAMPTZ USING to_timestamp(created_at),
        ALTER COLUMN created_at SET DEFAULT NOW();
    `);
    __resetSchemaCache();
    await ensureConsoleAccountsSchema(pool);
  });

  after(async () => { await pool?.end(); });

  afterEach(() => { delete process.env.CONSOLE_ACCOUNTS_V1; });

  async function fundedKey(credits = 1, extra = {}) {
    const key = `sk_basic_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    const r = await pool.query(
      `INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt, status, wallet_address) VALUES ($1, 'basic', 1000000, $2, 'active', $3) RETURNING id`,
      [key, credits, extra.wallet ?? null]
    );
    return { key, id: r.rows[0].id };
  }
  const balance = async (id) => Number((await pool.query('SELECT credits_usdt FROM api_credits WHERE id = $1', [id])).rows[0].credits_usdt);

  describe('flag off', () => {
    it('authorizeAndMeter keeps its original single-UPDATE deduction and ignores owner controls', async () => {
      const k = await fundedKey(1);
      await linkKey(pool, A, { apiKey: k.key });
      await setAgentLimits(pool, A, k.id, { paused: true });
      const v = await authorizeAndMeter(pool, { apiKey: k.key });
      assert.equal(v.ok, true, 'flag off: pause must not apply');
      assert.equal(await balance(k.id), 0.99997);
    });
  });

  describe('key links', () => {
    it('create returns the key once; list never does', async () => {
      const made = await createKey(pool, A, { label: 'bot' });
      assert.match(made.apiKey, /^sk_free_[0-9a-f]{48}$/);
      const keys = await listKeys(pool, A);
      const row = keys.find((k) => k.id === made.id);
      assert.equal(row.label, 'bot');
      assert.ok(!JSON.stringify(keys).includes(made.apiKey), 'list must not contain the key');
      const stored = await pool.query('SELECT key_fingerprint, key_hint FROM account_api_keys WHERE api_key_id = $1', [made.id]);
      assert.equal(stored.rows[0].key_fingerprint.length, 64);
      assert.ok(!stored.rows[0].key_hint.includes(made.apiKey.slice(8, 40)));
    });

    it('link proves possession, is idempotent for the owner, and is refused for another account', async () => {
      const k = await fundedKey(0.5);
      const first = await linkKey(pool, A, { apiKey: k.key, label: 'mine' });
      assert.equal(first.alreadyLinked, false);
      const again = await linkKey(pool, A, { apiKey: k.key });
      assert.equal(again.alreadyLinked, true);
      await assert.rejects(linkKey(pool, B, { apiKey: k.key }), { code: 'key_linked_elsewhere' });
      await assert.rejects(linkKey(pool, B, { apiKey: 'sk_free_doesnotexist' }), { code: 'invalid_key' });
    });

    it('another account can neither rename nor revoke nor rotate my key', async () => {
      const made = await createKey(pool, A);
      await assert.rejects(renameKey(pool, B, made.id, 'x'), { code: 'key_not_found' });
      await assert.rejects(revokeKey(pool, B, made.id), { code: 'key_not_found' });
      await assert.rejects(rotateKey(pool, B, made.id), { code: 'key_not_found' });
    });

    it('revoke stops the key immediately in the metering path', async () => {
      const k = await fundedKey(1);
      await linkKey(pool, A, { apiKey: k.key });
      await revokeKey(pool, A, k.id);
      const v = await authorizeAndMeter(pool, { apiKey: k.key });
      assert.equal(v.ok, false);
      assert.equal(v.code, 'account_inactive');
    });
  });

  describe('rotate', () => {
    it('moves the exact balance, the wallet binding and the limits; old key dies', async () => {
      const wallet = Wallet.createRandom().address;
      const k = await fundedKey(12.345678, { wallet });
      await linkKey(pool, A, { apiKey: k.key, label: 'prod bot' });
      await setAgentLimits(pool, A, k.id, { dailyCapUsdt: 5, scopes: ['rpc'] });
      const out = await rotateKey(pool, A, k.id);
      assert.equal(out.movedCreditsUsdt, 12.345678);
      assert.equal(await balance(k.id), 0);
      assert.equal(await balance(out.id), 12.345678);
      const oldRow = (await pool.query('SELECT status, wallet_address FROM api_credits WHERE id = $1', [k.id])).rows[0];
      assert.deepEqual([oldRow.status, oldRow.wallet_address], ['revoked', null]);
      const newRow = (await pool.query('SELECT wallet_address FROM api_credits WHERE id = $1', [out.id])).rows[0];
      assert.equal(newRow.wallet_address, wallet);
      const lim = (await pool.query('SELECT scopes, daily_cap_usdt FROM agent_limits WHERE api_key_id = $1', [out.id])).rows[0];
      assert.deepEqual(lim.scopes, ['rpc']);
      assert.equal((await listKeys(pool, A)).find((x) => x.id === out.id).label, 'prod bot');
      assert.equal((await authorizeAndMeter(pool, { apiKey: k.key })).code, 'account_inactive');
      assert.equal((await authorizeAndMeter(pool, { apiKey: out.apiKey })).ok, true);
      // Wallet auth now resolves to the NEW key, not the revoked one.
      assert.equal((await authorizeAndMeter(pool, { wallet })).ok, true);
      const audit = await pool.query(`SELECT detail FROM account_audit WHERE action = 'key.rotate' AND subject = $1`, [String(k.id)]);
      assert.equal(audit.rows[0].detail.moved_credits_usdt, '12.345678');
    });

    it('is refused for a key with an active plan, frozen funds or a payment hold', async () => {
      const k1 = await fundedKey(1);
      await linkKey(pool, A, { apiKey: k1.key });
      await pool.query(`INSERT INTO plan_entitlements VALUES ($1, 'pro', NOW() + interval '10 days')`, [k1.key]);
      await assert.rejects(rotateKey(pool, A, k1.id), (e) => e.code === 'rotate_blocked' && e.extra.reason === 'active_plan');
      const k2 = await fundedKey(1);
      await linkKey(pool, A, { apiKey: k2.key });
      await pool.query('UPDATE api_credits SET frozen_usdt = 1 WHERE id = $1', [k2.id]);
      await assert.rejects(rotateKey(pool, A, k2.id), (e) => e.extra.reason === 'frozen_funds');
      const k3 = await fundedKey(1);
      await linkKey(pool, A, { apiKey: k3.key });
      await pool.query('UPDATE api_credits SET payment_hold = true WHERE id = $1', [k3.id]);
      await assert.rejects(rotateKey(pool, A, k3.id), (e) => e.extra.reason === 'payment_hold');
      assert.equal(await balance(k1.id), 1, 'refused rotation moves nothing');
    });

    it('concurrent rotations of one key rotate it exactly once', async () => {
      const k = await fundedKey(3);
      await linkKey(pool, A, { apiKey: k.key });
      const res = await Promise.allSettled(Array.from({ length: 6 }, () => rotateKey(pool, A, k.id)));
      assert.equal(res.filter((r) => r.status === 'fulfilled').length, 1);
      const total = await pool.query(`SELECT SUM(credits_usdt)::numeric AS s FROM api_credits c JOIN account_api_keys l ON l.api_key_id = c.id WHERE l.account_id = $1 AND l.revoked_at IS NULL AND c.id > $2`, [A, k.id]);
      assert.equal(Number(total.rows[0].s), 3, 'the balance exists exactly once');
    });
  });

  describe('owner controls in the metering path (flag on)', () => {
    beforeEach(() => { process.env.CONSOLE_ACCOUNTS_V1 = 'true'; });

    it('paused → 403 terminal, nothing deducted', async () => {
      const k = await fundedKey(1);
      await linkKey(pool, A, { apiKey: k.key });
      await setAgentLimits(pool, A, k.id, { paused: true });
      const v = await authorizeAndMeter(pool, { apiKey: k.key });
      assert.deepEqual([v.ok, v.code, v.http, v.terminal], [false, 'agent_paused', 403, true]);
      assert.equal(await balance(k.id), 1);
    });

    it('scope denied for a product outside the key scopes', async () => {
      const k = await fundedKey(1);
      await linkKey(pool, A, { apiKey: k.key });
      await setAgentLimits(pool, A, k.id, { scopes: ['rpc'] });
      assert.equal((await authorizeAndMeter(pool, { apiKey: k.key, product: 'rpc' })).ok, true);
      const v = await authorizeAndMeter(pool, { apiKey: k.key, methodPrice: 0.01, product: 'intelligence' });
      assert.equal(v.code, 'scope_denied');
    });

    it('credit auto-use off → 402 terminal', async () => {
      const k = await fundedKey(1);
      await linkKey(pool, B, { apiKey: k.key });
      await updateSettings(pool, B, { creditAutoUse: false });
      const v = await authorizeAndMeter(pool, { apiKey: k.key });
      assert.deepEqual([v.code, v.http, v.terminal], ['credit_auto_use_off', 402, true]);
      await updateSettings(pool, B, { creditAutoUse: true });
    });

    it('an unlinked key behaves exactly as before', async () => {
      const k = await fundedKey(1);
      const v = await authorizeAndMeter(pool, { apiKey: k.key });
      assert.equal(v.ok, true);
      assert.equal(await balance(k.id), 0.99997);
    });

    it('agent daily cap holds under 40 concurrent requests; counter == committed charges', async () => {
      const k = await fundedKey(1);
      await linkKey(pool, A, { apiKey: k.key });
      await setAgentLimits(pool, A, k.id, { dailyCapUsdt: 0.0001 }); // fits 3 calls at $0.00003
      const res = await Promise.all(Array.from({ length: 40 }, () => authorizeAndMeter(pool, { apiKey: k.key })));
      const ok = res.filter((r) => r.ok).length;
      assert.equal(ok, 3);
      assert.ok(res.filter((r) => !r.ok).every((r) => r.code === 'agent_daily_cap_reached' && r.terminal));
      const counter = await pool.query(`SELECT spent_usdt FROM account_spend_counters WHERE scope = 'agent_day' AND scope_id = $1`, [String(k.id)]);
      assert.equal(Number(counter.rows[0].spent_usdt), 0.00009);
      assert.equal(Number((1 - (await balance(k.id))).toFixed(6)), 0.00009, 'deducted exactly what was counted');
    });

    it('account monthly cap holds across two keys hammered concurrently', async () => {
      const acct = 'user_cap';
      await pool.query(`INSERT INTO "user" VALUES ($1, 'cap@example.test')`, [acct]);
      const k1 = await fundedKey(1);
      const k2 = await fundedKey(1);
      await linkKey(pool, acct, { apiKey: k1.key });
      await linkKey(pool, acct, { apiKey: k2.key });
      await updateSettings(pool, acct, { monthlySpendCapUsdt: 0.0003 }); // 10 calls
      const res = await Promise.all(Array.from({ length: 60 }, (_, i) => authorizeAndMeter(pool, { apiKey: i % 2 ? k1.key : k2.key })));
      assert.equal(res.filter((r) => r.ok).length, 10);
      const spent = 2 - (await balance(k1.id)) - (await balance(k2.id));
      assert.equal(Number(spent.toFixed(6)), 0.0003);
      const s = await spendSummary(pool, acct);
      assert.equal(s.caps.monthCountedUsdt, 0.0003);
    });

    it('insufficient credits rolls the cap counter back', async () => {
      const k = await fundedKey(0.00004); // exactly one call
      await linkKey(pool, A, { apiKey: k.key });
      await setAgentLimits(pool, A, k.id, { dailyCapUsdt: 1 });
      const res = await Promise.all(Array.from({ length: 5 }, () => authorizeAndMeter(pool, { apiKey: k.key })));
      assert.equal(res.filter((r) => r.ok).length, 1);
      assert.ok(res.filter((r) => !r.ok).every((r) => r.code === 'insufficient_credits'));
      const counter = await pool.query(`SELECT spent_usdt FROM account_spend_counters WHERE scope = 'agent_day' AND scope_id = $1`, [String(k.id)]);
      assert.equal(Number(counter.rows[0].spent_usdt), 0.00003, 'only the committed charge is counted');
    });

    it("capacity path 'new': an owner control is a hard stop, never falls through", async () => {
      await pool.query(`INSERT INTO platform_flags (key, value) VALUES ('capacity_enforcement_path', 'new') ON CONFLICT (key) DO UPDATE SET value = 'new'`);
      const k = await fundedKey(1);
      await linkKey(pool, A, { apiKey: k.key });
      await setAgentLimits(pool, A, k.id, { paused: true });
      const v = await enforceCapacity(pool, { apiKey: k.key, requestId: 'r1' });
      assert.equal(v.code, 'agent_paused');
      await pool.query(`UPDATE platform_flags SET value = 'legacy' WHERE key = 'capacity_enforcement_path'`);
    });
  });

  describe('settings validation', () => {
    it('rejects unknown fields, bad timezones and negative caps', async () => {
      await assert.rejects(updateSettings(pool, A, { spendCap: 5 }), { code: 'invalid_setting' });
      await assert.rejects(updateSettings(pool, A, { timezone: 'Mars/Olympus' }), { code: 'invalid_setting' });
      await assert.rejects(updateSettings(pool, A, { monthlySpendCapUsdt: -1 }), { code: 'invalid_setting' });
      const s = await updateSettings(pool, A, { timezone: 'Asia/Kolkata', defaultMode: 'advanced', alertThresholds: [95, 70, 70] });
      assert.deepEqual([s.timezone, s.defaultMode, s.alertThresholds], ['Asia/Kolkata', 'advanced', [70, 95]]);
      assert.equal((await getSettings(pool, A)).timezone, 'Asia/Kolkata');
      await updateSettings(pool, A, { timezone: 'UTC' });
    });
  });

  describe('HTTP router', () => {
    let base;
    let server;
    before(async () => {
      const app = express();
      // Test session: the X-Test-Account header stands in for the Better Auth cookie.
      app.use('/v1/me', createMeRouter(pool, { resolveSession: async (req) => (req.get('x-test-account') ? { accountId: req.get('x-test-account'), email: 'x' } : null), logger: { error() {}, warn() {} } }));
      await new Promise((r) => { server = app.listen(0, r); });
      base = `http://127.0.0.1:${server.address().port}/v1/me`;
    });
    after(() => server?.close());

    const call = (p, { method = 'GET', account = A, body, headers = {} } = {}) => fetch(base + p, {
      method,
      headers: { ...(account ? { 'x-test-account': account } : {}), ...(body ? { 'content-type': 'application/json', 'x-satelink-console': '1' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });

    it('401 without a session; CSRF guard on mutations', async () => {
      assert.equal((await call('/keys', { account: null })).status, 401);
      const noHeader = await fetch(base + '/keys', { method: 'POST', headers: { 'x-test-account': A, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(noHeader.status, 403);
      const evil = await call('/keys', { method: 'POST', body: {}, headers: { origin: 'https://evil.example' } });
      assert.equal(evil.status, 403);
    });

    it('Idempotency-Key: a replayed create returns the same key and issues nothing new', async () => {
      const before = (await listKeys(pool, A)).length;
      const r1 = await call('/keys', { method: 'POST', body: { label: 'idem' }, headers: { 'idempotency-key': 'k-123' } });
      const r2 = await call('/keys', { method: 'POST', body: { label: 'idem' }, headers: { 'idempotency-key': 'k-123' } });
      const [j1, j2] = [await r1.json(), await r2.json()];
      assert.equal(r1.status, 201);
      assert.equal(r2.headers.get('idempotent-replayed'), 'true');
      assert.equal(j1.data.apiKey, j2.data.apiKey);
      assert.equal((await listKeys(pool, A)).length, before + 1);
    });

    it('request log: only my keys, keyset-paginated, no key in the payload', async () => {
      const acct = 'user_log';
      await pool.query(`INSERT INTO "user" VALUES ($1, 'log@example.test')`, [acct]);
      const mine = await fundedKey(1);
      const theirs = await fundedKey(1);
      await linkKey(pool, acct, { apiKey: mine.key, label: 'logger' });
      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 5; i++) {
        await pool.query(`INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, method) VALUES ('rpc_call', $1, 0.00003, 'completed', $2, $3, 'eth_blockNumber')`, [mine.key, `log-${mine.id}-${i}`, now - i]);
      }
      await pool.query(`INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at) VALUES ('rpc_call', $1, 0.00003, 'completed', $2, $3)`, [theirs.key, `log-other-${theirs.id}`, now]);
      const p1 = await (await call('/requests?limit=2', { account: acct })).json();
      assert.equal(p1.data.items.length, 2);
      assert.ok(p1.data.nextCursor);
      const p2 = await (await call(`/requests?limit=10&cursor=${p1.data.nextCursor}`, { account: acct })).json();
      assert.equal(p2.data.items.length, 3);
      assert.equal(p2.data.nextCursor, null);
      const all = JSON.stringify([p1, p2]);
      assert.ok(!all.includes(mine.key) && !all.includes(theirs.key));
      assert.equal(p1.data.items[0].key.label, 'logger');
      assert.equal(p1.data.items[0].latencyMs, null);
    });

    it('usage series is zero-filled per key; deposits cover my keys only', async () => {
      const acct = 'user_usage';
      await pool.query(`INSERT INTO "user" VALUES ($1, 'u@example.test')`, [acct]);
      const k = await fundedKey(1);
      const other = await fundedKey(1);
      await linkKey(pool, acct, { apiKey: k.key, label: 'u' });
      await pool.query(`INSERT INTO api_usage_daily (api_key, date, request_count, usdt_spent) VALUES ($1, CURRENT_DATE, 7, 0.00021)`, [k.key]);
      await pool.query(`INSERT INTO api_deposits (api_key, tx_hash, amount_usdt) VALUES ($1, '0xdep1', 5), ($2, '0xdep2', 9)`, [k.key, other.key]);
      const u = await (await call('/usage?days=7', { account: acct })).json();
      assert.equal(u.data.keys[0].points.length, 7);
      assert.equal(u.data.keys[0].points.at(-1).requests, 7);
      const dep = await (await call('/deposits', { account: acct })).json();
      assert.deepEqual(dep.data.map((x) => x.txHash), ['0xdep1']);
    });

    it('wallet link: SIWE-style signature, one-time nonce, per-wallet x402 view', async () => {
      const w = Wallet.createRandom();
      const ch = await (await call('/wallets/challenge', { method: 'POST', body: { address: w.address, chainId: 8453 } })).json();
      const signature = await w.signMessage(ch.data.message);
      const ok = await call('/wallets/verify', { method: 'POST', body: { message: ch.data.message, signature } });
      assert.equal(ok.status, 201);
      const replay = await call('/wallets/verify', { method: 'POST', body: { message: ch.data.message, signature } });
      assert.equal(replay.status, 400, 'nonce is single-use');
      // A signature from a different wallet is refused.
      const ch2 = await (await call('/wallets/challenge', { method: 'POST', body: { address: w.address } })).json();
      const forged = await Wallet.createRandom().signMessage(ch2.data.message);
      assert.equal((await call('/wallets/verify', { method: 'POST', body: { message: ch2.data.message, signature: forged } })).status, 400);
      await pool.query(`INSERT INTO payment_sources (source, amount_usd, token, network, tx_hash, payer) VALUES ('x402', 0.1, 'USDC', 'eip155:8453', '0xabc', $1)`, [w.address]);
      const x = await (await call(`/x402?wallet=${w.address}`)).json();
      assert.equal(x.data.settled.scope, 'this_wallet');
      assert.equal(x.data.settled.count, 1);
      assert.equal(x.data.challenges.scope, 'network_wide');
      // Another account cannot read it.
      assert.equal((await call(`/x402?wallet=${w.address}`, { account: B })).status, 404);
    });
  });
});
