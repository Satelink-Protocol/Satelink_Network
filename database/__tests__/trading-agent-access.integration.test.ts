/**
 * Phase 6 item 11 — migration 035_trading_agent_access + PgAgentKeyStore / AgentKeyService /
 * AgentAccessGuard against Postgres.
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
import { AgentKeyService, PgAgentKeyStore, AgentAccessGuard, hashKey } from '../../apps/api/src/trading_agent/access/index.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '035_trading_agent_access.down.sql'), 'utf8');

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('035_trading_agent_access', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let pool: pg.Pool;
  let n = 0;
  const ids = (p: string) => `${p}_${String(++n).padStart(6, '0')}`;
  const t = { now: Date.UTC(2026, 9, 7, 10, 0) };
  const clock = () => new Date(t.now);
  const alice = { principalId: 'prn_alice', kind: 'human' };

  beforeAll(async () => {
    let conn: string;
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_access_${Date.now()}`;
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
    expect(result.applied).toContain('035_trading_agent_access.sql');
    pool = new pg.Pool({ connectionString: conn, max: 4 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_alice', 'human', 'alice', 'active')`);
    await pool.query(`INSERT INTO principals (id, kind, parent_id, display_name, state) VALUES ('prn_bot', 'agent', 'prn_alice', 'bot', 'active'), ('prn_mach', 'machine', 'prn_alice', 'm', 'active')`);
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

  const principals = { get: async (id: string) => { const r = (await pool.query('SELECT id, kind, parent_id, state FROM principals WHERE id = $1', [id])).rows[0]; return r ? { id: r.id, kind: r.kind, parentId: r.parent_id, state: r.state } : null; } };

  it('issues, resolves and revokes; only the hash is stored', async () => {
    const svc = new AgentKeyService({ store: new PgAgentKeyStore(pool), principals, idFactory: ids, clock });
    const k = await svc.issue({ actor: alice, principalId: 'prn_mach', scope: 'READ', budgetCalls: 2, budgetUsdMicro: 6000, ratePerMinute: 10 });
    const row = (await pool.query('SELECT key_hash, key_hint FROM trading_agent_keys WHERE id = $1', [k.keyId])).rows[0];
    expect(row.key_hash).toBe(hashKey(k.apiKey));
    expect(JSON.stringify((await pool.query('SELECT * FROM trading_agent_keys')).rows)).not.toContain(k.apiKey);
    expect(await svc.resolve(k.apiKey)).toMatchObject({ principalId: 'prn_mach', kind: 'machine', via: 'api_key' });
    await expect(svc.issue({ actor: alice, principalId: 'prn_mach', scope: 'READ', budgetCalls: 1, budgetUsdMicro: 0 })).rejects.toThrow(); // one key per principal
    await svc.revoke({ actor: alice, keyId: k.keyId });
    expect(await svc.resolve(k.apiKey)).toBeNull();
  });

  it('budgets come from usage in Postgres; metering is idempotent per request; usage is append-only', async () => {
    const store = new PgAgentKeyStore(pool);
    const svc = new AgentKeyService({ store, principals, idFactory: ids, clock });
    const k = await svc.issue({ actor: alice, principalId: 'prn_bot', scope: 'PROPOSE', budgetCalls: 2, budgetUsdMicro: 6000, ratePerMinute: 10 });
    const p = await svc.resolve(k.apiKey);
    const guard = new AgentAccessGuard({ store, idFactory: ids, clock });
    await guard.check(p, 'evaluate_opportunity', 'READ');
    await guard.meter(p, 'evaluate_opportunity', 'req-1');
    expect(await guard.meter(p, 'evaluate_opportunity', 'req-1')).toEqual({ duplicate: true });
    await expect(guard.check(p, 'evaluate_opportunity', 'READ')).rejects.toMatchObject({ status: 402, code: 'BUDGET_EXHAUSTED' }); // USD: 5000 + 5000 > 6000
    await guard.meter(p, 'propose', 'req-2');
    expect(await store.usageSince(k.keyId, new Date(Date.UTC(2026, 9, 7)).toISOString())).toEqual({ calls: 2, usdMicro: 6000n });
    await expect(guard.check(p, 'get_receipt', 'READ')).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' }); // call budget 2
    t.now += 86_400_000;
    await expect(guard.check(p, 'get_receipt', 'READ')).resolves.toBeTruthy();
    await expect(pool.query('UPDATE trading_agent_usage SET charge_usd_micro = 0')).rejects.toThrow();
    await expect(pool.query('DELETE FROM trading_agent_usage')).rejects.toThrow();
  });

  it('constraints: EXECUTE scope needs a mandate; a principal cannot own itself', async () => {
    const ins = `INSERT INTO trading_agent_keys (id, principal_id, owner_principal_id, key_hash, key_hint, scope, mandate_id, budget_calls, budget_usd_micro, rate_per_minute, created_at) VALUES ($1,$2,$3,$4,'h',$5,$6,1,0,1,now())`;
    await expect(pool.query(ins, ['tak_x1', 'prn_alice', 'prn_bot', 'a'.repeat(64), 'EXECUTE_UNDER_MANDATE', null])).rejects.toThrow(/check constraint/);
    await expect(pool.query(ins, ['tak_x2', 'prn_alice', 'prn_alice', 'b'.repeat(64), 'READ', null])).rejects.toThrow(/check constraint/);
  });

  it('down migration drops both tables', async () => {
    await pool.query(DOWN_SQL);
    expect((await pool.query(`SELECT to_regclass('trading_agent_keys') AS t`)).rows[0].t).toBeNull();
  });
});
