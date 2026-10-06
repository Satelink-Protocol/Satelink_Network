/**
 * Stage 09 — migration 021_trading_foundation up/down round trip.
 *
 * Default: ephemeral Postgres via testcontainers (CI `integration` job).
 * Local without Docker: set TRADING_FOUNDATION_TEST_DB to a LOCAL server
 * (localhost / 127.0.0.1 / unix socket only — anything else is refused). The
 * test then CREATEs its own throwaway database on that server and DROPs it at
 * the end, so no existing database is touched.
 *
 *   TRADING_FOUNDATION_TEST_DB=postgresql:///postgres?host=/tmp \
 *     npx vitest run --project integration database/__tests__/trading-foundation.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from '../runner.js';
import { applyMigrationsForTest } from './apply-migrations.js';

const HERE = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
const MIGRATIONS_DIR = resolve(HERE, '..', 'migrations');
const DOWN_SQL = readFileSync(resolve(HERE, '..', 'migrations-down', '021_trading_foundation.down.sql'), 'utf8');

const TRADING_TABLES = [
  'broker_accounts', 'broker_credentials_metadata', 'broker_credential_ciphertexts', 'strategies',
  'strategy_versions', 'mandates', 'risk_policies', 'signals', 'orders', 'order_events', 'fills',
  'positions', 'trading_outbox', 'audit_events',
];
const APPEND_ONLY = ['strategy_versions', 'order_events', 'fills', 'audit_events'];

function assertLocal(url: string): void {
  const u = new URL(url);
  const socketHost = u.searchParams.get('host');
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) && (u.hostname !== '' || (socketHost ?? '').startsWith('/'));
  if (!local) throw new Error(`TRADING_FOUNDATION_TEST_DB must point at a local server, got host "${u.hostname || socketHost}"`);
}

async function tables(conn: string): Promise<string[]> {
  const c = new Client({ connectionString: conn });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY 1`,
      [TRADING_TABLES],
    );
    return r.rows.map((x) => x.table_name as string);
  } finally {
    await c.end();
  }
}

describe('021_trading_foundation up/down', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let adminUrl: string | undefined;
  let dbName: string | undefined;
  let conn: string;

  beforeAll(async () => {
    const local = process.env.TRADING_FOUNDATION_TEST_DB;
    if (local) {
      assertLocal(local);
      adminUrl = local;
      dbName = `trading_foundation_${Date.now()}`;
      const admin = new Client({ connectionString: local });
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
  }, 120_000);

  afterAll(async () => {
    if (container) await container.stop();
    if (adminUrl && dbName) {
      const admin = new Client({ connectionString: adminUrl });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin.end();
    }
  });

  it('up: applies 001–021 cleanly and creates all 14 trading tables', async () => {
    const result = await applyMigrationsForTest(conn, MIGRATIONS_DIR);
    expect(result.errors).toHaveLength(0);
    expect(result.applied).toContain('021_trading_foundation.sql');
    expect(await tables(conn)).toEqual([...TRADING_TABLES].sort());
  });

  it('up: append-only tables have UPDATE/DELETE revoked from satelink_app', async () => {
    const c = new Client({ connectionString: conn });
    await c.connect();
    try {
      for (const t of APPEND_ONLY) {
        const r = await c.query(
          `SELECT has_table_privilege('satelink_app', $1, 'UPDATE') AS upd, has_table_privilege('satelink_app', $1, 'DELETE') AS del`,
          [t],
        );
        expect(r.rows[0], t).toEqual({ upd: false, del: false });
      }
    } finally {
      await c.end();
    }
  });

  it('up: money columns are NUMERIC and a mandate cannot go active without step-up', async () => {
    const c = new Client({ connectionString: conn });
    await c.connect();
    try {
      const r = await c.query(
        `SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ANY($1) AND column_name LIKE '%\\_minor'`,
        [TRADING_TABLES],
      );
      expect(r.rows.length).toBeGreaterThan(0);
      for (const col of r.rows) expect([col.data_type, col.numeric_precision, col.numeric_scale], col.column_name).toEqual(['numeric', 38, 0]);

      await c.query(`INSERT INTO principals (id, kind, display_name, state) VALUES ('prn_t9', 'human', 't9', 'active')`);
      await c.query(`INSERT INTO broker_accounts (id, principal_id, broker, environment) VALUES ('bka_t9', 'prn_t9', 'alpaca', 'paper')`);
      await expect(c.query(
        `INSERT INTO mandates (id, principal_id, broker_account_id, mode, status, max_notional_minor, currency, decimals)
         VALUES ('mdt_t9', 'prn_t9', 'bka_t9', 'copilot', 'active', 1000000, 'USD', 2)`,
      )).rejects.toThrow(/check constraint/i);
    } finally {
      await c.end();
    }
  });

  it('down: drops only the 14 trading tables and its schema_migrations row; up re-applies', async () => {
    const c = new Client({ connectionString: conn });
    await c.connect();
    const before = await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
    await c.query(DOWN_SQL);
    const after = await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`);
    const row = await c.query(`SELECT 1 FROM schema_migrations WHERE filename = '021_trading_foundation.sql'`);
    await c.end();

    expect(before.rows[0].n - after.rows[0].n).toBe(TRADING_TABLES.length);
    expect(row.rowCount).toBe(0);
    expect(await tables(conn)).toEqual([]);

    const again = await migrate(conn, MIGRATIONS_DIR);
    expect(again.errors).toHaveLength(0);
    expect(again.applied).toEqual(['021_trading_foundation.sql']);
    expect(await tables(conn)).toEqual([...TRADING_TABLES].sort());
  });
});
