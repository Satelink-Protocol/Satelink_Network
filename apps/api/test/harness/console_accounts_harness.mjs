// Local E2E harness for CONSOLE_ACCOUNTS_V1 (dev only, never deployed).
// Serves the REAL /v1/me router against a LOCAL Postgres, plus a stub of
// Better Auth's get-session that maps the cookie `satelink.session_token=<id>`
// to a user. Lets the production console build be driven by Playwright in
// several isolated browser profiles signed in to the same account.
//   HARNESS_DB=postgresql://postgres@127.0.0.1:55432/satelink_test node test/harness/console_accounts_harness.mjs
import express from 'express';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMeRouter } from '../../src/console_accounts/router.mjs';
import { ensureConsoleAccountsSchema } from '../../src/console_accounts/schema.mjs';

const url = process.env.HARNESS_DB;
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('HARNESS_DB must be a local database');
const schema = process.env.HARNESS_SCHEMA || `ca_harness_${Date.now()}`;
const admin = new pg.Pool({ connectionString: url });
await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
await admin.end();
const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
const here = path.dirname(fileURLToPath(import.meta.url));
await pool.query(fs.readFileSync(path.join(here, '..', 'schema', 'billing_test_schema.sql'), 'utf8'));
await pool.query(`
  ALTER TABLE api_credits ADD COLUMN IF NOT EXISTS email TEXT, ADD COLUMN IF NOT EXISTS email_consent BOOLEAN DEFAULT false;
  CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT);
  INSERT INTO "user" VALUES ('acct_demo', 'demo@example.test', 'Demo') ON CONFLICT DO NOTHING;
`);
await ensureConsoleAccountsSchema(pool);

const userFromCookie = (req) => {
  const m = /satelink\.session_token=([^;]+)/.exec(req.get('cookie') || '');
  return m ? m[1] : null;
};

const app = express();
app.get('/api/identity/get-session', async (req, res) => {
  const id = userFromCookie(req);
  const u = id ? (await pool.query('SELECT id, email, name FROM "user" WHERE id = $1', [id])).rows[0] : null;
  res.json(u ? { user: { ...u, emailVerified: true }, session: { id: 's', expiresAt: new Date(Date.now() + 3600e3).toISOString() } } : null);
});
// Seed helper for the E2E: a funded legacy key (as if created before accounts).
app.post('/__seed/key', express.json(), async (req, res) => {
  const key = `sk_basic_${Math.random().toString(16).slice(2).padEnd(48, '0').slice(0, 48)}`;
  await pool.query(`INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt) VALUES ($1, 'basic', 10000, $2)`, [key, req.body?.credits ?? 2.5]);
  await pool.query(`INSERT INTO api_usage_daily (api_key, date, request_count, usdt_spent) VALUES ($1, CURRENT_DATE, 42, 0.00126)`, [key]);
  res.json({ key });
});
app.use('/v1/me', createMeRouter(pool, {
  resolveSession: async (req) => { const id = userFromCookie(req); return id ? { accountId: id, email: 'demo@example.test' } : null; },
}));
const port = Number(process.env.HARNESS_PORT || 4455);
app.listen(port, () => console.log(`harness on :${port} schema=${schema}`));
