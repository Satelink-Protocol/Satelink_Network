// /v1/me/sessions — the console lists and revokes sessions by opaque id; the
// Better Auth session TOKEN never appears in any response (it used to reach
// page JS via the Settings page's Revoke buttons). Real local Postgres for the
// audit table; Better Auth is replaced by an in-memory session store with the
// same contract (list = the caller's own sessions incl. token; revoke = token).
//
//   CONSOLE_ACCOUNTS_TEST_DB=postgresql://…/satelink_test npx mocha --no-config --exit test/console_sessions.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import express from 'express';
import { __resetSchemaCache, ensureConsoleAccountsSchema } from '../src/console_accounts/schema.mjs';
import { createMeRouter } from '../src/console_accounts/router.mjs';

const URL_ = process.env.CONSOLE_ACCOUNTS_TEST_DB;
const here = path.dirname(fileURLToPath(import.meta.url));
const d = URL_ ? describe : describe.skip;

d('/v1/me/sessions — revoke by opaque id, tokens never leave the API', function () {
  this.timeout(30000);
  let pool, server, base, store, revoked;
  const schema = `sessions_test_${Date.now()}`;
  const TOK = (u, n) => `tok_${u}_${n}_SECRETVALUE`;

  const sessionsApi = {
    async list(req) { return store.filter((s) => s.userId === req.account.accountId); },
    async revoke(req, token) {
      const i = store.findIndex((s) => s.token === token && s.userId === req.account.accountId);
      assert.ok(i >= 0, 'revoke called with a token the caller does not own');
      revoked.push(token); store.splice(i, 1); return { status: true };
    },
  };

  before(async () => {
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(new URL(URL_).hostname), 'local database only');
    const admin = new pg.Pool({ connectionString: URL_ });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_, options: `-c search_path=${schema}`, max: 5 });
    await pool.query(fs.readFileSync(path.join(here, 'schema', 'billing_test_schema.sql'), 'utf8'));
    await pool.query(`ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS email TEXT, ADD COLUMN IF NOT EXISTS dodo_funded_usdt NUMERIC(18,6) NOT NULL DEFAULT 0;
      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT); INSERT INTO "user" VALUES ('ua','a@x.test'),('ub','b@x.test');`);
    __resetSchemaCache();
    await ensureConsoleAccountsSchema(pool);
    process.env.CONSOLE_ACCOUNTS_V1 = 'true';
    const app = express();
    app.use('/v1/me', createMeRouter(pool, {
      resolveSession: async (req) => (req.get('x-test-account') ? { accountId: req.get('x-test-account'), email: 'x', sessionId: req.get('x-test-session') } : null),
      logger: { error() {}, warn() {} },
      sessionsApi,
    }));
    await new Promise((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${server.address().port}/v1/me`;
  });
  after(async () => { server?.close(); await pool?.end(); delete process.env.CONSOLE_ACCOUNTS_V1; });
  beforeEach(() => {
    revoked = [];
    store = [
      { id: 'sa1', token: TOK('ua', 1), userId: 'ua', createdAt: new Date(), expiresAt: new Date(Date.now() + 864e5), userAgent: 'Chrome', ipAddress: '198.51.100.1' },
      { id: 'sa2', token: TOK('ua', 2), userId: 'ua', createdAt: new Date(), expiresAt: new Date(Date.now() + 864e5), userAgent: 'Safari', ipAddress: '198.51.100.2' },
      { id: 'sb1', token: TOK('ub', 1), userId: 'ub', createdAt: new Date(), expiresAt: new Date(Date.now() + 864e5), userAgent: 'Firefox', ipAddress: '198.51.100.3' },
    ];
  });

  const call = (account, sessionId, method, p, { csrf = true } = {}) => fetch(base + p, {
    method,
    headers: { 'x-test-account': account, 'x-test-session': sessionId, ...(method !== 'GET' && csrf ? { 'content-type': 'application/json', 'x-satelink-console': '1' } : {}) },
    body: method !== 'GET' ? '{}' : undefined,
  });

  it('GET /sessions returns the caller\'s sessions with ids and no token anywhere in the body', async () => {
    const r = await call('ua', 'sa1', 'GET', '/sessions');
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(!text.includes('SECRETVALUE'), 'a session token leaked into the response');
    assert.ok(!/"token"/.test(text), 'a token field is present');
    const { data } = JSON.parse(text);
    assert.deepEqual(data.map((s) => [s.id, s.current]), [['sa1', true], ['sa2', false]]);
    assert.deepEqual(Object.keys(data[0]).sort(), ['createdAt', 'current', 'expiresAt', 'id', 'ipAddress', 'userAgent']);
  });

  it('POST /sessions/:id/revoke revokes the caller\'s own session server-side and audits it; the token is not echoed', async () => {
    const r = await call('ua', 'sa1', 'POST', '/sessions/sa2/revoke');
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(!text.includes('SECRETVALUE'));
    assert.deepEqual(JSON.parse(text).data, { revoked: 'sa2', current: false });
    assert.deepEqual(revoked, [TOK('ua', 2)]);
    const a = await pool.query(`SELECT action, subject FROM account_audit WHERE account_id = 'ua' AND action = 'session.revoke'`);
    assert.deepEqual(a.rows.map((x) => [x.action, x.subject]), [['session.revoke', 'sa2']]);
  });

  it('another user\'s session id is not found (404) and nothing is revoked', async () => {
    const r = await call('ua', 'sa1', 'POST', '/sessions/sb1/revoke');
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'session_not_found');
    assert.deepEqual(revoked, []);
    assert.equal(store.length, 3);
  });

  it('rejects malformed ids, missing CSRF header, and signed-out callers', async () => {
    assert.equal((await call('ua', 'sa1', 'POST', '/sessions/' + encodeURIComponent('a b') + '/revoke')).status, 400);
    assert.equal((await call('ua', 'sa1', 'POST', '/sessions/sa2/revoke', { csrf: false })).status, 403);
    const anon = await fetch(base + '/sessions');
    assert.equal(anon.status, 401);
    assert.deepEqual(revoked, []);
  });
});
