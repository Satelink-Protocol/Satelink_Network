/**
 * Testcontainers smoke test.
 *
 * M2 onward depends on real-Postgres integration tests. This proves the
 * container toolchain works now, so a failure at M2 is a code failure rather
 * than an infrastructure surprise.
 *
 * Excluded from the default `npm test` run because it requires Docker and
 * takes ~20s. Invoked explicitly:
 *
 *   npm run test:integration
 *
 * CI runs it in a dedicated job that is allowed to be slow.
 */

import { describe, it, expect } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

describe('testcontainers infrastructure', { timeout: 120_000 }, () => {
  it('starts postgres, accepts a connection, and tears down', async () => {
    let container: StartedPostgreSqlContainer | undefined;
    let client: Client | undefined;

    try {
      container = await new PostgreSqlContainer('postgres:16-alpine').start();

      client = new Client({ connectionString: container.getConnectionUri() });
      await client.connect();

      const { rows } = await client.query<{ ok: number }>('SELECT 1 AS ok');
      expect(rows[0]?.ok).toBe(1);

      // Confirms the version the migrations in M2 will target.
      const { rows: version } = await client.query<{ server_version_num: string }>(
        'SHOW server_version_num',
      );
      expect(Number(version[0]?.server_version_num)).toBeGreaterThanOrEqual(160000);
    } finally {
      await client?.end().catch(() => undefined);
      await container?.stop().catch(() => undefined);
    }
  });
});
