/**
 * assertTestDb — fail-closed guard for the integration test suite.
 *
 * Wired as the vitest `globalSetup` for the `integration` project, so it runs
 * ONCE before any integration test is collected. If it throws, the entire
 * integration suite is aborted before a single query reaches a database.
 *
 * Why this exists (see scripts/ops/OPS_LOG.md, 2026-08-06): an integration
 * test read DATABASE_URL and wrote 20 fixture rows into PRODUCTION. String-
 * matching the URL is not a sufficient control — it fails OPEN when a database
 * is renamed. Instead we prove we are talking to a database that was
 * deliberately marked as a test database:
 *
 *   1. TEST_DATABASE_URL must be set (a separate variable from DATABASE_URL,
 *      which is NEVER consulted here under any condition).
 *   2. That database must contain the `__test_db_marker` table, which is
 *      created only in test databases. Production does not have it, so a
 *      misconfigured URL pointing at production fails CLOSED on the marker
 *      check rather than silently writing fixtures.
 */

import pg from 'pg';

/** The one and only variable this guard reads. DATABASE_URL is never a fallback. */
export const TEST_DB_URL_VAR = 'TEST_DATABASE_URL';

/** Thrown message when the marker cannot be confirmed. Exact by contract. */
export const MARKER_ABSENT_MESSAGE = 'Refusing to run: __test_db_marker absent.';

/**
 * Assert the process is pointed at a marked test database. Throws otherwise.
 * Never reads or falls back to DATABASE_URL.
 */
export async function assertTestDb(): Promise<void> {
  const url = process.env[TEST_DB_URL_VAR];
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error(
      `${TEST_DB_URL_VAR} is not set. The integration suite refuses to run without an ` +
        `explicit test database. DATABASE_URL is deliberately NOT used as a fallback.`,
    );
  }

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
    await client.query('SELECT 1 FROM __test_db_marker LIMIT 1');
  } catch (cause) {
    // Any failure — cannot connect, table absent, permission denied — is
    // treated identically: we could not PROVE this is a test database.
    throw new Error(MARKER_ABSENT_MESSAGE, { cause });
  } finally {
    await client.end().catch(() => {
      /* connection may never have opened; nothing to clean up */
    });
  }
}

/** Vitest globalSetup entry point. */
export default async function setup(): Promise<void> {
  await assertTestDb();
}
