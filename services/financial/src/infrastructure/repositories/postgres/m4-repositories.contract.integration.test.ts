/**
 * Runs the shared Principal + Account repository contracts against a real
 * Postgres (testcontainers) with all migrations (001–006) applied.
 */

import { beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { migrate } from '../../../../../../database/runner.js';
import { PostgresPrincipalRepository } from './postgres-principal-repository.js';
import { PostgresAccountRepository } from './postgres-account-repository.js';
import { runPrincipalRepositoryContract } from '../principal-repository.contract.js';
import { runAccountRepositoryContract } from '../account-repository.contract.js';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../../../../../database/migrations',
);

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const result = await migrate(container.getConnectionUri(), MIGRATIONS_DIR);
  if (result.errors.length > 0) throw new Error(`migration failed: ${result.errors.join('; ')}`);
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
});

runPrincipalRepositoryContract('Postgres', async () => ({
  repo: new PostgresPrincipalRepository(pool),
  reset: async () => {
    await pool.query('TRUNCATE principals RESTART IDENTITY CASCADE');
  },
  dispose: async () => {},
}));

runAccountRepositoryContract('Postgres', async () => ({
  repo: new PostgresAccountRepository(pool),
  ensurePrincipal: async (id: string) => {
    await pool.query(
      `INSERT INTO principals (id, kind) VALUES ($1, 'machine') ON CONFLICT (id) DO NOTHING`,
      [id],
    );
  },
  reset: async () => {
    await pool.query('TRUNCATE accounts, principals RESTART IDENTITY CASCADE');
  },
  dispose: async () => {},
}));
