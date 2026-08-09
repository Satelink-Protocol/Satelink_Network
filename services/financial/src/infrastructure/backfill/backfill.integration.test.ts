/**
 * Integration tests for the M4 backfill against a real Postgres (testcontainers)
 * with migrations 001–006 applied. Minimal revenue_events_v2 / api_deposits
 * tables are created to feed the backfill's source queries.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { migrate } from '../../../../../database/runner.js';
import { runBackfill } from './backfill-principals.js';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../../../../database/migrations',
);

const WALLET_A = '0x' + 'a'.repeat(40);
const WALLET_B = '0x' + 'b'.repeat(40);
const FOUNDER = '0x5cbda3' + '0'.repeat(34); // 0x + 40 hex, founder prefix
const SK_KEY = 'sk_test_agent_1';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const result = await migrate(container.getConnectionUri(), MIGRATIONS_DIR);
  if (result.errors.length > 0) throw new Error(`migration failed: ${result.errors.join('; ')}`);
  pool = new Pool({ connectionString: container.getConnectionUri() });
  // Swallow idle-client connection errors (e.g. a socket reset when the
  // testcontainer stops in afterAll) so they never surface as unhandled
  // rejections. Query errors still reject their own promises.
  pool.on('error', () => {});
  // Minimal legacy source tables the backfill reads from.
  await pool.query('CREATE TABLE IF NOT EXISTS revenue_events_v2 (client_id TEXT)');
  await pool.query('CREATE TABLE IF NOT EXISTS api_deposits (from_address TEXT)');
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
});

beforeEach(async () => {
  await pool.query('TRUNCATE accounts, principals RESTART IDENTITY CASCADE');
  await pool.query('TRUNCATE revenue_events_v2');
  await pool.query('TRUNCATE api_deposits');
  // Seed distinct identities across both sources (with a dup and 'public').
  await pool.query(
    `INSERT INTO revenue_events_v2 (client_id) VALUES ($1),($2),('public'),('public'),($3)`,
    [WALLET_A, SK_KEY, WALLET_A],
  );
  await pool.query(`INSERT INTO api_deposits (from_address) VALUES ($1),($2),($1)`, [
    WALLET_B,
    FOUNDER,
  ]);
});

async function count(table: string): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

describe('backfill', () => {
  it('dry-run (default) writes nothing', async () => {
    const report = await runBackfill(pool, { apply: false });
    expect(report.dryRun).toBe(true);
    // 4 real identities would be created: WALLET_A, WALLET_B, FOUNDER, SK_KEY.
    expect(report.principalsCreated).toBe(4);
    expect(report.accountsCreated).toBe(4);
    // 'public' is skipped.
    expect(report.skipped.some((s) => s.reason === 'anonymous_public')).toBe(true);
    // Nothing persisted.
    expect(await count('principals')).toBe(0);
    expect(await count('accounts')).toBe(0);
  });

  it('apply creates principals + capacity accounts, then is idempotent', async () => {
    const first = await runBackfill(pool, { apply: true });
    expect(first.principalsCreated).toBe(4);
    expect(first.accountsCreated).toBe(4);
    expect(await count('principals')).toBe(4);
    expect(await count('accounts')).toBe(4);

    // Second run creates NOTHING new.
    const second = await runBackfill(pool, { apply: true });
    expect(second.principalsCreated).toBe(0);
    expect(second.accountsCreated).toBe(0);
    expect(second.skipped.filter((s) => s.reason === 'already_exists').length).toBe(4);
    expect(await count('principals')).toBe(4);
    expect(await count('accounts')).toBe(4);
  });

  it('flags founder wallets so they stay excluded from external metrics (#10)', async () => {
    const report = await runBackfill(pool, { apply: true });
    expect(report.founderFlagged).toContain(FOUNDER);

    const { rows } = await pool.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM principals WHERE external_ref = $1',
      [FOUNDER],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata.founder).toBe(true);
    expect(rows[0]!.metadata.is_test_data).toBe(true);

    // A non-founder wallet is NOT flagged.
    const { rows: nf } = await pool.query<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM principals WHERE external_ref = $1',
      [WALLET_A],
    );
    expect(nf[0]!.metadata.founder).toBeUndefined();
  });

  it('created principals are active with a capacity USDT account', async () => {
    await runBackfill(pool, { apply: true });
    const { rows } = await pool.query<{ state: string; kind: string }>(
      'SELECT state, kind FROM principals WHERE external_ref = $1',
      [SK_KEY],
    );
    expect(rows[0]!.state).toBe('active');
    expect(rows[0]!.kind).toBe('agent'); // sk_ -> agent

    const { rows: acct } = await pool.query<{ kind: string; currency: string; normality: string }>(
      `SELECT a.kind, a.currency, a.normality FROM accounts a
         JOIN principals p ON p.id = a.principal_id
        WHERE p.external_ref = $1`,
      [SK_KEY],
    );
    expect(acct[0]!.kind).toBe('capacity');
    expect(acct[0]!.currency).toBe('USDT');
    expect(acct[0]!.normality).toBe('credit');
  });
});
