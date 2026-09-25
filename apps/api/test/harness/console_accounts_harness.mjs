// Local E2E harness for the console (dev only, never deployed). Mounts the REAL
// API routers — /v1/me (accounts), /v2/plans (PlanCatalog), /v1/intelligence
// (real metering, reading SEEDED fixture snapshots), /v1/console/summary,
// /api/keys — against a LOCAL Postgres, plus a stub of Better Auth's
// get-session mapping the cookie `satelink.session_token=<id>` to a user.
// Everything seeded here is TEST FIXTURE data, labelled as such in the payload.
//   HARNESS_DB=postgresql://postgres@127.0.0.1:55432/satelink_test node test/harness/console_accounts_harness.mjs
import express from 'express';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.CONSOLE_ACCOUNTS_V1 = 'true';
process.env.SATELINK_USAGE_LIMITS_V2_ENABLED = 'true';
process.env.SATELINK_PLAN_BILLING_V2_ENABLED = 'true';
process.env.DODO_MODE = 'test';

const { createMeRouter } = await import('../../src/console_accounts/router.mjs');
const { ensureConsoleAccountsSchema } = await import('../../src/console_accounts/schema.mjs');
const { ensurePricingV2Schema } = await import('../../src/pricing_v2/schema.mjs');
const { loadCatalog, publicCatalog } = await import('../../src/pricing_v2/catalog.mjs');
const { createIntelligenceRouter } = await import('../../src/routes/intelligence_route.js');
const { createConsoleRouter } = await import('../../src/routes/console.js');
const { createDodoV2WebhookHandler } = await import('../../src/pricing_v2/webhooks.mjs');
const crypto = await import('node:crypto');
// Onboarding E2E: run with CONSOLE_ONBOARDING_V1=true. Webhooks are signed with
// this TEST-ONLY secret (Standard Webhooks, exactly as Dodo signs them).
const WEBHOOK_SECRET = 'whsec_' + Buffer.from('satelink-harness-webhook-secret!').toString('base64');

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
  ALTER TABLE revenue_events_v2 ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT TRUE;
  CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT);
  INSERT INTO "user" VALUES ('acct_demo', 'demo@example.test', 'Demo Tester') ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS intelligence_snapshots (id BIGSERIAL PRIMARY KEY, metric TEXT NOT NULL, payload JSONB NOT NULL, source_rows INTEGER NOT NULL DEFAULT 0, captured_at TIMESTAMPTZ NOT NULL DEFAULT now());
