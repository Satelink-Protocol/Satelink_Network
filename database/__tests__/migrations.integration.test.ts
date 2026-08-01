/**
 * Integration tests for the M2 ledger schema + migration runner.
 *
 * Uses testcontainers to spin up a Postgres 16 container, applies all 4
 * migrations, and verifies:
 *   - Runner applies all migrations to a fresh DB
 *   - Re-running is idempotent (applies nothing)
 *   - Status correctly reports applied vs pending
 *   - UPDATE on ledger_entries fails (invariant #5)
 *   - DELETE on ledger_entries fails (invariant #5)
 *   - INSERT with amount <= 0 fails CHECK constraint
 *   - Duplicate (idem_key, account_id, direction) fails UNIQUE
 *   - account_balances view returns correct posted/pending sums
 *   - A pending credit does NOT raise the posted balance
 *
 * Run: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { migrate, status, verify } from '../runner.js';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(import.meta.dirname ?? new URL('.', import.meta.url).pathname, '..', 'migrations');

describe('M2 — ledger schema migrations', { timeout: 120_000 }, () => {
  let container: StartedPostgreSqlContainer;
  let connectionString: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    connectionString = container.getConnectionUri();
  });

  afterAll(async () => {
    await container?.stop().catch(() => undefined);
  });

  // -----------------------------------------------------------------------
  // Migration runner
  // -----------------------------------------------------------------------

  it('applies all 4 migrations to a fresh database', async () => {
    const result = await migrate(connectionString, MIGRATIONS_DIR);

    expect(result.errors).toHaveLength(0);
    expect(result.applied).toHaveLength(4);
    expect(result.applied).toEqual([
      '001_principals.sql',
      '002_accounts.sql',
      '003_ledger_entries.sql',
      '004_ledger_revoke_mutation.sql',
    ]);
    expect(result.skipped).toHaveLength(0);
  });

  it('re-running applies nothing (idempotent)', async () => {
    const result = await migrate(connectionString, MIGRATIONS_DIR);

    expect(result.errors).toHaveLength(0);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(4);
  });

  it('status correctly reports all as applied', async () => {
    const statuses = await status(connectionString, MIGRATIONS_DIR);

    expect(statuses).toHaveLength(4);
    for (const s of statuses) {
      expect(s.status).toBe('applied');
      expect(s.applied_at).toBeInstanceOf(Date);
    }
  });

  it('verify confirms all checksums match', async () => {
    const result = await verify(connectionString, MIGRATIONS_DIR);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Invariant #5 — append-only (REVOKE UPDATE/DELETE)
  // -----------------------------------------------------------------------

  it('UPDATE on ledger_entries fails with permission denied', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      // Seed test data
      await seedTestData(client);

      // Attempt UPDATE — should fail
      await expect(
        client.query("UPDATE ledger_entries SET amount = 999 WHERE id = 1"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.end();
    }
  });

  it('DELETE on ledger_entries fails with permission denied', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      await expect(
        client.query("DELETE FROM ledger_entries WHERE id = 1"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await client.end();
    }
  });

  // -----------------------------------------------------------------------
  // CHECK constraints
  // -----------------------------------------------------------------------

  it('inserting amount <= 0 fails the CHECK constraint', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      await expect(
        client.query(`
          INSERT INTO ledger_entries
            (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
          VALUES
            ('txn_bad', 'acc_test_1', 'credit', 0, 'USDC', 'posted', 'test', 'ref_0', 'idem_zero')
        `),
      ).rejects.toThrow(/check/i);

      await expect(
        client.query(`
          INSERT INTO ledger_entries
            (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
          VALUES
            ('txn_bad2', 'acc_test_1', 'credit', -100, 'USDC', 'posted', 'test', 'ref_neg', 'idem_neg')
        `),
      ).rejects.toThrow(/check/i);
    } finally {
      await client.end();
    }
  });

  // -----------------------------------------------------------------------
  // UNIQUE constraint — idempotency
  // -----------------------------------------------------------------------

  it('duplicate (idem_key, account_id, direction) fails the UNIQUE constraint', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      // First insert succeeds (already inserted in seed or insert fresh)
      await client.query(`
        INSERT INTO ledger_entries
          (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
        VALUES
          ('txn_dup', 'acc_test_1', 'credit', 100, 'USDC', 'posted', 'test', 'ref_dup', 'idem_dup_test')
      `);

      // Duplicate insert should fail
      await expect(
        client.query(`
          INSERT INTO ledger_entries
            (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
          VALUES
            ('txn_dup2', 'acc_test_1', 'credit', 200, 'USDC', 'posted', 'test', 'ref_dup2', 'idem_dup_test')
        `),
      ).rejects.toThrow(/unique|duplicate/i);
    } finally {
      await client.end();
    }
  });

  // -----------------------------------------------------------------------
  // account_balances VIEW
  // -----------------------------------------------------------------------

  it('account_balances view returns correct posted and pending sums', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      // Insert known entries for a clean account
      await client.query(`
        INSERT INTO principals (id, kind) VALUES ('prn_view_test', 'human')
        ON CONFLICT (id) DO NOTHING
      `);
      await client.query(`
        INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals)
        VALUES ('acc_view_test', 'prn_view_test', 'wallet', 'credit', 'USDC', 6)
        ON CONFLICT (id) DO NOTHING
      `);

      // Posted credit: 1000
      await client.query(`
        INSERT INTO ledger_entries
          (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key, posted_at)
        VALUES
          ('txn_v1', 'acc_view_test', 'credit', 1000, 'USDC', 'posted', 'test', 'ref_v1', 'idem_v1', now())
      `);

      // Posted debit: 300
      await client.query(`
        INSERT INTO ledger_entries
          (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key, posted_at)
        VALUES
          ('txn_v2', 'acc_view_test', 'debit', 300, 'USDC', 'posted', 'test', 'ref_v2', 'idem_v2', now())
      `);

      // Pending debit: 200
      await client.query(`
        INSERT INTO ledger_entries
          (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
        VALUES
          ('txn_v3', 'acc_view_test', 'debit', 200, 'USDC', 'pending', 'test', 'ref_v3', 'idem_v3')
      `);

      const { rows } = await client.query<{
        account_id: string;
        posted_credits: string;
        posted_debits: string;
        pending_debits: string;
        posted_balance: string;
        available_balance: string;
      }>("SELECT * FROM account_balances WHERE account_id = 'acc_view_test'");

      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(BigInt(row.posted_credits)).toBe(1000n);
      expect(BigInt(row.posted_debits)).toBe(300n);
      expect(BigInt(row.pending_debits)).toBe(200n);
      expect(BigInt(row.posted_balance)).toBe(700n);       // 1000 - 300
      expect(BigInt(row.available_balance)).toBe(500n);     // 1000 - 300 - 200
    } finally {
      await client.end();
    }
  });

  it('a pending credit does NOT raise the posted balance', async () => {
    const client = new Client({ connectionString });
    await client.connect();

    try {
      // Create a fresh account for this test
      await client.query(`
        INSERT INTO principals (id, kind) VALUES ('prn_pending_test', 'human')
        ON CONFLICT (id) DO NOTHING
      `);
      await client.query(`
        INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals)
        VALUES ('acc_pending_test', 'prn_pending_test', 'wallet', 'credit', 'USDC', 6)
        ON CONFLICT (id) DO NOTHING
      `);

      // Posted credit: 500
      await client.query(`
        INSERT INTO ledger_entries
          (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key, posted_at)
        VALUES
          ('txn_p1', 'acc_pending_test', 'credit', 500, 'USDC', 'posted', 'test', 'ref_p1', 'idem_p1', now())
      `);

      // Pending credit: 9999 — this must NOT increase posted or available
      await client.query(`
        INSERT INTO ledger_entries
          (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
        VALUES
          ('txn_p2', 'acc_pending_test', 'credit', 9999, 'USDC', 'pending', 'test', 'ref_p2', 'idem_p2')
      `);

      const { rows } = await client.query<{
        posted_balance: string;
        available_balance: string;
        pending_credits: string;
      }>("SELECT * FROM account_balances WHERE account_id = 'acc_pending_test'");

      expect(rows).toHaveLength(1);
      const row = rows[0]!;

      // Posted balance: ONLY the posted credit (500), NOT the pending credit
      expect(BigInt(row.posted_balance)).toBe(500n);
      // Available: same as posted (no pending debits)
      expect(BigInt(row.available_balance)).toBe(500n);
      // Pending credits tracked but NOT in available
      expect(BigInt(row.pending_credits)).toBe(9999n);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Helper — seed minimal test data for constraint tests
// ---------------------------------------------------------------------------

async function seedTestData(client: Client): Promise<void> {
  // Check if test data already exists
  const { rows } = await client.query(
    "SELECT 1 FROM principals WHERE id = 'prn_test_1' LIMIT 1",
  );
  if (rows.length > 0) return;

  await client.query(`
    INSERT INTO principals (id, kind) VALUES ('prn_test_1', 'human')
  `);
  await client.query(`
    INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals)
    VALUES ('acc_test_1', 'prn_test_1', 'wallet', 'credit', 'USDC', 6)
  `);
  await client.query(`
    INSERT INTO ledger_entries
      (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key, posted_at)
    VALUES
      ('txn_seed_1', 'acc_test_1', 'credit', 1000000, 'USDC', 'posted', 'test', 'ref_seed', 'idem_seed_1', now())
  `);
}
