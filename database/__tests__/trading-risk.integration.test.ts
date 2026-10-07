/**
 * Stage 15 — migration 025_risk_engine up/down + PgRiskStore + RiskEngine on Postgres
 * (risk_policies 021+025, kill_switch_events 025, audit_events 021).
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
  PgRiskStore, RiskPolicyService, KillSwitchService, RiskEngine,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/risk/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '025_risk_engine.down.sql'), 'utf8');
const NOW = Date.UTC(2026, 9, 5, 14, 0);
const alice = { principalId: 'prn_alice', kind: 'human', role: 'user' };
const admin = { principalId: 'prn_ops', kind: 'human', role: 'admin' };
const DRAFT = { currency: 'USDT', decimals: 2, maxOrderNotionalMinor: '100000', maxDailyNotionalMinor: '500000', maxDailyLossMinor: '20000', maxLeverage: '2.5', maxOpenPositions: 3, allowedInstruments: ['BTC-USDT'], killSwitch: false };

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('025_risk_engine', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  let store: InstanceType<typeof PgRiskStore>;
  let n = 0;
  const ids = (p: string) => `${p}_${Date.now()}_${++n}`;

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_risk_${Date.now()}`;
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
    expect(result.applied).toContain('025_risk_engine.sql');
    pool = new pg.Pool({ connectionString: conn, max: 4 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active')`);
    store = new PgRiskStore(pool);
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

  it('policy versions are immutable rows whose hash is re-verified on read', async () => {
    const svc = new RiskPolicyService({ store, planCaps: async () => ({ maxLeverage: '3', currency: 'USDT' }), idFactory: ids });
    const v1 = await svc.createVersion({ actor: alice, principalId: 'prn_alice', draft: DRAFT });
    const v2 = await svc.createVersion({ actor: admin, principalId: 'prn_alice', draft: { ...DRAFT, maxOpenPositions: 5 } });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    const active = await svc.activePolicy('prn_alice', null);
    expect(active).toMatchObject({ version: 2, maxLeverage: '2.5', maxOpenPositions: 5, killSwitch: false, hash: v2.policyHash });
    expect(active.limits.breakers.maxConsecutiveLosses).toBe(5);
    await expect(pool.query(`UPDATE risk_policies SET kill_switch = false WHERE id = $1`, [v1.id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`DELETE FROM risk_policies WHERE id = $1`, [v1.id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`INSERT INTO risk_policies (id, principal_id, version, max_order_notional_minor, max_daily_notional_minor, max_daily_loss_minor, currency, decimals)
      VALUES ('rsk_dup', 'prn_alice', 2, 1, 1, 1, 'USDT', 2)`)).rejects.toThrow(/duplicate key/);
    // tampering at rest (trigger bypassed by a superuser) is caught by the integrity check
    await pool.query(`ALTER TABLE risk_policies DISABLE TRIGGER risk_policies_immutable`);
    await pool.query(`UPDATE risk_policies SET max_leverage = 9 WHERE id = (SELECT id FROM risk_policies WHERE version = 2 AND principal_id = 'prn_alice' AND mandate_id IS NULL)`);
    await pool.query(`ALTER TABLE risk_policies ENABLE TRIGGER risk_policies_immutable`);
    await expect(svc.activePolicy('prn_alice', null)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('kill switch events are append-only and constrained', async () => {
    const ks = new KillSwitchService({ store, clock: () => new Date(NOW) });
    await ks.engage({ actor: alice, scopeType: 'mandate', scopeId: 'mdt_1', principalId: 'prn_alice', reason: 'pause' });
    await ks.engage({ actor: admin, scopeType: 'global', reason: 'incident' });
    expect((await ks.engaged('prn_alice')).map((e: { scopeType: string }) => e.scopeType).sort()).toEqual(['global', 'mandate']);
    await ks.release({ actor: admin, scopeType: 'global', reason: 'resolved' });
    expect((await ks.engaged('prn_alice')).map((e: { scopeType: string }) => e.scopeType)).toEqual(['mandate']);
    await expect(pool.query(`UPDATE kill_switch_events SET action = 'release'`)).rejects.toThrow(/append-only/); // 029: even a superuser is refused
    const grants = (await pool.query(`SELECT has_table_privilege('public', 'kill_switch_events', 'UPDATE') AS u, has_table_privilege('public', 'kill_switch_events', 'DELETE') AS d`)).rows[0];
    expect(grants).toEqual({ u: false, d: false }); // …but PUBLIC (and satelink_app) cannot
    const bad = [
      `('global', 'x', NULL, 'engage', 'admin', 'a', 'r')`, // global with an id
      `('mandate', NULL, 'prn_alice', 'engage', 'user', 'a', 'r')`, // scoped without an id
      `('mandate', 'mdt_1', 'prn_alice', 'release', 'circuit_breaker', 'a', 'r')`, // breakers only engage
      `('mandate', 'mdt_1', NULL, 'engage', 'user', 'a', 'r')`, // user source needs a principal
      `('mandate', 'mdt_1', 'prn_alice', 'engage', 'user', 'a', '')`, // empty reason
    ];
    for (const v of bad) {
      await expect(pool.query(`INSERT INTO kill_switch_events (scope_type, scope_id, principal_id, action, source, actor_id, reason) VALUES ${v}`), v).rejects.toThrow(/check constraint/);
    }
  });

  it('decisions are recorded in audit_events; a breaker trip lands in kill_switch_events', async () => {
    // Fresh slate for this test: the 029 guard blocks DELETE for every role, so a superuser must disable it first (the residual risk 029 documents).
    await pool.query(`ALTER TABLE kill_switch_events DISABLE TRIGGER kill_switch_events_append_only`);
    await pool.query(`DELETE FROM kill_switch_events`);
    await pool.query(`ALTER TABLE kill_switch_events ENABLE TRIGGER kill_switch_events_append_only`);
    const ctx = { now: NOW, policy: null };
    const engine = new RiskEngine({ loadContext: async () => ctx, store, idFactory: ids, clock: () => new Date(NOW) });
    const order = { idempotencyKey: 'idem_risk_0001', principalId: 'prn_alice', mandateId: 'mdt_1' };
    const d = await engine.decide(order);
    expect([d.decision, d.failedCheck.code, d.recorded]).toEqual(['REJECT', 'POLICY_MISSING', true]);
    const row = (await pool.query(`SELECT actor_type, actor_id, principal_id, target_id, payload FROM audit_events WHERE action = 'risk.decision'`)).rows[0];
    expect(row).toMatchObject({ actor_type: 'system', actor_id: 'risk-engine', principal_id: 'prn_alice', target_id: 'idem_risk_0001' });
    expect(row.payload).toMatchObject({ decision: 'REJECT', checksVersion: 'risk-checks/1.1', decisionId: d.decisionId });
    expect(row.payload.trace).toHaveLength(20);

    const breaker = new RiskEngine({
      loadContext: async () => ({ now: NOW, policy: { killSwitch: false, limits: { breakers: { maxConsecutiveLosses: 2, maxConsecutiveRejects: 9, maxBrokerErrors: 9 } } }, killSwitchEvents: [], activity: { consecutiveLosses: 2, consecutiveRejects: 0, brokerErrorsInWindow: 0 } }),
      store, idFactory: ids, clock: () => new Date(NOW),
    });
    const t = await breaker.decide(order);
    expect([t.failedCheck.code, t.trip.engaged]).toEqual(['BREAKER_CONSECUTIVE_LOSSES', true]);
    const ev = (await pool.query(`SELECT scope_type, scope_id, principal_id, action, source FROM kill_switch_events`)).rows;
    expect(ev).toEqual([{ scope_type: 'mandate', scope_id: 'mdt_1', principal_id: 'prn_alice', action: 'engage', source: 'circuit_breaker' }]);
  });

  it('down migration removes kill_switch_events and the 025 columns, keeping risk_policies', async () => {
    await pool.query(DOWN_SQL);
    expect((await pool.query(`SELECT to_regclass('public.kill_switch_events') AS t`)).rows[0].t).toBeNull();
    expect((await pool.query(`SELECT to_regclass('public.risk_policies') AS t`)).rows[0].t).toBe('risk_policies');
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'risk_policies' AND column_name IN ('limits', 'policy_hash', 'created_by', 'created_by_role')`)).rowCount;
    expect(cols).toBe(0);
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '025_risk_engine.sql'`)).rowCount).toBe(0);
    await pool.query(`UPDATE risk_policies SET kill_switch = true`); // trigger gone with the down migration
  });
});
