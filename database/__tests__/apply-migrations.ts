// Test-only helper: apply the ledger migration set to a throwaway database,
// after seeding the cross-schema prerequisites those migrations amend.
//
// The ledger migrations in database/migrations/ share one production Postgres
// with the legacy apps/api schema. A few of them AMEND api-owned tables:
//   - 014/015 ALTER `revenue_events_v2` (apps/api/src/core/db/sql/007_day1_revenue.sql)
//   - 018 FKs `api_credits(api_key)`
// In every real deployment those api tables exist long before 014, so the
// migrations apply cleanly. But an integration test spins up an EMPTY
// testcontainer and runs only this set, so 014 fails with
// `relation "revenue_events_v2" does not exist` and takes the whole suite down.
//
// This helper seeds the MINIMAL shape those migrations reference (idempotent),
// then runs the real migrate(). It is strictly test infrastructure — it never
// runs against production, and it does NOT edit the already-applied migrations
// 014/015 (the runner rejects any checksum change to an applied migration).

import { Client } from 'pg';
import { migrate, type MigrationResult } from '../runner.js';

/**
 * Seed the api-schema tables the ledger migrations 014/015/018 depend on.
 * Only the columns those migrations reference are declared; production's real
 * tables have the full set. Safe to call repeatedly.
 */
export async function seedApiSchemaPrereqs(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS revenue_events_v2 (
        id           BIGSERIAL PRIMARY KEY,
        amount_usdt  NUMERIC(20, 6),
        is_test_data BOOLEAN NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS api_credits (
        api_key TEXT PRIMARY KEY
      );
    `);
  } finally {
    await client.end();
  }
}

/**
 * Seed cross-schema prerequisites, then apply all ledger migrations. Drop-in
 * replacement for `migrate(...)` in integration tests that set up a fresh DB.
 */
export async function applyMigrationsForTest(
  connectionString: string,
  migrationsDir?: string,
): Promise<MigrationResult> {
  await seedApiSchemaPrereqs(connectionString);
  return migrate(connectionString, migrationsDir);
}
