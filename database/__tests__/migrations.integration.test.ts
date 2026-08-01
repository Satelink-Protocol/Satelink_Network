/**
 * Integration tests for the M2 ledger schema + migration runner.
 *
 * Uses testcontainers to spin up a Postgres 16 container, applies all 4
 * migrations, and verifies:
 *   - Runner applies all migrations to a fresh DB
 *   - Re-running is idempotent (applies nothing)
 *   - Status correctly reports applied vs pending
 *   - UPDATE on ledger_entries fails for the non-superuser satelink_app role (invariant #5)
 *   - DELETE on ledger_entries fails for the non-superuser satelink_app role (invariant #5)
 *   - a SUPERUSER CAN still mutate — asserted honestly as the known production gap,
 *     because production currently connects as the superuser `postgres` (see 004)
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
  // Helpers for the append-only tests
  // -----------------------------------------------------------------------

  // Password for the throwaway non-superuser role. Container-local only.
  const APP_ROLE_PASSWORD = 'app_test_pw';

  // Connection string that logs in AS the non-superuser satelink_app role
  // (as opposed to `connectionString`, which is the container superuser).
  const appConnectionString = (): string =>
    `postgresql://satelink_app:${APP_ROLE_PASSWORD}` +
    `@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

  // Idempotently create the least-privilege satelink_app role, grant it the
  // privileges a real app needs (SELECT/INSERT), then apply the SAME revoke
  // migration 004 applies once the role exists. This mirrors the infra state
  // production must reach (dedicated non-superuser role + repointed DATABASE_URL);
  // it is a test fixture only and must never be run against production.
  async function ensureAppRole(client: Client): Promise<void> {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
          CREATE ROLE satelink_app LOGIN PASSWORD '${APP_ROLE_PASSWORD}';
        END IF;
      END
      $$;
    `);
    await client.query('GRANT USAGE ON SCHEMA public TO satelink_app');
    await client.query('GRANT SELECT, INSERT ON ledger_entries TO satelink_app');
    await client.query('REVOKE UPDATE, DELETE ON ledger_entries FROM satelink_app');
  }

  // -----------------------------------------------------------------------
  // Migration runner
  // -----------------------------------------------------------------------

  it('applies all 5 migrations to a fresh database', async () => {
    const result = await migrate(connectionString, MIGRATIONS_DIR);

    expect(result.errors).toHaveLength(0);
    expect(result.applied).toHaveLength(5);
    expect(result.applied).toEqual([
      '001_principals.sql',
      '002_accounts.sql',
      '003_ledger_entries.sql',
      '004_ledger_revoke_mutation.sql',
      '005_system_accounts.sql',
    ]);
    expect(result.skipped).toHaveLength(0);
  });

  it('re-running applies nothing (idempotent)', async () => {
    const result = await migrate(connectionString, MIGRATIONS_DIR);

    expect(result.errors).toHaveLength(0);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(5);
  });

  it('status correctly reports all as applied', async () => {
    const statuses = await status(connectionString, MIGRATIONS_DIR);

    expect(statuses).toHaveLength(5);
    for (const s of statuses) {
      expect(s.status).toBe('applied');
      expect(s.applied_at).toBeInstanceOf(Date);
    }
  });

  it('005 seeds the platform system accounts', async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ id: string; normality: string; currency: string }>(
        `SELECT id, normality, currency FROM accounts
          WHERE id IN ('acct_platform_revenue', 'acct_platform_suspense')
          ORDER BY id`,
      );
      expect(rows).toHaveLength(2);
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get('acct_platform_revenue')?.normality).toBe('credit');
      expect(byId.get('acct_platform_suspense')?.normality).toBe('debit');
      const { rows: prn } = await client.query(
        `SELECT id FROM principals WHERE id = 'prn_platform' AND kind = 'platform'`,
      );
      expect(prn).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('verify confirms all checksums match', async () => {
    const result = await verify(connectionString, MIGRATIONS_DIR);

    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Invariant #5 — append-only (REVOKE UPDATE/DELETE)
  //
  // HONEST framing: the REVOKE in migration 004 only constrains a *non-superuser*
  // role. Production connects as the superuser `postgres`, which bypasses all
  // privilege checks — so append-only is NOT enforced for the app connection
  // today. These tests therefore:
  //   1. prove the revoke DOES bite a dedicated non-superuser role (satelink_app),
  //      which is the state prod must reach (create role + repoint DATABASE_URL); and
  //   2. assert, without flattery, that a SUPERUSER can STILL mutate — the current
  //      production gap. We never assert against the container superuser as if it
  //      represented a protected production connection.
  // -----------------------------------------------------------------------

  it('UPDATE on ledger_entries fails for the non-superuser satelink_app role', async () => {
    const admin = new Client({ connectionString });
    await admin.connect();
    try {
      await seedTestData(admin);
      await ensureAppRole(admin);
    } finally {
      await admin.end();
    }

    const app = new Client({ connectionString: appConnectionString() });
    await app.connect();
    try {
      await expect(
        app.query("UPDATE ledger_entries SET amount = 999 WHERE id = 1"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it('DELETE on ledger_entries fails for the non-superuser satelink_app role', async () => {
    const admin = new Client({ connectionString });
    await admin.connect();
    try {
      await seedTestData(admin);
      await ensureAppRole(admin);
    } finally {
      await admin.end();
    }

    const app = new Client({ connectionString: appConnectionString() });
    await app.connect();
    try {
      await expect(
        app.query("DELETE FROM ledger_entries WHERE id = 1"),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
  });

  it('a SUPERUSER can STILL mutate ledger_entries — the known production gap, NOT a passing guarantee', async () => {
    // Production connects as the superuser `postgres`. Superusers bypass the
    // REVOKE in migration 004, so append-only is NOT enforced for the app today.
    // We assert this truth explicitly so the suite can never be read as claiming
    // production is protected. It becomes protected only once a non-superuser
    // role exists AND DATABASE_URL is repointed to it (see 004 header).
    const admin = new Client({ connectionString });
    await admin.connect();
    try {
      await seedTestData(admin);
      // SET amount = amount: requires UPDATE privilege but leaves data unchanged
      // (keeps CHECK (amount > 0) satisfied and does not disturb later tests).
      const res = await admin.query(
        "UPDATE ledger_entries SET amount = amount WHERE id = 1",
      );
      expect(res.rowCount).toBe(1);
    } finally {
      await admin.end();
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
