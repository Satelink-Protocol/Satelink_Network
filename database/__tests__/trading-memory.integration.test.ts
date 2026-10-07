/**
 * Phase 6 item 9 — migration 034_trading_memory + PgMemoryStore / MemoryService / feedback against
 * Postgres: profile versioning, decision chain with one outcome, append-only, bounded context equal to
 * the in-memory store's, calibration proposal + single human decision, down migration.
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB pointing at a LOCAL
 * server (the test creates and drops its own database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
// @ts-expect-error — plain ESM JS module
import { MemoryService, PgMemoryStore, InMemoryMemoryStore, runFeedback, decideCalibration } from '../../apps/api/src/trading_agent/memory/index.mjs';
// @ts-expect-error — plain ESM JS module
import { DecisionService, PgDecisionStore, DIMENSIONS } from '../../apps/api/src/trading_agent/decision/index.mjs';
// @ts-expect-error — plain ESM JS test helper
import { goodInput, NOW } from '../../apps/api/test/helpers/decision_fixture.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '034_trading_memory.down.sql'), 'utf8');

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('034_trading_memory', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  let n = 0;
  const ids = (p: string) => `${p}_${String(++n).padStart(5, '0')}`;
  const now = new Date(NOW);

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_memory_${Date.now()}`;
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
    expect(result.applied).toContain('034_trading_memory.sql');
    pool = new pg.Pool({ connectionString: conn, max: 4 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active'), ('prn_admin', 'human', 'admin', 'active')`);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (container) await container.stop();
    if (adminUrl && dbName) {
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await a.end();
    }
  });

  /** 40 real persisted GO decisions; out_of_sample predicts the outcome. Mirrors into an in-memory store. */
  async function seed(memPg: MemoryService, memMem: MemoryService) {
    const decisions = new DecisionService({ store: new PgDecisionStore(pool), idFactory: ids, clock: () => now });
    for (let i = 0; i < 40; i += 1) {
      const d = await decisions.evaluate(goodInput());
      const win = i % 2 === 0;
      const rec = { ...d, dimension_scores: { ...d.dimension_scores, out_of_sample: win ? 80 : 40 } };
      for (const m of [memPg, memMem]) {
        await m.recordDecision(rec);
        await m.recordOutcome({ decisionId: d.id, principalId: 'prn_alice', outcome: win ? 'profit' : 'loss', pnl: win ? '12.5' : '-10' });
      }
    }
  }

  it('profile upsert bumps the version', async () => {
    const mem = new MemoryService({ store: new PgMemoryStore(pool), idFactory: ids, clock: () => now });
    expect((await mem.setProfile({ principalId: 'prn_alice', riskTolerance: 'low', maxLoss: '200', markets: ['BTC-USDT'] })).version).toBe(1);
    expect((await mem.setProfile({ principalId: 'prn_alice', riskTolerance: 'low', maxLoss: '200', markets: ['BTC-USDT'] })).version).toBe(2);
  });

  it('decision chain persists; a second outcome is refused by the unique index; rows are append-only', async () => {
    const memMem = new MemoryService({ store: new InMemoryMemoryStore(), idFactory: ids, clock: () => now });
    await memMem.setProfile({ principalId: 'prn_alice', riskTolerance: 'low', maxLoss: '200', markets: ['BTC-USDT'] });
    const memPg = new MemoryService({ store: new PgMemoryStore(pool), idFactory: ids, clock: () => now });
    await seed(memPg, memMem);
    const first = (await pool.query(`SELECT decision_id FROM decision_memory WHERE entry_kind = 'outcome' LIMIT 1`)).rows[0].decision_id;
    await expect(memPg.recordOutcome({ decisionId: first, principalId: 'prn_alice', outcome: 'loss' })).rejects.toThrow(/uq_decision_memory_outcome/);
    await expect(pool.query(`UPDATE decision_memory SET outcome = 'profit'`)).rejects.toThrow();
    await expect(pool.query(`DELETE FROM decision_memory`)).rejects.toThrow();
    const ctxPg = await memPg.contextFor({ principalId: 'prn_alice', limit: 5 });
    const ctxMem = await memMem.contextFor({ principalId: 'prn_alice', limit: 5 });
    expect(ctxPg.summary).toBe(ctxMem.summary);
    expect(ctxPg.decisions.byOutcome).toEqual({ profit: 20, loss: 20 });
    expect(ctxPg.decisions.recent).toHaveLength(5);
  });

  it('feedback stores a pending proposal; one human decision; approval yields scorecard/1.1', async () => {
    const store = new PgMemoryStore(pool);
    const r = await runFeedback({ store, idFactory: ids, clock: () => now });
    expect(r.status).toBe('proposed');
    expect(Object.keys(r.proposal.weights)).toEqual([...DIMENSIONS]);
    const args = { store, proposal: r.proposal, isStaff: async (p: string) => p === 'prn_admin', stepUp: { verify: async () => ({ ok: true, method: 'totp' }) }, clock: () => now, actor: { kind: 'human', principalId: 'prn_admin' }, code: '123456' };
    const cfg = await decideCalibration({ ...args, decision: 'approved' });
    expect(cfg.version).toBe('scorecard/1.1');
    await expect(decideCalibration({ ...args, decision: 'rejected' })).rejects.toThrow(/duplicate key|calibration_decisions_pkey/);
    expect((await pool.query('SELECT decision, decided_by, step_up_method FROM calibration_decisions')).rows).toEqual([{ decision: 'approved', decided_by: 'prn_admin', step_up_method: 'totp' }]);
  });

  it('down migration drops the memory tables and leaves 033 intact', async () => {
    await pool.query(DOWN_SQL);
    for (const t of ['user_trading_profile', 'decision_memory', 'calibration_proposals']) expect((await pool.query(`SELECT to_regclass($1) AS t`, [t])).rows[0].t).toBeNull();
    expect((await pool.query(`SELECT count(*)::int AS n FROM trading_decisions`)).rows[0].n).toBe(40);
  });
});
