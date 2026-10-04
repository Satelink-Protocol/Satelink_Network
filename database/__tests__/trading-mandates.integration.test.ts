/**
 * Stage 16 — migration 026_mandates up/down + PgMandateStore driven by MandateService
 * on the 021 tables (mandates, orders, order_events, audit_events).
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB
 * pointing at a LOCAL server (the test creates and drops its own database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
import {
  MandateService, PgMandateStore,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/authorization/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '026_mandates.down.sql'), 'utf8');
const T0 = Date.UTC(2026, 9, 5, 12, 0);
const DAY = 86_400_000;
const alice = { principalId: 'prn_alice', kind: 'human', role: 'user' };
const DRAFT = (over = {}) => ({
  brokerAccountId: 'bka_1', environment: 'paper', mode: 'A', strategy: null, instruments: ['BTC-USDT'],
  limits: { currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000' },
  validUntil: new Date(T0 + 30 * DAY).toISOString(), ...over,
});

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('026_mandates', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  let svc: InstanceType<typeof MandateService>;
  let now = T0;
  let n = 0;
  let nonce = 0;
  const codes = ['111111', '222222', '333333', '444444', '555555', '666666'];

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_mandates_${Date.now()}`;
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
    expect(result.applied).toContain('026_mandates.sql');
    pool = new pg.Pool({ connectionString: conn, max: 4 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active')`);
    await pool.query(`INSERT INTO broker_accounts (id, principal_id, broker, environment, status) VALUES ('bka_1', 'prn_alice', 'binance', 'paper', 'active')`);
    svc = new MandateService({
      store: new PgMandateStore(pool),
      stepUp: { async availability() { return { available: true }; }, async verify({ code }: { code: string }) { return codes.includes(code) ? { ok: true, method: 'totp', userId: 'u1' } : { ok: false, reason: 'invalid_code' }; } },
      signer: { keyId: 'it-k1', secret: Buffer.alloc(32, 3) },
      accounts: { async get(id: string) { return id === 'bka_1' ? { id, principalId: 'prn_alice', broker: 'binance', environment: 'paper', status: 'active' } : null; } },
      clock: () => new Date(now), idFactory: (p: string) => `${p}_${++n}`, nonceFactory: () => (++nonce).toString(16).padStart(32, '0'),
    });
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

  const signNew = async (draft = DRAFT(), code = codes[0], supersedes = null) => {
    const p = await svc.propose({ actor: alice, principalId: 'prn_alice', draft, supersedes });
    await svc.sign({ actor: alice, mandateId: p.mandateId, termsHash: p.termsHash, nonce: p.nonce, code });
    return p;
  };

  it('propose → sign → verifyForOrder survives the JSONB round trip; code reuse is caught via audit_events', async () => {
    const p = await signNew();
    const view = await svc.verifyForOrder(p.mandateId);
    expect(view).toMatchObject({ status: 'active', mode: 'copilot', modeCode: 'A', stepUpMethod: 'totp', termsHash: p.termsHash });
    const row = (await pool.query(`SELECT status, mode, mode_code, approved_by, step_up_method, signature, terms_hash FROM mandates WHERE id = $1`, [p.mandateId])).rows[0];
    expect(row).toMatchObject({ status: 'active', mode: 'copilot', mode_code: 'A', approved_by: 'prn_alice', step_up_method: 'totp', terms_hash: p.termsHash });
    expect(row.signature).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    const q = await svc.propose({ actor: alice, principalId: 'prn_alice', draft: DRAFT({ instruments: ['ETH-USDT'] }) });
    await expect(svc.sign({ actor: alice, mandateId: q.mandateId, termsHash: q.termsHash, nonce: q.nonce, code: codes[0] })).rejects.toMatchObject({ code: 'REPLAY' });
    const actions = (await pool.query(`SELECT action FROM audit_events WHERE target_type = 'mandate' ORDER BY id`)).rows.map((r) => r.action);
    expect(actions).toEqual(['mandate.proposed', 'mandate.signed', 'mandate.proposed']);
  });

  it('the trigger keeps signed terms immutable, transitions legal, final states frozen, and rows undeletable', async () => {
    const p = await signNew(DRAFT(), codes[1]);
    await expect(pool.query(`UPDATE mandates SET max_notional_minor = 999999999 WHERE id = $1`, [p.mandateId])).rejects.toThrow(/immutable/);
    await expect(pool.query(`UPDATE mandates SET terms = jsonb_set(terms, '{limits,maxOrderNotionalMinor}', '"1"') WHERE id = $1`, [p.mandateId])).rejects.toThrow(/immutable/);
    await expect(pool.query(`UPDATE mandates SET status = 'draft' WHERE id = $1`, [p.mandateId])).rejects.toThrow(/illegal status transition/);
    await expect(pool.query(`UPDATE mandates SET signature = $2 WHERE id = $1`, [p.mandateId, `hmac-sha256:${'0'.repeat(64)}`])).rejects.toThrow(/illegal status transition active -> active/); // active rows only move to revoked/expired
    await expect(pool.query(`UPDATE mandates SET status = 'revoked', revoked_at = now(), revocation_reason = 'x', signature = $2 WHERE id = $1`, [p.mandateId, `hmac-sha256:${'0'.repeat(64)}`])).rejects.toThrow(/fixed once signed/);
    await expect(pool.query(`DELETE FROM mandates WHERE id = $1`, [p.mandateId])).rejects.toThrow(/cannot be deleted/);
    await expect(pool.query(`UPDATE mandates SET status = 'revoked' WHERE id = $1`, [p.mandateId])).rejects.toThrow(/mandates_revoked_has_reason/);
    await svc.revoke({ actor: alice, mandateId: p.mandateId, reason: 'done' });
    await expect(pool.query(`UPDATE mandates SET revocation_reason = 'edited' WHERE id = $1`, [p.mandateId])).rejects.toThrow(/is final/);
    await expect(pool.query(`UPDATE mandates SET status = 'active' WHERE id = $1`, [p.mandateId])).rejects.toThrow(/is final/);
  });

  it('versions: one active per lineage; signing v2 revokes v1 and cancels v1\'s open orders with order_events', async () => {
    now += 200_000;
    const v1 = await signNew(DRAFT(), codes[2]);
    for (const [id, status] of [['ord_a', 'proposed'], ['ord_b', 'approved'], ['ord_c', 'submitted'], ['ord_d', 'filled']]) {
      await pool.query(`INSERT INTO orders (id, principal_id, mandate_id, broker_account_id, client_order_id, instrument, side, order_type, quantity, mode, status, idempotency_key)
        VALUES ($1, 'prn_alice', $2, 'bka_1', $1, 'BTC-USDT', 'buy', 'market', 1, 'paper', $3, $1)`, [id, v1.mandateId, status]);
    }
    const v2 = await svc.propose({ actor: alice, principalId: 'prn_alice', supersedes: v1.mandateId, draft: DRAFT() });
    await expect(pool.query(`UPDATE mandates SET status = 'active', approved_at = now(), step_up_method = 'totp', signature = $2, signed_at = now(), signature_key_id = 'x' WHERE id = $1`,
      [v2.mandateId, `hmac-sha256:${'1'.repeat(64)}`])).rejects.toThrow(/uq_mandates_one_active_per_lineage/);
    await svc.sign({ actor: alice, mandateId: v2.mandateId, termsHash: v2.termsHash, nonce: v2.nonce, code: codes[3] });
    const st = (await pool.query(`SELECT id, status FROM orders ORDER BY id`)).rows.map((r) => `${r.id}:${r.status}`);
    expect(st).toEqual(['ord_a:cancelled', 'ord_b:cancelled', 'ord_c:cancel_requested', 'ord_d:filled']);
    const ev = (await pool.query(`SELECT order_id, event_type, from_status, to_status, actor FROM order_events ORDER BY order_id`)).rows;
    expect(ev).toEqual([
      { order_id: 'ord_a', event_type: 'mandate_cancel', from_status: 'proposed', to_status: 'cancelled', actor: 'user:prn_alice' },
      { order_id: 'ord_b', event_type: 'mandate_cancel', from_status: 'approved', to_status: 'cancelled', actor: 'user:prn_alice' },
      { order_id: 'ord_c', event_type: 'mandate_cancel', from_status: 'submitted', to_status: 'cancel_requested', actor: 'user:prn_alice' },
    ]);
    await expect(svc.verifyForOrder(v1.mandateId)).rejects.toMatchObject({ code: 'REVOKED' });
    expect((await svc.verifyForOrder(v2.mandateId)).status).toBe('active');
  });

  it('expireDue expires due mandates in Postgres', async () => {
    now += 200_000;
    const p = await signNew(DRAFT({ validUntil: new Date(now + DAY).toISOString() }), codes[4]);
    now += DAY;
    expect(await svc.expireDue()).toContain(p.mandateId);
    expect((await pool.query(`SELECT status FROM mandates WHERE id = $1`, [p.mandateId])).rows[0].status).toBe('expired');
  });

  it('down migration removes the 026 columns and trigger, keeping 021 mandates', async () => {
    await pool.query(DOWN_SQL);
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'mandates' AND column_name IN ('terms', 'terms_hash', 'signature', 'mode_code', 'lineage_id')`)).rowCount;
    expect(cols).toBe(0);
    expect((await pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'mandates_guard'`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '026_mandates.sql'`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM mandates`)).rows[0].n).toBeGreaterThan(0);
  });
});
