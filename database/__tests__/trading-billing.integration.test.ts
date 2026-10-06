/**
 * Stage 27 — migration 030_billing_subscriptions up/down + PgBillingStore through BillingService
 * (test-mode Razorpay gateway with a fake REST API; webhooks signed with a test secret).
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB
 * pointing at a LOCAL server (the test creates and drops its own database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
import {
  RazorpayGateway, BillingService, PgBillingStore, SimSubscriptionBook,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/billing/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '030_billing_subscriptions.down.sql'), 'utf8');
const SECRET = 'fake-webhook-secret-for-tests';
const T0 = Date.UTC(2026, 9, 6, 6, 0) / 1000;
const PLANS = { ta_pro_test: 'plan_ProFake0001', ta_team_test: 'plan_TeamFake001' };

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

const fakeFetch = async (url: string, init: { method: string; body?: string }) => {
  const u = new URL(url);
  if (u.pathname === '/v1/subscriptions') return new Response(JSON.stringify({ id: `sub_Pg${Date.now().toString(36)}`, status: 'created', short_url: 'https://rzp.io/i/fake' }), { status: 200 });
  return new Response(JSON.stringify({ status: 'active' }), { status: 200 });
};

function signed(type: string, subId: string, status: string, at: number, payment?: { id: string; amount: number }) {
  const raw = JSON.stringify({ entity: 'event', event: type, created_at: at, payload: {
    subscription: { entity: { id: subId, plan_id: PLANS.ta_pro_test, status, current_start: T0, current_end: T0 + 30 * 86400, notes: {} } },
    ...(payment ? { payment: { entity: { id: payment.id, amount: payment.amount, currency: 'INR', status: 'captured', invoice_id: null, created_at: at } } } : {}),
  } });
  return { rawBody: Buffer.from(raw), signature: createHmac('sha256', SECRET).update(raw).digest('hex') };
}

describe('030_billing_subscriptions', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  let svc: InstanceType<typeof BillingService>;
  let sim: InstanceType<typeof SimSubscriptionBook>;
  let n = 0;

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_billing_${Date.now()}`;
      const a = new pg.Client({ connectionString: local });
      await a.connect();
      await a.query(`CREATE DATABASE ${dbName}`);
      await a.end();
      const u = new URL(local);
      u.pathname = `/${dbName}`;
      conn = u.toString();
    } else {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      conn = container.getConnectionUri();
    }
    const result = await applyMigrationsForTest(conn, MIGRATIONS_DIR);
    expect(result.errors).toHaveLength(0);
    expect(result.applied).toContain('030_billing_subscriptions.sql');
    pool = new pg.Pool({ connectionString: conn, max: 8 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active'), ('prn_bob', 'human', 'bob', 'active')`);
    sim = new SimSubscriptionBook();
    const gateway = new RazorpayGateway({ keyId: 'rzp_test_FakeKey123456', keySecret: async () => 'k', webhookSecret: async () => SECRET, fetch: fakeFetch });
    svc = new BillingService({ store: new PgBillingStore(pool), gateway, books: { sim }, idFactory: (p: string) => `${p}_${Date.now().toString(36)}${++n}`, gatewayPlans: PLANS });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (container) await container.stop();
    if (adminUrl && dbName) {
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await a.end();
    }
  });

  it('test-mode lifecycle in Postgres: activated → charged ⇒ one invoice (+ line, GST metadata pending review) and a sim posting', async () => {
    const s = await svc.start('prn_alice', { planId: 'ta_pro_test' });
    const subId = (await pool.query(`SELECT gateway_subscription_id FROM billing_subscriptions WHERE id = $1`, [s.subscriptionId])).rows[0].gateway_subscription_id;
    await svc.handleWebhook({ ...signed('subscription.activated', subId, 'active', T0 + 1), eventId: 'evt_pg_act' });
    const out = await svc.handleWebhook({ ...signed('subscription.charged', subId, 'active', T0 + 2, { id: 'pay_Pg0001', amount: 49900 }), eventId: 'evt_pg_chg' });
    expect(out).toMatchObject({ status: 'applied', posted: true });
    const inv = (await pool.query(`SELECT kind, mode, currency, total_minor::text AS t, gst_review_status, sac_code, tax_breakdown FROM invoices WHERE gateway_payment_id = 'pay_Pg0001'`)).rows;
    expect(inv).toEqual([{ kind: 'invoice', mode: 'test', currency: 'INR', t: '49900', gst_review_status: 'rprc_pending', sac_code: null, tax_breakdown: null }]);
    const lines = (await pool.query(`SELECT line_no, amount_minor::text AS a, ledger_txn_id FROM invoice_lines`)).rows;
    expect(lines).toEqual([{ line_no: 1, a: '49900', ledger_txn_id: null }]); // no real-book posting (Stage 20)
    expect(sim.balance('sim:platform:subscription_revenue')).toBe(49900n);
    expect((await pool.query(`SELECT count(*)::int AS n FROM ledger_entries`)).rows[0].n).toBe(0); // the real ledger is untouched
  });

  it('replays and concurrent duplicates are applied once (event id + payment id, in one transaction)', async () => {
    const subId = (await pool.query(`SELECT gateway_subscription_id FROM billing_subscriptions WHERE principal_id = 'prn_alice'`)).rows[0].gateway_subscription_id;
    const ev = signed('subscription.charged', subId, 'active', T0 + 40, { id: 'pay_Pg0002', amount: 49900 });
    const outs = await Promise.all(Array.from({ length: 6 }, () => svc.handleWebhook({ ...ev, eventId: 'evt_pg_dup' })));
    expect(outs.filter((o: { status: string }) => o.status === 'applied')).toHaveLength(1);
    const again = await svc.handleWebhook({ ...signed('subscription.charged', subId, 'active', T0 + 41, { id: 'pay_Pg0002', amount: 49900 }), eventId: 'evt_pg_other' });
    expect(again).toMatchObject({ status: 'applied', posted: false });
    expect((await pool.query(`SELECT count(*)::int AS n FROM billing_payments WHERE gateway_payment_id = 'pay_Pg0002'`)).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM invoices WHERE gateway_payment_id = 'pay_Pg0002'`)).rows[0].n).toBe(1);
  });

  it('invoices, lines, payments and webhook events are append-only; constraints hold', async () => {
    await expect(pool.query(`UPDATE invoices SET total_minor = 1`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM billing_webhook_events`)).rejects.toThrow(/append-only/);
    await expect(pool.query(`TRUNCATE invoice_lines`)).rejects.toThrow(/append-only/);
    // one open subscription per principal and mode
    await expect(pool.query(`INSERT INTO billing_subscriptions (id, principal_id, gateway, mode, plan_id, catalog_version, status) VALUES ('bsub_dup1', 'prn_alice', 'razorpay', 'test', 'ta_pro_test', 'v', 'active')`)).rejects.toThrow(/duplicate key/);
    // past_due must carry a grace end, and only past_due may
    await expect(pool.query(`INSERT INTO billing_subscriptions (id, principal_id, gateway, mode, plan_id, catalog_version, status) VALUES ('bsub_bad1', 'prn_bob', 'razorpay', 'test', 'ta_pro_test', 'v', 'past_due')`)).rejects.toThrow(/check constraint/);
    await expect(pool.query(`INSERT INTO billing_subscriptions (id, principal_id, gateway, mode, plan_id, catalog_version, status) VALUES ('bsub_bad2', 'prn_bob', 'stripe', 'test', 'ta_pro_test', 'v', 'active')`)).rejects.toThrow(/check constraint/);
  });

  it('a failed payment puts the subscription past_due with a grace end; the store reads it back', async () => {
    const subId = (await pool.query(`SELECT gateway_subscription_id FROM billing_subscriptions WHERE principal_id = 'prn_alice'`)).rows[0].gateway_subscription_id;
    await svc.handleWebhook({ ...signed('subscription.pending', subId, 'pending', T0 + 100), eventId: 'evt_pg_fail' });
    const cur = await svc.current('prn_alice');
    expect(cur.subscription).toMatchObject({ status: 'past_due', graceUntil: new Date((T0 + 100 + 7 * 86400) * 1000).toISOString() });
    expect(cur.entitlements.maxStrategies).toBe(5);
  });

  it('down migration removes the 030 tables and leaves 029 and the ledger in place', async () => {
    await pool.query(DOWN_SQL);
    for (const t of ['billing_subscriptions', 'billing_webhook_events', 'billing_payments', 'invoices', 'invoice_lines']) {
      expect((await pool.query(`SELECT to_regclass($1) AS t`, [`public.${t}`])).rows[0].t, t).toBeNull();
    }
    expect((await pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'trading_append_only_guard'`)).rowCount).toBe(1);
    expect((await pool.query(`SELECT to_regclass('public.ledger_txns') AS t`)).rows[0].t).toBe('ledger_txns');
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '030_billing_subscriptions.sql'`)).rowCount).toBe(0);
  });
});
