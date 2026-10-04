/**
 * Stage 13 — StrategyService + PgStrategyStore on the migration 021 tables
 * (strategies, strategy_versions, audit_events). No new migration.
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB
 * pointing at a LOCAL server (the test creates and drops its own database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
import {
  StrategyService, PgStrategyStore, LifecycleState as S,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/strategies/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const ENV = { TRADING_FLAG_TRADING_AGENT: 'true' };
const alice = { principalId: 'prn_alice', kind: 'human' };

const DSL = (stopLossPct = '2') => ({
  dsl: 'satelink.strategy/1.0', name: 'SMA cross', universe: { venue: 'binance', instruments: ['BTC-USDT'] }, timeframe: '1h',
  indicators: { fast: { type: 'sma', period: 10 }, slow: { type: 'sma', period: 30 } },
  entry: { cross: { dir: 'above', left: { ind: 'fast' }, right: { ind: 'slow' } } },
  exit: { cross: { dir: 'below', left: { ind: 'fast' }, right: { ind: 'slow' } } },
  position: { side: 'long', sizing: { mode: 'fixed_notional', notional: '100.00', currency: 'USDT' } },
  risk: { stopLossPct },
});

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('Stage 13 strategy store on 021 tables', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  let svc: InstanceType<typeof StrategyService>;

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_strategy_${Date.now()}`;
      const admin = new pg.Client({ connectionString: local });
      await admin.connect();
      await admin.query(`CREATE DATABASE ${dbName}`);
      await admin.end();
      const u = new URL(local);
      u.pathname = `/${dbName}`;
      conn = u.toString();
    } else {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();
      conn = container.getConnectionUri();
    }
    const result = await applyMigrationsForTest(conn, MIGRATIONS_DIR);
    expect(result.errors).toHaveLength(0);
    pool = new pg.Pool({ connectionString: conn, max: 6 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active')`);
    let n = 0;
    svc = new StrategyService({ store: new PgStrategyStore(pool), idFactory: (p: string) => `${p}_${Date.now()}_${++n}`, env: ENV });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (container) await container.stop();
    if (adminUrl && dbName) {
      const admin = new pg.Client({ connectionString: adminUrl });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin.end();
    }
  });

  it('stores immutable versions whose hash survives the JSONB round-trip; same content is idempotent', async () => {
    const s = await svc.createStrategy({ actor: alice, name: 'Trend' });
    const v1 = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: DSL() });
    const again = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: JSON.stringify(DSL(), null, 2) });
    expect(again).toMatchObject({ id: v1.id, created: false });
    const v2 = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: DSL('3') });
    expect(v2).toMatchObject({ version: 2, created: true });
    const read = await svc.getVersion(v1.id); // JSONB reorders keys; the canonical hash must still match
    expect(read).toMatchObject({ definitionHash: v1.definitionHash, state: S.DRAFT });
    const row = (await pool.query(`SELECT definition_hash FROM strategy_versions WHERE id = $1`, [v1.id])).rows[0];
    expect(row.definition_hash).toBe(v1.definitionHash);
    const ev = await svc.compileVersion(v1.id);
    expect(ev.warmupBars).toBe(31);

    // tampering at rest is detected on read (superuser test DB; the app role has UPDATE revoked by 021)
    await pool.query(`UPDATE strategy_versions SET definition = jsonb_set(definition, '{risk,stopLossPct}', '"49"') WHERE id = $1`, [v2.id]);
    await expect(svc.getVersion(v2.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('walks the lifecycle with append-only audit rows and a projected strategies.status', async () => {
    const s = await svc.createStrategy({ actor: alice, name: 'Lifecycle' });
    const v = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: DSL('4') });
    await svc.transition({ actor: alice, versionId: v.id, to: S.BACKTESTED, expectedFrom: S.DRAFT,
      evidence: { backtest: { backtestId: 'bkt_00000001', definitionHash: v.definitionHash, bars: 1000, passed: true } } });
    await svc.transition({ actor: alice, versionId: v.id, to: S.PAPER, expectedFrom: S.BACKTESTED, evidence: { approval: { approvedBy: 'prn_alice', note: 'go' } } });
    const status = async () => (await pool.query(`SELECT status FROM strategies WHERE id = $1`, [s.id])).rows[0].status;
    expect(await status()).toBe('active');
    await svc.transition({ actor: { principalId: 'prn_risk', kind: 'platform' }, versionId: v.id, to: S.PAUSED, expectedFrom: S.PAPER, evidence: { reason: 'drawdown' } });
    expect(await status()).toBe('paused');
    await expect(svc.transition({ actor: alice, versionId: v.id, to: S.LIVE, expectedFrom: S.PAUSED, evidence: {} })).rejects.toMatchObject({ code: 'ILLEGAL_TRANSITION' });
    const rows = (await pool.query(
      `SELECT actor_type, action, payload->>'from' AS f, payload->>'to' AS t FROM audit_events WHERE target_id = $1 ORDER BY id`, [v.id])).rows;
    expect(rows.map((r) => [r.actor_type, r.action, r.f, r.t])).toEqual([
      ['user', 'strategy.version_created', null, null],
      ['user', 'strategy.lifecycle', null, 'DRAFT'],
      ['user', 'strategy.lifecycle', 'DRAFT', 'BACKTESTED'],
      ['user', 'strategy.lifecycle', 'BACKTESTED', 'PAPER'],
      ['system', 'strategy.lifecycle', 'PAPER', 'PAUSED'],
    ]);
  });

  it('concurrent transitions on one version: exactly one wins (row lock + expected state)', async () => {
    const s = await svc.createStrategy({ actor: alice, name: 'Race' });
    const v = await svc.createVersion({ actor: alice, strategyId: s.id, dsl: DSL('5') });
    const evidence = { backtest: { backtestId: 'bkt_00000002', definitionHash: v.definitionHash, bars: 1000, passed: true } };
    const results = await Promise.allSettled(Array.from({ length: 5 }, () =>
      svc.transition({ actor: alice, versionId: v.id, to: S.BACKTESTED, expectedFrom: S.DRAFT, evidence })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['CONFLICT', 'CONFLICT', 'CONFLICT', 'CONFLICT']);
    const n = (await pool.query(`SELECT count(*)::int AS n FROM audit_events WHERE target_id = $1 AND payload->>'to' = 'BACKTESTED'`, [v.id])).rows[0].n;
    expect(n).toBe(1);
  });
});
