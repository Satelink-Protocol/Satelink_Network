/**
 * Stage 12 — migration 023_agent_traces up/down + the real PgTraceStore driven by
 * an AgentRunner (ScriptedProvider) against Postgres.
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
  ToolRegistry, createDefaultTools, ScriptedProvider, ModelRouter, TraceRecorder, PgTraceStore, AgentRunner,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/agent/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '023_agent_traces.down.sql'), 'utf8');
const FAKE_KEY = ['gsk', 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4'].join('_');

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('023_agent_traces', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let conn: string;
  let pool: pg.Pool;

  beforeAll(async () => {
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_agent_${Date.now()}`;
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
    expect(result.applied).toContain('023_agent_traces.sql');
    pool = new pg.Pool({ connectionString: conn, max: 2 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_agent', 'agent', 'agent', 'active')`);
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

  it('persists a run with a rejected place_order and redacted payloads', async () => {
    const proposals: unknown[] = [];
    const read = { orders: { list: async () => [] } };
    const registry = new ToolRegistry({ read, proposals: { create: async (p: unknown) => { proposals.push(p); return { proposalId: 'prp_x', status: 'pending_review' }; } } });
    for (const t of createDefaultTools()) registry.register(t);
    let n = 0;
    const tracer = new TraceRecorder({ store: new PgTraceStore(pool), clock: () => new Date('2026-01-01T00:00:00Z'), idFactory: (p: string) => `${p}_${++n}` });
    const provider = new ScriptedProvider({ id: 'scripted', script: [
      { toolCalls: [{ id: 'a', name: 'list_orders', arguments: '{}' }, { id: 'b', name: 'place_order', arguments: '{"quantity":"9"}' }] },
      { content: `done ${FAKE_KEY}` },
    ] });
    const router = new ModelRouter({ routes: { chat: [{ provider: 'scripted', model: 's-1' }] }, providers: { scripted: provider } });
    const out = await new AgentRunner({ registry, router, tracer }).run({ principalId: 'prn_agent', goal: `key ${FAKE_KEY}` });
    expect(out.status).toBe('completed');
    expect(proposals).toHaveLength(0);

    const run = (await pool.query(`SELECT * FROM agent_runs WHERE id = $1`, [out.runId])).rows[0];
    expect(run).toMatchObject({ status: 'completed', step_count: 2 });
    expect(run.goal_redacted).not.toContain(FAKE_KEY);
    expect(run.final_output_redacted).not.toContain(FAKE_KEY);
    const calls = (await pool.query(`SELECT tool_name, tier, status, rejection_code FROM tool_calls WHERE run_id = $1 ORDER BY seq`, [out.runId])).rows;
    expect(calls).toEqual([
      { tool_name: 'list_orders', tier: 'READ', status: 'ok', rejection_code: null },
      { tool_name: 'place_order', tier: 'REJECTED', status: 'rejected', rejection_code: 'FORBIDDEN_TOOL' },
    ]);
    const traces = (await pool.query(`SELECT task, provider, status, response_redacted::text AS r FROM model_traces WHERE run_id = $1 ORDER BY seq`, [out.runId])).rows;
    expect(traces.map((t) => [t.task, t.provider, t.status])).toEqual([['chat', 'scripted', 'ok'], ['chat', 'scripted', 'ok']]);
    const dump = async (t: string) => JSON.stringify((await pool.query(`SELECT row_to_json(x) AS j FROM ${t} x`)).rows);
    const all = (await dump('agent_runs')) + (await dump('tool_calls')) + (await dump('model_traces'));
    expect(all).not.toContain(FAKE_KEY);
  });

  it('enforces constraints: rejected rows must be tier REJECTED, (run_id, seq) unique, finished runs need finished_at', async () => {
    await pool.query(`INSERT INTO agent_runs (id, principal_id, status, goal_redacted, started_at) VALUES ('run_c', 'prn_agent', 'running', 'g', now())`);
    await expect(pool.query(`INSERT INTO tool_calls (id, run_id, seq, tool_name, tier, status, rejection_code, created_at) VALUES ('tc_c1', 'run_c', 1, 'place_order', 'CONTROLLED', 'rejected', 'FORBIDDEN_TOOL', now())`)).rejects.toThrow(/check constraint/);
    await pool.query(`INSERT INTO tool_calls (id, run_id, seq, tool_name, tier, status, created_at) VALUES ('tc_c2', 'run_c', 1, 'get_quote', 'READ', 'ok', now())`);
    await expect(pool.query(`INSERT INTO tool_calls (id, run_id, seq, tool_name, tier, status, created_at) VALUES ('tc_c3', 'run_c', 1, 'get_quote', 'READ', 'ok', now())`)).rejects.toThrow(/duplicate key/);
    await expect(pool.query(`UPDATE agent_runs SET status = 'completed' WHERE id = 'run_c'`)).rejects.toThrow(/check constraint/);
    await expect(pool.query(`INSERT INTO tool_calls (id, run_id, seq, tool_name, tier, status, created_at) VALUES ('tc_c4', 'run_c', 2, 'x', 'EXECUTE', 'ok', now())`)).rejects.toThrow(/check constraint/);
  });

  it('down migration drops exactly the three trace tables', async () => {
    const count = async () => (await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0].n;
    const before = await count();
    await pool.query(DOWN_SQL);
    expect(before - (await count())).toBe(3);
    const m = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '023_agent_traces.sql'`);
    expect(m.rowCount).toBe(0);
  });
});
