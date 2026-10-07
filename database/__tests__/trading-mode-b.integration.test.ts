/**
 * Phase 6 item 12 — Mode B decisions through the real RiskEngine + PgRiskStore: an approval and a
 * refusal are both recorded in audit_events (append-only, 029) with checks version risk-checks/1.1.
 *
 * Default: testcontainers (CI). Local without Docker: TRADING_FOUNDATION_TEST_DB pointing at a LOCAL
 * server (the test creates and drops its own database).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { resolve } from 'node:path';
import { applyMigrationsForTest } from './apply-migrations.js';
// @ts-expect-error — plain ESM JS module
import { RiskEngine, PgRiskStore } from '../../apps/api/src/trading_agent/risk/index.mjs';
// @ts-expect-error — plain ESM JS module
import { tradingFlagEnvName as F } from '../../apps/api/src/trading_agent/flags.mjs';
// @ts-expect-error — plain ESM JS test helper
import { ORDER, RISK_CTX, NOW } from '../../apps/api/test/helpers/decision_fixture.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

const modeBOrder = (idem: string) => { const o = { ...ORDER(), idempotencyKey: idem, origin: 'agent_proposal', proposedBy: 'prn_bot', decisionId: 'dec_000001', strategyVersionId: 'stv_1', quantity: '0.001', limitPrice: '30000' }; delete (o as Record<string, unknown>).approvedBy; return o; };
const modeBCtx = () => {
  const c = RISK_CTX();
  c.flagsEnv[F('MANDATE_MODE_B')] = 'true';
  c.mandate = { ...c.mandate, mode: 'automated', termsMode: 'B', stepUpMethod: 'totp', strategyVersionId: 'stv_1', instruments: ['BTC-USDT'] };
  c.activity = { ...c.activity, todayNotionalMinor: '0' };
  c.proposer = { principalId: 'prn_bot', ownerPrincipalId: 'prn_alice', scope: 'EXECUTE_UNDER_MANDATE', mandateId: 'mdt_1' };
  c.scorecardDecision = { id: 'dec_000001', decision: 'GO', expires_at: new Date(NOW + 600_000).toISOString(), subject: { principalId: 'prn_alice', instrument: 'BTC-USDT', side: 'buy' } };
  return c;
};

describe('Mode B through RiskEngine + Postgres', () => {
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
      dbName = `trading_modeb_${Date.now()}`;
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

  it('records the Mode B APPROVE and a Mode B REJECT (scorecard WAIT) in audit_events, version 1.1', async () => {
    const engine = (ctx: unknown) => new RiskEngine({ loadContext: async () => ctx, store: new PgRiskStore(pool), idFactory: (p: string) => `${p}_${++n}`, clock: () => new Date(NOW) });
    expect((await engine(modeBCtx()).decide(modeBOrder('idem_modeb_ok1'))).decision).toBe('APPROVE');
    const wait = modeBCtx(); wait.scorecardDecision.decision = 'WAIT';
    expect((await engine(wait).decide(modeBOrder('idem_modeb_no1'))).decision).toBe('REJECT');
    const rows = (await pool.query(`SELECT target_id, payload FROM audit_events WHERE action = 'risk.decision' ORDER BY id`)).rows;
    expect(rows.map((r) => [r.target_id, r.payload.decision, r.payload.checksVersion, r.payload.failedCheck?.code ?? null])).toEqual([
      ['idem_modeb_ok1', 'APPROVE', 'risk-checks/1.1', null],
      ['idem_modeb_no1', 'REJECT', 'risk-checks/1.1', 'MODE_B_SCORECARD'],
    ]);
    await expect(pool.query(`UPDATE audit_events SET payload = '{}'`)).rejects.toThrow();
  });

  it('with MANDATE_MODE_B off the same order is refused at the flags check and recorded', async () => {
    const off = modeBCtx(); delete off.flagsEnv[F('MANDATE_MODE_B')];
    const d = await new RiskEngine({ loadContext: async () => off, store: new PgRiskStore(pool), idFactory: (p: string) => `${p}_${++n}`, clock: () => new Date(NOW) }).decide(modeBOrder('idem_modeb_off'));
    expect([d.decision, d.failedCheck.id, d.failedCheck.code]).toEqual(['REJECT', 'trading_flags', 'FLAG_DISABLED']);
  });
});
