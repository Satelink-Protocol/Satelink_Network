/**
 * Phase 6 item 8 — an orchestrator run persisted end to end in Postgres: agent_runs + tool_calls +
 * model_traces (tier, cost, opportunity attribution) + trading_decisions, all under one run.
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB pointing at a LOCAL
 * server (the test creates and drops its own database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
import {
  ToolRegistry, createDefaultTools, ScriptedProvider, TieredModelRouter, TraceRecorder, PgTraceStore,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/agent/index.mjs';
// @ts-expect-error — plain ESM JS module
import { DecisionService, PgDecisionStore } from '../../apps/api/src/trading_agent/decision/index.mjs';
// @ts-expect-error — plain ESM JS module
import { Orchestrator } from '../../apps/api/src/trading_agent/orchestrator/index.mjs';
// @ts-expect-error — plain ESM JS module
import { parseStrategyDsl } from '../../apps/api/src/trading_agent/strategies/index.mjs';
// @ts-expect-error — plain ESM JS test helper
import { goodInput, NOW } from '../../apps/api/test/helpers/decision_fixture.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

const REPLIES: Record<string, unknown> = {
  Market: { summary: 'Ranging.', observations: [] }, 'Regime-interpreter': { interpretation: 'Ranging.', cautions: [] },
  'Risk-explainer': { explanation: 'Checks apply.' }, Portfolio: { note: 'Small.' },
};

describe('orchestrator run persisted in Postgres', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_orch_${Date.now()}`;
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
    pool = new pg.Pool({ connectionString: conn, max: 4 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active')`);
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

  it('one run id ties agent run, tool calls, metered model traces and the decision together', async () => {
    const read = {
      marketData: { async getQuote(_p: string, instrument: string) { return { data: { kind: 'quote', instrument }, freshness: { stale: false, ageMs: 1 } }; }, async getCandles() { return { data: [], freshness: { stale: false } }; } },
      intelligence: { async getMetric(metric: string) { return { metric, rows: [] }; } },
      positions: { async list() { return []; } }, orders: { async list() { return []; } },
      risk: { async getActivePolicy() { return { killSwitch: false }; } }, mandates: { async get() { return { status: 'active' }; } },
      strategies: { async get() { return {}; } }, accounts: { async summary() { return { balances: [] }; } },
    };
    const tools = new ToolRegistry({ read, proposals: { create: async () => ({ proposalId: 'prp_0001', status: 'pending_review' }) } });
    for (const t of createDefaultTools()) tools.register(t);
    const provider = new ScriptedProvider({ id: 'anthropic', script: Array.from({ length: 10 }, () => (messages: { content: string }[]) => {
      const role = Object.keys(REPLIES).find((k) => messages.some((m) => String(m.content).startsWith(`You are the ${k} agent`)))!;
      return { content: JSON.stringify(REPLIES[role]), model: 'claude-sonnet-5', usage: { inputTokens: 1000, outputTokens: 100 } };
    }) });
    let n = 0;
    const ids = (p: string) => `${p}_${Date.now()}_${++n}`;
    const recorder = new TraceRecorder({ store: new PgTraceStore(pool), clock: () => new Date(NOW), idFactory: ids });
    const orch = new Orchestrator({
      tools, router: new TieredModelRouter({ providers: { anthropic: provider, groq: provider } }), recorder,
      decisions: new DecisionService({ store: new PgDecisionStore(pool), idFactory: ids, clock: () => new Date(NOW) }),
      buildDecisionInput: async () => goodInput(), parseStrategy: parseStrategyDsl, idFactory: ids,
    });
    const r = await orch.run({ kind: 'evaluate_opportunity', principalId: 'prn_alice', instrument: 'BTC-USDT', mandateId: 'mdt_0001', opportunityId: 'opp_9' });
    expect(r.recommendation).toBe('GO');
    const run = (await pool.query('SELECT status, step_count FROM agent_runs WHERE id = $1', [r.traceId])).rows[0];
    expect(run).toEqual({ status: 'completed', step_count: 4 });
    const tc = (await pool.query('SELECT count(*)::int AS n FROM tool_calls WHERE run_id = $1', [r.traceId])).rows[0].n;
    expect(tc).toBe(7);
    const mt = (await pool.query('SELECT tier, task_type, cost_usd_micro::text AS c, opportunity_id FROM model_traces WHERE run_id = $1 ORDER BY seq', [r.traceId])).rows;
    expect(mt.map((x) => x.task_type)).toEqual(['market_brief', 'interpret_regime', 'explain_risk', 'portfolio_note']);
    expect(mt.every((x) => x.tier === 'standard' && x.c === '3000' && x.opportunity_id === 'opp_9')).toBe(true);
    expect((await pool.query('SELECT decision FROM trading_decisions WHERE id = $1', [r.decision.id])).rows[0].decision).toBe('GO');
    expect((await new PgTraceStore(pool).costBy('opportunity'))[0]).toMatchObject({ key: 'opp_9', calls: 4, costUsdMicro: '12000' });
  });
});
