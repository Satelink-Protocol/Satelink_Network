/**
 * Stage 11 — migration 022_market_data_entitlements up/down + the real
 * PgEntitlementStore query against Postgres.
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
// @ts-expect-error — plain ESM JS module from apps/api (no type declarations)
import { PgEntitlementStore, EntitlementService } from '../../apps/api/src/trading_agent/market_data/entitlements.mjs';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '022_market_data_entitlements.down.sql'), 'utf8');

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got "${u.hostname || socketHost}"`);
}

describe('022_market_data_entitlements', () => {
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
      dbName = `trading_md_${Date.now()}`;
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
    expect(result.applied).toContain('022_market_data_entitlements.sql');
    pool = new pg.Pool({ connectionString: conn, max: 2 });
    await pool.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_md', 'human', 'md', 'active'), ('prn_other', 'human', 'o', 'active')`);
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

  const svc = (at: string) => new EntitlementService({ store: new PgEntitlementStore(pool), clock: () => new Date(at) });

  it('denies by default and allows only a matching active in-window grant', async () => {
    const req = { principalId: 'prn_md', venue: 'binance', dataset: 'quotes', purpose: 'internal_use' };
    await expect(svc('2026-01-01T00:00:00Z').assertAllowed(req)).rejects.toMatchObject({ code: 'ENTITLEMENT_DENIED' });
    await pool.query(
      `INSERT INTO market_data_entitlements (id, principal_id, venue, dataset, scope, source_terms_ref, granted_by, valid_from, valid_until)
       VALUES ('mde_i1', 'prn_md', 'binance', 'quotes', 'internal_use', 'docs/legal/MARKET_DATA_TERMS.md#binance', 'founder', '2025-01-01', '2027-01-01')`,
    );
    await expect(svc('2026-01-01T00:00:00Z').assertAllowed(req)).resolves.toMatchObject({ allowed: true, entitlementId: 'mde_i1', scope: 'internal_use' });
    await expect(svc('2027-06-01T00:00:00Z').assertAllowed(req)).rejects.toMatchObject({ code: 'ENTITLEMENT_DENIED' });
    await expect(svc('2026-01-01T00:00:00Z').assertAllowed({ ...req, purpose: 'redistribution' })).rejects.toMatchObject({ code: 'ENTITLEMENT_DENIED' });
    await expect(svc('2026-01-01T00:00:00Z').assertAllowed({ ...req, principalId: 'prn_other' })).rejects.toMatchObject({ code: 'ENTITLEMENT_DENIED' });
  });

  it('enforces one active grant per scope and revoked_at on revocation', async () => {
    await expect(pool.query(
      `INSERT INTO market_data_entitlements (id, principal_id, venue, dataset, scope, source_terms_ref, granted_by)
       VALUES ('mde_i2', 'prn_md', 'binance', 'quotes', 'internal_use', 'x', 'founder')`,
    )).rejects.toThrow(/duplicate key/);
    await expect(pool.query(`UPDATE market_data_entitlements SET status = 'revoked' WHERE id = 'mde_i1'`)).rejects.toThrow(/check constraint/);
    await pool.query(`UPDATE market_data_entitlements SET status = 'revoked', revoked_at = now() WHERE id = 'mde_i1'`);
    await expect(svc('2026-01-01T00:00:00Z').assertAllowed({ principalId: 'prn_md', venue: 'binance', dataset: 'quotes', purpose: 'internal_use' }))
      .rejects.toMatchObject({ code: 'ENTITLEMENT_DENIED' });
  });

  it('down migration drops only market_data_entitlements', async () => {
    const count = async () => (await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0].n;
    const before = await count();
    await pool.query(DOWN_SQL);
    expect(before - (await count())).toBe(1);
    const t = await pool.query(`SELECT to_regclass('public.market_data_entitlements') AS t`);
    expect(t.rows[0].t).toBeNull();
    const m = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename = '022_market_data_entitlements.sql'`);
    expect(m.rowCount).toBe(0);
  });
});
