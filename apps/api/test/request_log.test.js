// D5 — bounded request log: buffering rules, flush key resolution, retention,
// the console read path (request_log + older billed rows) and tenant isolation.
// Middleware/buffer cases are hermetic; DB cases need CONSOLE_ACCOUNTS_TEST_DB (local only).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import express from 'express';
import request from 'supertest';
import { createRequestLog, pruneRequestLog } from '../src/observability/request_log.mjs';
import { __resetSchemaCache, ensureConsoleAccountsSchema } from '../src/console_accounts/schema.mjs';
import { linkKey } from '../src/console_accounts/keys.mjs';
import { listRequests, errorRate } from '../src/console_accounts/requests.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function app(log, { status = 200, billing = null, x402 = null } = {}) {
  const a = express();
  a.use('/rpc', log.middleware('rpc'));
  a.use('/rpc', express.json(), (req, res) => {
    if (x402) req.x402 = x402;
    if (billing) res.locals.satelinkBilling = billing;
    res.status(status).json({ ok: status < 400 });
  });
  return a;
}
const rpcBody = { jsonrpc: '2.0', method: 'eth_call', params: [], id: 1 };

describe('D5 request log — buffering (hermetic)', () => {
  it('records credentialed calls with status, latency, chain, method and billing; skips anonymous calls', async () => {
    const log = createRequestLog();
    await request(app(log, { billing: { requestId: 'rpc_1', chargedUsdt: 0.00003 } })).post('/rpc/polygon').set('X-API-Key', 'sk_basic_x').send(rpcBody);
    await request(app(log, { status: 402 })).post('/rpc/polygon').send(rpcBody); // anonymous
    await request(app(log, { status: 429 })).post('/rpc/base').set('Authorization', 'Bearer sk_basic_y').send(rpcBody);
    const s = log.stats();
    assert.deepEqual([s.buffered, s.pending], [2, 2]);
  });

  it('never grows past the buffer cap — extra rows are dropped and counted', async () => {
    const log = createRequestLog({ bufferMax: 3 });
    for (let i = 0; i < 5; i++) log.push({ key: 'k' });
    assert.deepEqual([log.stats().pending, log.stats().dropped], [3, 2]);
  });

  it('a logging failure never changes the response', async () => {
    const log = createRequestLog({ now: () => { throw new Error('clock broke'); } });
    const r = await request(app(log)).post('/rpc/polygon').set('X-API-Key', 'sk_basic_x').send(rpcBody);
    assert.equal(r.status, 200);
  });
});

