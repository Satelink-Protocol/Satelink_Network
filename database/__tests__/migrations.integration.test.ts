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

  it('applies all 11 migrations to a fresh database', async () => {
    const result = await migrate(connectionString, MIGRATIONS_DIR);

    expect(result.errors).toHaveLength(0);
    expect(result.applied).toHaveLength(11);
    expect(result.applied).toEqual([
      '001_principals.sql',
      '002_accounts.sql',
      '003_ledger_entries.sql',
      '004_ledger_revoke_mutation.sql',
      '005_system_accounts.sql',
      '006_principal_account_version.sql',
      '007_authorization.sql',
      '008_draws.sql',
      '009_ledger_txn_header.sql',
      '010_account_state_frozen.sql',
      '011_reconciliation.sql',
    ]);
    expect(result.skipped).toHaveLength(0);
  });

  it('re-running applies nothing (idempotent)', async () => {
    const result = await migrate(connectionString, MIGRATIONS_DIR);

    expect(result.errors).toHaveLength(0);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(11);
  });

  it('status correctly reports all as applied', async () => {
    const statuses = await status(connectionString, MIGRATIONS_DIR);

    expect(statuses).toHaveLength(11);
    for (const s of statuses) {
      expect(s.status).toBe('applied');
      expect(s.applied_at).toBeInstanceOf(Date);
    }
  });

  it('007 creates funding_sources, authorizations, authorization_nonces', async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
          WHERE table_name IN ('funding_sources','authorizations','authorization_nonces')
          ORDER BY table_name`,
      );
      expect(rows.map((r) => r.table_name)).toEqual([
        'authorization_nonces',
        'authorizations',
        'funding_sources',
      ]);
      // version column on authorizations (optimistic locking)
      const { rows: v } = await client.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'authorizations' AND column_name = 'version'`,
      );
      expect(v).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('006 adds a version column to principals and accounts', async () => {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const { rows } = await client.query<{ table_name: string; column_default: string | null }>(
        `SELECT table_name, column_default FROM information_schema.columns
          WHERE table_name IN ('principals', 'accounts') AND column_name = 'version'
          ORDER BY table_name`,
      );
      expect(rows.map((r) => r.table_name)).toEqual(['accounts', 'principals']);
      for (const r of rows) {
        expect(r.column_default).toContain('0'); // DEFAULT 0
      }
    } finally {
      await client.end();
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
      await seedTestData(client);
      await ensureCounterparty(client);

      // First insert succeeds: a balanced txn establishes the
      // (idem_dup_test, acc_test_1, credit) row. The debit leg lands on the
      // counterparty so the transaction balances at COMMIT.
      await insertBalancedTxn(client, 'txn_dup', [
        { account_id: 'acc_test_1', direction: 'credit', amount: 100n, idem_key: 'idem_dup_test' },
        { account_id: COUNTERPARTY_ACCOUNT_ID, direction: 'debit', amount: 100n, idem_key: 'idem_dup_counter' },
      ]);

      // Duplicate insert should fail: same (idem_key, account_id, direction).
      // The UNIQUE index is checked at INSERT time — before the deferred
      // balance trigger — so the rejected row needs no header or balance.
      await expect(
        client.query(`
          INSERT INTO ledger_entries
            (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key)
          VALUES
            ('txn_dup', 'acc_test_1', 'credit', 200, 'USDC', 'posted', 'test', 'ref_dup2', 'idem_dup_test')
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
      await ensureCounterparty(client);

      // Each subject leg on acc_view_test is balanced by an opposite leg on the
      // counterparty account, which the per-account view does not fold into
      // acc_view_test's row — so the subject's expected sums are unchanged.

      // Posted credit: 1000
      await insertBalancedTxn(client, 'txn_v1', [
        { account_id: 'acc_view_test', direction: 'credit', amount: 1000n, idem_key: 'idem_v1' },
        { account_id: COUNTERPARTY_ACCOUNT_ID, direction: 'debit', amount: 1000n, idem_key: 'idem_v1_cp' },
      ]);

      // Posted debit: 300
      await insertBalancedTxn(client, 'txn_v2', [
        { account_id: 'acc_view_test', direction: 'debit', amount: 300n, idem_key: 'idem_v2' },
        { account_id: COUNTERPARTY_ACCOUNT_ID, direction: 'credit', amount: 300n, idem_key: 'idem_v2_cp' },
      ]);

      // Pending debit: 200
      await insertBalancedTxn(client, 'txn_v3', [
        { account_id: 'acc_view_test', direction: 'debit', amount: 200n, idem_key: 'idem_v3', state: 'pending' },
        { account_id: COUNTERPARTY_ACCOUNT_ID, direction: 'credit', amount: 200n, idem_key: 'idem_v3_cp', state: 'pending' },
      ]);

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
      await ensureCounterparty(client);

      // Posted credit: 500 (balanced by a posted debit on the counterparty)
      await insertBalancedTxn(client, 'txn_p1', [
        { account_id: 'acc_pending_test', direction: 'credit', amount: 500n, idem_key: 'idem_p1' },
        { account_id: COUNTERPARTY_ACCOUNT_ID, direction: 'debit', amount: 500n, idem_key: 'idem_p1_cp' },
      ]);

      // Pending credit: 9999 — must NOT increase posted or available.
      // Balanced by a pending debit on the counterparty.
      await insertBalancedTxn(client, 'txn_p2', [
        { account_id: 'acc_pending_test', direction: 'credit', amount: 9999n, idem_key: 'idem_p2', state: 'pending' },
        { account_id: COUNTERPARTY_ACCOUNT_ID, direction: 'debit', amount: 9999n, idem_key: 'idem_p2_cp', state: 'pending' },
      ]);

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
// Helpers — balanced double-entry writes
//
// Migration 009 (M6.5) added two invariants the DB now enforces on every
// ledger_entries write:
//   - ledger_entries_txn_fk: each row must reference a parent ledger_txns row.
//   - trg_ledger_entries_balance: a DEFERRABLE INITIALLY DEFERRED constraint
//     trigger that, at COMMIT, requires SUM(debit) = SUM(credit) per txn_id.
// So a test can no longer insert a lone entry: it must write a header plus a
// balanced set of legs inside one transaction. The leg the test cares about
// lands on the subject account; the equal-and-opposite leg lands on a
// counterparty account, so the per-account account_balances view for the
// subject is unchanged.
// ---------------------------------------------------------------------------

const COUNTERPARTY_ACCOUNT_ID = 'acc_test_counterparty';

async function ensureCounterparty(client: Client): Promise<void> {
  await client.query(`
    INSERT INTO principals (id, kind) VALUES ('prn_test_counterparty', 'human')
    ON CONFLICT (id) DO NOTHING
  `);
  await client.query(
    `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals)
     VALUES ($1, 'prn_test_counterparty', 'suspense', 'debit', 'USDC', 6)
     ON CONFLICT (id) DO NOTHING`,
    [COUNTERPARTY_ACCOUNT_ID],
  );
}

interface Leg {
  account_id: string;
  direction: 'debit' | 'credit';
  amount: bigint | number;
  idem_key: string;
  state?: 'pending' | 'posted';
}

/**
 * Insert a ledger_txns header plus `legs` as one atomic transaction. `legs`
 * must balance (SUM debit = SUM credit among non-voided legs) or the deferred
 * balance trigger rejects the COMMIT — exactly the production invariant.
 */
async function insertBalancedTxn(client: Client, txnId: string, legs: Leg[]): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO ledger_txns (txn_id, kind, ref_type, ref_id, currency, state, posted_at)
       VALUES ($1, 'deposit', 'test', $1, 'USDC', 'posted', now())
       ON CONFLICT (txn_id) DO NOTHING`,
      [txnId],
    );
    for (const leg of legs) {
      const state = leg.state ?? 'posted';
      await client.query(
        `INSERT INTO ledger_entries
           (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key, posted_at)
         VALUES ($1, $2, $3, $4, 'USDC', $5, 'test', $6, $7,
                 CASE WHEN $5 = 'posted' THEN now() ELSE NULL END)`,
        [txnId, leg.account_id, leg.direction, leg.amount.toString(), state, leg.idem_key, leg.idem_key],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}

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
  // A balanced deposit txn: debit and credit for the same amount. The debit is
  // ledger_entries id=1, which the append-only permission tests target by id.
  await insertBalancedTxn(client, 'txn_seed_1', [
    { account_id: 'acc_test_1', direction: 'debit', amount: 1000000n, idem_key: 'idem_seed_1_debit' },
    { account_id: 'acc_test_1', direction: 'credit', amount: 1000000n, idem_key: 'idem_seed_1_credit' },
  ]);
}
