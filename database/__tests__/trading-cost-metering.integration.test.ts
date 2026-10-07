/**
 * Phase 6 item 3 — migration 032_model_cost_metering + PgTraceStore cost metering driven by the
 * TieredModelRouter (ScriptedProvider) against Postgres; costBy per user / strategy / opportunity /
 * machine request; constraint and down migration.
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
import {
  ScriptedProvider, ProviderError, TieredModelRouter, TraceRecorder, PgTraceStore,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/agent/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '032_model_cost_metering.down.sql'), 'utf8');

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('032_model_cost_metering', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  let n = 0;

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_cost_${Date.now()}`;
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
    expect(result.applied).toContain('032_model_cost_metering.sql');
    pool = new pg.Pool({ connectionString: conn, max: 4 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active'), ('prn_bot', 'agent', 'bot', 'active')`);
  }, 120_000);

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

  const recorder = () => new TraceRecorder({ store: new PgTraceStore(pool), clock: () => new Date('2026-10-07T00:00:00Z'), idFactory: (p: string) => `${p}_${Date.now()}_${++n}` });
  const usage = { inputTokens: 1000, outputTokens: 100 };

  it('records tier, task type, cost and attribution per attempt; aggregates per user / strategy / opportunity / machine request', async () => {
    const anth = new ScriptedProvider({ id: 'anthropic', script: [
      new ProviderError('rl', { retryable: true, provider: 'anthropic' }),
      { content: 'a', model: 'claude-sonnet-5', usage },
      { content: 'b', model: 'claude-sonnet-5', usage },
    ] });
    const groq = new ScriptedProvider({ id: 'groq', script: [{ content: 'g', model: 'llama-3.3-70b-versatile', usage }] });
    const router = new TieredModelRouter({ providers: { anthropic: anth, groq } });
    const rec = recorder();
    const runA = await rec.startRun({ principalId: 'prn_alice', goal: 'g' });
    // 1st: anthropic 429 → groq fallback (unpriced)
    await router.complete({ taskType: 'draft_strategy', messages: [{ role: 'user', content: 'x' }], runId: runA, recorder: rec, attribution: { strategyId: 'stg_1' } });
    await router.complete({ taskType: 'explain_risk', messages: [{ role: 'user', content: 'x' }], runId: runA, recorder: rec, attribution: { strategyId: 'stg_1', opportunityId: 'opp_1' } });
    const rec2 = recorder();
    const runB = await rec2.startRun({ principalId: 'prn_bot', goal: 'g' });
    await router.complete({ taskType: 'portfolio_note', messages: [{ role: 'user', content: 'x' }], runId: runB, recorder: rec2, attribution: { machineRequestId: 'mreq_7' } });

    const rows = (await pool.query(`SELECT t.provider, t.status, t.tier, t.task_type, t.cost_priced, t.cost_usd_micro::text AS c FROM model_traces t JOIN agent_runs r ON r.id = t.run_id ORDER BY r.principal_id, t.seq`)).rows;
    expect(rows.map((r) => [r.provider, r.status, r.tier, r.task_type, r.cost_priced, r.c])).toEqual([
      ['anthropic', 'error', 'standard', 'draft_strategy', false, null],
      ['groq', 'fallback', 'standard', 'draft_strategy', false, null],
      ['anthropic', 'ok', 'standard', 'explain_risk', true, '3000'],
      ['anthropic', 'ok', 'standard', 'portfolio_note', true, '3000'],
    ]);
    const store = new PgTraceStore(pool);
    expect(await store.costBy('principal')).toEqual([
      { key: 'prn_alice', calls: 3, pricedCalls: 1, unpricedCalls: 2, costUsdMicro: '3000', inputTokens: 2000, outputTokens: 200 },
      { key: 'prn_bot', calls: 1, pricedCalls: 1, unpricedCalls: 0, costUsdMicro: '3000', inputTokens: 1000, outputTokens: 100 },
    ]);
    expect((await store.costBy('strategy')).map((x: { key: string; costUsdMicro: string; calls: number }) => [x.key, x.calls, x.costUsdMicro])).toEqual([['stg_1', 3, '3000']]);
    expect((await store.costBy('opportunity')).map((x: { key: string; costUsdMicro: string }) => [x.key, x.costUsdMicro])).toEqual([['opp_1', '3000']]);
    expect((await store.costBy('machine_request')).map((x: { key: string; costUsdMicro: string }) => [x.key, x.costUsdMicro])).toEqual([['mreq_7', '3000']]);
    expect(await store.costBy('principal', { since: '2030-01-01T00:00:00Z' })).toEqual([]);
  });

  it('a priced row without a cost or price version is rejected; model_traces stays append-only for the app role', async () => {
    const run = (await pool.query(`SELECT id FROM agent_runs LIMIT 1`)).rows[0].id;
    await expect(pool.query(
      `INSERT INTO model_traces (id, run_id, seq, task, provider, model, status, created_at, cost_priced) VALUES ('mt_bad', $1, 99, 'chat', 'x', 'y', 'ok', now(), true)`, [run],
    )).rejects.toThrow(/model_traces_cost_priced_ck/);
    const c = await pool.connect();
    try {
      await c.query('SET ROLE satelink_app');
      await expect(c.query(`UPDATE model_traces SET cost_usd_micro = 0`)).rejects.toThrow(/permission denied/);
    } finally { await c.query('RESET ROLE'); c.release(); }
  });

  it('down migration removes the columns and its schema_migrations row; 023 data survives', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM model_traces')).rows[0].n;
    await pool.query(DOWN_SQL);
    const cols = (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'model_traces' AND column_name IN ('tier', 'cost_usd_micro', 'strategy_id')`)).rows;
    expect(cols).toEqual([]);
    expect((await pool.query('SELECT count(*)::int AS n FROM model_traces')).rows[0].n).toBe(before);
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '032_model_cost_metering.sql'`)).rowCount).toBe(0);
  });
});