const URL_ = process.env.CONSOLE_ACCOUNTS_TEST_DB;
const d = URL_ ? describe : describe.skip;
d('D5 request log — database (local Postgres)', function () {
  this.timeout(30000);
  let pool;
  const schema = `rlog_${Date.now()}`;
  const A = 'acct_rlog_a', B = 'acct_rlog_b';
  const key = async (account, extra = {}) => {
    const k = `sk_basic_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
    const r = await pool.query(`INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt, status, wallet_address) VALUES ($1, 'basic', 1000, 1, 'active', $2) RETURNING id`, [k, extra.wallet || null]);
    await linkKey(pool, account, { apiKey: k, label: extra.label || 'Bot' });
    return { key: k, id: r.rows[0].id };
  };

  before(async () => {
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes(new URL(URL_).hostname), 'local database only');
    const admin = new pg.Pool({ connectionString: URL_ });
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL_, options: `-c search_path=${schema}`, max: 5 });
    await pool.query(fs.readFileSync(path.join(here, 'schema', 'billing_test_schema.sql'), 'utf8'));
    await pool.query(`ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS dodo_funded_usdt NUMERIC(18,6) NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS payment_hold BOOLEAN DEFAULT false NOT NULL;
                      CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT); INSERT INTO "user" VALUES ('${A}', 'a@example.test'), ('${B}', 'b@example.test');`);
    __resetSchemaCache();
    await ensureConsoleAccountsSchema(pool);
  });
  after(async () => { await pool?.end(); });

  it('before migration 020: reads fall back to billed rows, error rate reports not measured', async () => {
    const k = await key(A);
    await pool.query(`INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, method, chain) VALUES ('rpc_call', $1, 0.00003, 'success', 'rpc_old', 1000, 'eth_call', 'polygon')`, [k.key]);
    const r = await listRequests(pool, A);
    assert.deepEqual(r.items.map((i) => [i.source, i.receiptId]), [['billing', 'rpc_old']]);
    assert.deepEqual(await errorRate(pool, A), { measured: false });
  });

  it('flush resolves keys server-side, drops unknown keys, never stores the key; x402 wallets resolve too', async () => {
    await pool.query(fs.readFileSync(path.join(here, '..', '..', '..', 'database', 'migrations', '020_request_log.sql'), 'utf8'));
    const k = await key(A, { label: 'Main' });
    const w = await key(A, { wallet: '0xabc0000000000000000000000000000000000001', label: 'Wallet' });
    const log = createRequestLog();
    await request(app(log, { billing: { requestId: 'rpc_new', chargedUsdt: 0.00003 } })).post('/rpc/polygon').set('X-API-Key', k.key).send(rpcBody);
    await request(app(log, { status: 502 })).post('/rpc/polygon').set('X-API-Key', k.key).send(rpcBody);
    await request(app(log, { status: 402 })).post('/rpc/polygon').set('X-API-Key', 'sk_basic_doesnotexist').send(rpcBody);
    await request(app(log, { x402: { settled: true, wallet: '0xABC0000000000000000000000000000000000001' } })).post('/rpc/polygon').send(rpcBody);
    const n = await log.flush(pool);
    assert.equal(n, 3, JSON.stringify(log.stats()));
    assert.equal(log.stats().discarded, 1, 'unknown key dropped by the join');
    const rows = (await pool.query('SELECT api_key_id, http_status, rail, endpoint, chain, charged_usdt FROM request_log ORDER BY id')).rows;
    assert.deepEqual(rows.map((r) => [Number(r.api_key_id), r.http_status, r.rail, r.endpoint, r.chain]), [
      [k.id, 200, 'credits', 'eth_call', 'polygon'], [k.id, 502, 'credits', 'eth_call', 'polygon'], [w.id, 200, 'x402', 'eth_call', 'polygon']]);
    const dump = JSON.stringify((await pool.query('SELECT * FROM request_log')).rows);
    assert.ok(!dump.includes(k.key), 'the raw key is never stored');
  });

  it('console read: log rows first (status + latency), then older billed rows; cursor pages across both; tenant-isolated', async () => {
    const r = await listRequests(pool, A, { limit: 2 });
    // Newest first: the x402 call (200), then the 502.
    assert.deepEqual(r.items.map((i) => [i.source, i.httpStatus, i.rail]), [['request_log', 200, 'x402'], ['request_log', 502, 'credits']]);
    assert.ok(r.items.every((i) => Number.isInteger(i.latencyMs)));
    assert.match(r.nextCursor, /^log:/);
    const p2 = await listRequests(pool, A, { limit: 5, cursor: r.nextCursor });
    assert.deepEqual(p2.items.map((i) => [i.source, i.httpStatus]), [['request_log', 200], ['billing', null]]);
    const errs = await listRequests(pool, A, { status: 'error' });
    assert.deepEqual(errs.items.map((i) => i.httpStatus), [502]);
    assert.deepEqual((await listRequests(pool, B)).items, [], 'another account sees nothing');
    await assert.rejects(listRequests(pool, A, { status: 'weird' }), /status must be/);
  });

  it('retention deletes rows older than the window, in batches', async () => {
    await pool.query(`UPDATE request_log SET created_at = NOW() - interval '20 days' WHERE http_status = 502`);
    const r = await pruneRequestLog(pool, { days: 14, batch: 1 });
    assert.equal(r.deleted, 1);
    assert.equal(Number((await pool.query('SELECT count(*) FROM request_log')).rows[0].count), 2);
    assert.equal((await errorRate(pool, A, { minCalls: 1 })).measured, true);
  });
});
