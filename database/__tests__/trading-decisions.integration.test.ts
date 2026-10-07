/**
 * Phase 6 item 6 — migration 033_trading_decisions + DecisionService/PgDecisionStore against Postgres:
 * every decision persisted; REJECT ⇔ failed gates enforced by constraints; append-only (029 guard);
 * down migration.
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
  DecisionService, PgDecisionStore,
  // @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
} from '../../apps/api/src/trading_agent/decision/index.mjs';
import {
  goodInput, NOW,
  // @ts-expect-error — plain ESM JS test helper (no type declarations)
} from '../../apps/api/test/helpers/decision_fixture.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '033_trading_decisions.down.sql'), 'utf8');
const DOWN_034 = readFileSync(resolve(HERE, '..', 'migrations-down', '034_trading_memory.down.sql'), 'utf8'); // depends on 033

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('033_trading_decisions', () => {
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
      dbName = `trading_decisions_${Date.now()}`;
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
    expect(result.applied).toContain('033_trading_decisions.sql');
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

  const svc = () => new DecisionService({ store: new PgDecisionStore(pool), idFactory: (p: string) => `${p}_${Date.now()}_${++n}`, clock: () => new Date(NOW) });

  it('persists GO and REJECT decisions with scores, gates, evidence and explanation', async () => {
    const go = await svc().evaluate(goodInput());
    const bad = goodInput(); bad.broker = { status: 'down' };
    const rej = await svc().evaluate(bad);
    const rows = (await pool.query(`SELECT id, decision, score, confidence, failed_gates, config_version, principal_id, opportunity_id, explanation FROM trading_decisions ORDER BY decided_at, id`)).rows;
    expect(rows.map((r) => r.decision).sort()).toEqual(['GO', 'REJECT']);
    const g = rows.find((r) => r.id === go.id);
    expect(g).toMatchObject({ decision: 'GO', score: go.score, confidence: go.confidence, failed_gates: [], config_version: 'scorecard/1.0', principal_id: 'prn_alice', opportunity_id: 'opp_1' });
    expect(rows.find((r) => r.id === rej.id).failed_gates).toContain('broker_unavailable');
    expect(g.explanation).toMatch(/not a probability of profit/);
  });

  it('constraints: REJECT needs failed gates; GO/WAIT may not carry any; expiry ≥ decided_at', async () => {
    const base = `INSERT INTO trading_decisions (id, decision, score, confidence, failed_gates, dimension_scores, expires_at, explanation, config_version, input_hash, decided_at)
                  VALUES ($1, $2, 90, 90, $3, '{}', now() + interval '1 minute', 'x', 'scorecard/1.0', 'h', now())`;
    await expect(pool.query(base, ['dec_bad1', 'REJECT', []])).rejects.toThrow(/check constraint/);
    await expect(pool.query(base, ['dec_bad2', 'GO', ['kill_switch']])).rejects.toThrow(/check constraint/);
  });

  it('decisions are append-only (029 guard) for every role, and the app role has no UPDATE/DELETE', async () => {
    await expect(pool.query(`UPDATE trading_decisions SET decision = 'GO'`)).rejects.toThrow();
    await expect(pool.query(`DELETE FROM trading_decisions`)).rejects.toThrow();
    const c = await pool.connect();
    try {
      await c.query('SET ROLE satelink_app');
      await expect(c.query(`UPDATE trading_decisions SET score = 0`)).rejects.toThrow(/permission denied/);
    } finally { await c.query('RESET ROLE'); c.release(); }
  });

  it('down migration drops the table and its schema_migrations row', async () => {
    await pool.query(DOWN_034);
    await pool.query(DOWN_SQL);
    expect((await pool.query(`SELECT to_regclass('trading_decisions') AS t`)).rows[0].t).toBeNull();
    expect((await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '033_trading_decisions.sql'`)).rowCount).toBe(0);
  });
});