`);
await ensureConsoleAccountsSchema(pool);
await ensurePricingV2Schema(pool);

// TEST FIXTURE snapshots (shapes identical to src/intelligence/compute.js output).
const fixture = { test_fixture: true };
const snaps = {
  'funding-rate-heatmap': { ...fixture, metric: 'funding-rate-heatmap', universe: 3, symbols: [
    { symbol: 'BTCUSDT', per_exchange: [{ exchange: 'binance', funding_apr: 0.1095, funding_rate: 0.0001 }, { exchange: 'bybit', funding_apr: 0.0547, funding_rate: 0.00005 }, { exchange: 'okx', funding_apr: -0.0219, funding_rate: -0.00002 }], mean_apr: 0.0474, divergence_apr: 0.1314, exchanges: 3 },
    { symbol: 'ETHUSDT', per_exchange: [{ exchange: 'binance', funding_apr: 0.0876, funding_rate: 0.00008 }, { exchange: 'bybit', funding_apr: 0.0657, funding_rate: 0.00006 }], mean_apr: 0.0766, divergence_apr: 0.0219, exchanges: 2 },
    { symbol: 'SOLUSDT', per_exchange: [{ exchange: 'binance', funding_apr: 0.2190, funding_rate: 0.0002 }, { exchange: 'okx', funding_apr: 0.1642, funding_rate: 0.00015 }], mean_apr: 0.1916, divergence_apr: 0.0548, exchanges: 2 } ] },
  'open-interest-shifts': { ...fixture, metric: 'open-interest-shifts', has_baseline: true, universe: 3, symbols: [
    { symbol: 'BTCUSDT', open_interest_usd: 1.2e9, prior_open_interest_usd: 1.15e9, change_usd: 5e7, change_pct: 0.0435 },
    { symbol: 'ETHUSDT', open_interest_usd: 6.1e8, prior_open_interest_usd: 6.4e8, change_usd: -3e7, change_pct: -0.0469 },
    { symbol: 'SOLUSDT', open_interest_usd: 2.2e8, prior_open_interest_usd: 2.1e8, change_usd: 1e7, change_pct: 0.0476 } ] },
  'liquidation-clusters': { ...fixture, metric: 'liquidation-clusters', model: 'leverage-band-proxy', universe: 1, symbols: [
    { symbol: 'BTCUSDT', mark_price: 64000, clusters: [10, 25, 50].flatMap((L) => [{ side: 'long_liquidation', leverage: L, price: 64000 * (1 - 1 / L), crowding_weight: 0.0001 }, { side: 'short_liquidation', leverage: L, price: 64000 * (1 + 1 / L), crowding_weight: 0 }]) } ] },
  'market-microstructure': { ...fixture, metric: 'market-microstructure', universe: 2, symbols: [
    { symbol: 'BTCUSDT', exchange: 'binance', mid: 64000, spread_bps: 0.16, bid_depth_usd: 2.1e6, ask_depth_usd: 1.9e6, depth_imbalance: 0.05 },
    { symbol: 'BTCUSDT', exchange: 'okx', mid: 64001, spread_bps: 0.31, bid_depth_usd: 1.2e6, ask_depth_usd: 1.3e6, depth_imbalance: -0.04 } ] },
};
for (const [metric, payload] of Object.entries(snaps)) {
  await pool.query('INSERT INTO intelligence_snapshots (metric, payload, source_rows) VALUES ($1, $2, 5)', [metric, JSON.stringify(payload)]);
}

const userFromCookie = (req) => {
  const m = /satelink\.session_token=([^;]+)/.exec(req.get('cookie') || '');
  return m ? m[1] : null;
};
const port = Number(process.env.HARNESS_PORT || 4455);
const app = express();
app.get('/api/identity/get-session', async (req, res) => {
  const id = userFromCookie(req);
  const u = id ? (await pool.query('SELECT id, email, name FROM "user" WHERE id = $1', [id])).rows[0] : null;
  res.json(u ? { user: { ...u, emailVerified: true }, session: { id: 's', expiresAt: new Date(Date.now() + 3600e3).toISOString() } } : null);
});
app.get('/api/identity/list-accounts', (_req, res) => res.json([{ providerId: 'google', createdAt: new Date().toISOString() }]));
app.get('/api/identity/list-sessions', (_req, res) => res.json([]));
// Seed helper: a fresh account (TEST DATA) so each E2E run starts empty.
app.post('/__seed/user', express.json(), async (req, res) => {
  const id = `acct_e2e_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await pool.query('INSERT INTO "user" (id, email, name) VALUES ($1, $2, $3)', [id, `${id}@example.test`, req.body?.name || 'E2E Tester']);
  res.json({ id });
});
// Seed helper: a funded legacy key (as if created before accounts).
app.post('/__seed/key', express.json(), async (req, res) => {
  const key = `sk_basic_${Math.random().toString(16).slice(2).padEnd(48, '0').slice(0, 48)}`;
  await pool.query(`INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt) VALUES ($1, 'basic', 10000, $2)`, [key, req.body?.credits ?? 2.5]);
  // Optional usage history (TEST DATA): { days, perDay } → one row per day.
  const days = Math.min(Number(req.body?.days ?? 1), 30);
  for (let d = 0; d < days; d++) {
    const n = Math.round((req.body?.perDay ?? 42) * (0.6 + 0.8 * Math.abs(Math.sin(d * 1.7 + key.length))));
    await pool.query(`INSERT INTO api_usage_daily (api_key, date, request_count, usdt_spent) VALUES ($1, CURRENT_DATE - $2::int, $3, $4)`, [key, d, n, n * 0.00003]);
  }
  res.json({ key });
});
// The REAL V2 webhook handler (signature-verified), and a helper that delivers
// an event to it signed as Dodo would — Dodo cannot reach a laptop.
app.post('/webhooks/dodo/v2', express.raw({ type: '*/*' }), createDodoV2WebhookHandler(pool, { secret: () => WEBHOOK_SECRET, mode: 'test' }));
app.post('/__seed/webhook', express.json(), async (req, res) => {
  const body = JSON.stringify({ type: req.body.type, business_id: 'bus_test', timestamp: new Date().toISOString(), data: req.body.data });
  const id = `msg_${crypto.randomUUID()}`;
  const ts = Math.floor(Date.now() / 1000);
  const sig = 'v1,' + crypto.createHmac('sha256', Buffer.from(WEBHOOK_SECRET.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  const r = await fetch(`http://127.0.0.1:${port}/webhooks/dodo/v2`, { method: 'POST', headers: { 'content-type': 'application/json', 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': sig }, body });
  res.status(r.status).json(await r.json());
});
// Read helpers for assertions (TEST DATA only).
app.get('/__seed/product', (req, res) => {
  const c = loadCatalog();
  const item = [...c.plans, ...c.packs].find((x) => x.id === req.query.id);
  res.json({ product: item?.dodo?.test ?? null });
});
app.get('/__seed/consents', async (req, res) => {
  res.json((await pool.query('SELECT purpose, granted, document, document_version, ip, ip_source, created_at FROM consent_records WHERE account_id = $1 ORDER BY id', [req.query.account])).rows);
});
app.get('/__seed/settings', async (req, res) => {
  res.json((await pool.query('SELECT monthly_spend_cap_usdt FROM account_settings WHERE account_id = $1', [req.query.account])).rows[0] ?? null);
});
app.get('/v2/plans', (_req, res) => res.json({ ok: true, data: publicCatalog(loadCatalog(), { mode: 'test' }) }));
app.use('/v1', express.json(), createIntelligenceRouter(pool));
app.use('/v1', createConsoleRouter(pool));
app.get('/api/keys/deposit-info', (_req, res) => res.json({ ok: true, address: '0x966E1Ae22996545015b1414B35234b10719d7Ad4', network: 'Polygon (ChainId 137)', token_address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', test_fixture: true }));
app.use('/v1/me', createMeRouter(pool, {
  resolveSession: async (req) => {
    const id = userFromCookie(req);
    const u = id ? (await pool.query('SELECT email, name FROM "user" WHERE id = $1', [id])).rows[0] : null;
    return id ? { accountId: id, email: u?.email ?? 'demo@example.test', name: u?.name ?? null } : null;
  },
  intelBase: `http://127.0.0.1:${port}`,
}));
app.listen(port, () => console.log(`harness on :${port} schema=${schema} dodo=${process.env.DODO_TESTMODE_API_KEY ? 'test-key' : 'none'}`));
