/**
 * Stage 14 — migration 024_backtests up/down + PgBacktestStore as a SKIP LOCKED job queue,
 * driven by BacktestJobService with the real StrategyService/PgStrategyStore (021 tables).
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
  StrategyService, PgStrategyStore,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/strategies/index.mjs';
import {
  BacktestJobService, PgBacktestStore, backtestEvidence,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/backtest/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '024_backtests.down.sql'), 'utf8');
const H = 3_600_000;
const T0 = Date.UTC(2026, 0, 5);
const alice = { principalId: 'prn_alice', kind: 'human' };

const DSL = {
  dsl: 'satelink.strategy/1.0', name: 'SMA', universe: { venue: 'binance', instruments: ['BTC-USDT'] }, timeframe: '1h',
  indicators: { fast: { type: 'sma', period: 5 }, slow: { type: 'sma', period: 20 } },
  entry: { cross: { dir: 'above', left: { ind: 'fast' }, right: { ind: 'slow' } } },
  exit: { cross: { dir: 'below', left: { ind: 'fast' }, right: { ind: 'slow' } } },
  position: { side: 'long', sizing: { mode: 'fixed_notional', notional: '1000', currency: 'USDT' } }, risk: { stopLossPct: '3' },
};
const PARAMS = {
  params: 'satelink.sim-params/1.0', initialCash: '10000', quoteCurrency: 'USDT', windowBars: 60,
  instruments: { 'BTC-USDT': { tickSize: '0.01', lotSize: '0.0001', minQuantity: '0.0001', minNotional: '5' } },
};
const CANDLES = Array.from({ length: 600 }, (_, i) => {
  const o = 100 + 10 * Math.sin(i / 15);
  const c = 100 + 10 * Math.sin((i + 1) / 15);
  return { instrument: 'BTC-USDT', openTime: T0 + i * H, open: o.toFixed(2), high: (Math.max(o, c) + 0.5).toFixed(2), low: (Math.min(o, c) - 0.5).toFixed(2), close: c.toFixed(2), volume: '100' };
});

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('024_backtests', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  let strategies: InstanceType<typeof StrategyService>;
  let versionId: string;
  let definitionHash: string;
  let n = 0;
  const jobs = () => new BacktestJobService({
    store: new PgBacktestStore(pool), strategies, history: { getCandles: async () => CANDLES },
    clock: () => new Date(T0 + (n += 1) * 1000), newId: () => `bkt_${String(++n).padStart(12, '0')}`,
  });

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_backtests_${Date.now()}`;
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
    expect(result.applied).toContain('024_backtests.sql');
    pool = new pg.Pool({ connectionString: conn, max: 6 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active')`);
    let k = 0;
    strategies = new StrategyService({ store: new PgStrategyStore(pool), idFactory: (p: string) => `${p}_${Date.now()}_${++k}` });
    const s = await strategies.createStrategy({ actor: alice, name: 'SMA' });
    const v = await strategies.createVersion({ actor: alice, strategyId: s.id, dsl: DSL });
    versionId = v.id;
    definitionHash = v.definitionHash;
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

  it('runs queued backtests to a completed, hypothetical, frozen row', async () => {
    const svc = jobs();
    const { id } = await svc.enqueue({ principalId: 'prn_alice', strategyVersionId: versionId, fromMs: T0, toMs: T0 + 600 * H, params: PARAMS });
    expect((await pool.query(`SELECT status, label, mode FROM backtests WHERE id = $1`, [id])).rows[0]).toEqual({ status: 'queued', label: 'hypothetical', mode: 'backtest' });
    expect(await svc.runOnce()).toMatchObject({ id, status: 'completed' });
    const row = await new PgBacktestStore(pool).get(id);
    expect(row).toMatchObject({ status: 'completed', label: 'hypothetical', bars: 600, attempts: 1, definitionHash });
    expect(row.result.label).toBe('hypothetical');
    expect(row.result.resultHash).toBe(row.resultHash);
    expect(backtestEvidence(row)).toEqual({ backtestId: id, definitionHash, bars: 600, passed: row.passed });
    await expect(pool.query(`UPDATE backtests SET passed = NOT passed WHERE id = $1`, [id])).rejects.toThrow(/is final/);
    await expect(svc.runOnce()).resolves.toBeNull();
  });

  it('concurrent workers claim distinct jobs (FOR UPDATE SKIP LOCKED)', async () => {
    const svc = jobs();
    const ids = [];
    for (let i = 0; i < 4; i += 1) ids.push((await svc.enqueue({ principalId: 'prn_alice', strategyVersionId: versionId, fromMs: T0, toMs: T0 + 600 * H, params: PARAMS })).id);
    const results = await Promise.all(Array.from({ length: 6 }, () => jobs().runOnce()));
    const claimed = results.filter(Boolean).map((r) => r.id).sort();
    expect(claimed).toEqual([...ids].sort());
    const attempts = (await pool.query(`SELECT attempts FROM backtests WHERE id = ANY($1)`, [ids])).rows.map((r) => r.attempts);
    expect(attempts).toEqual([1, 1, 1, 1]);
    // Same version + params + data → same simulation. (result_hash differs: each sealed result embeds its own backtestId.)
    const rows = (await pool.query(`SELECT data_hash, result_hash, result - 'backtestId' - 'resultHash' AS sim FROM backtests WHERE id = ANY($1)`, [ids])).rows;
    expect(new Set(rows.map((r) => r.data_hash)).size).toBe(1);
    expect(new Set(rows.map((r) => JSON.stringify(r.sim))).size).toBe(1);
    expect(new Set(rows.map((r) => r.result_hash)).size).toBe(4);
  });

  it('enforces labels, id prefixes, provenance immutability and no deletes', async () => {
    const base = `'prn_alice', '${versionId}', '${definitionHash}'`;
    const p = `'{}'::jsonb, '${definitionHash}'`;
    await expect(pool.query(`INSERT INTO backtests (id, principal_id, strategy_version_id, definition_hash, mode, label, status, engine_version, params, params_hash, data_from, data_to)
      VALUES ('bkt_badlabel01', ${base}, 'backtest', 'simulated', 'queued', 'sim-1.0', ${p}, now(), now() + interval '1 day')`)).rejects.toThrow(/check constraint/);
    await expect(pool.query(`INSERT INTO backtests (id, principal_id, strategy_version_id, definition_hash, mode, label, status, engine_version, params, params_hash)
      VALUES ('bkt_paperwrong1', ${base}, 'paper', 'simulated', 'running', 'sim-1.0', ${p})`)).rejects.toThrow(/check constraint/);
    await pool.query(`INSERT INTO backtests (id, principal_id, strategy_version_id, definition_hash, mode, label, status, engine_version, params, params_hash, started_at)
      VALUES ('ppr_paperrun01', ${base}, 'paper', 'simulated', 'running', 'sim-1.0', ${p}, now())`);
    await expect(pool.query(`UPDATE backtests SET label = 'hypothetical' WHERE id = 'ppr_paperrun01'`)).rejects.toThrow(/immutable|check constraint/);
    await expect(pool.query(`UPDATE backtests SET params = '{"x":1}' WHERE id = 'ppr_paperrun01'`)).rejects.toThrow(/immutable/);
    await expect(pool.query(`UPDATE backtests SET status = 'completed', finished_at = now() WHERE id = 'ppr_paperrun01'`)).rejects.toThrow(/check constraint/);
    const grants = (await pool.query(`SELECT has_table_privilege('public', 'backtests', 'DELETE') AS d`)).rows[0];
    expect(grants.d).toBe(false);
  });

  it('down migration drops only backtests', async () => {
    const count = async () => (await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0].n;
    const before = await count();
    await pool.query(DOWN_SQL);
    expect(before - (await count())).toBe(1);
    expect((await pool.query(`SELECT 1 FROM pg_proc WHERE proname = 'backtests_guard'`)).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '024_backtests.sql'`)).rowCount).toBe(0);
  });
});
