/**
 * Runs the shared FundingSource + Authorization repository contracts against a
 * real Postgres (testcontainers) with migrations 001–007 applied.
 */

import { beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { migrate } from '../../../../../../database/runner.js';
import { PostgresFundingSourceRepository } from './postgres-funding-source-repository.js';
import { PostgresAuthorizationRepository } from './postgres-authorization-repository.js';
import { runFundingSourceRepositoryContract } from '../funding-source-repository.contract.js';
import { runAuthorizationRepositoryContract } from '../authorization-repository.contract.js';

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
  // Swallow idle-client connection errors (e.g. a socket reset when the
  // testcontainer stops in afterAll) so they never surface as unhandled
  // rejections. Query errors still reject their own promises.
  pool.on('error', () => {});
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
});

async function ensurePrincipal(id: string): Promise<void> {
  await pool.query(
    `INSERT INTO principals (id, kind) VALUES ($1, 'machine') ON CONFLICT (id) DO NOTHING`,
    [id],
  );
}

async function ensureFundingSource(id: string, principalId: string): Promise<void> {
  await ensurePrincipal(principalId);
  await pool.query(
    `INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state, version)
     VALUES ($1, $2, 'x402-base-usdc', '{"refType":"facilitator","refValue":"0xabc"}'::jsonb,
             'authorization',
             '{"supportsRecurring":true,"supportsEscrow":false,"supportsRefund":false,"agentCompatible":true,"settlementLatency":"instant","custodial":false}'::jsonb,
             'active', 1)
     ON CONFLICT (id) DO NOTHING`,
    [id, principalId],
  );
}

runFundingSourceRepositoryContract('Postgres', async () => ({
  repo: new PostgresFundingSourceRepository(pool),
  ensurePrincipal,
  reset: async () => {
    await pool.query('TRUNCATE principals RESTART IDENTITY CASCADE');
  },
  dispose: async () => {},
}));

runAuthorizationRepositoryContract('Postgres', async () => ({
  repo: new PostgresAuthorizationRepository(pool),
  ensurePrincipal,
  ensureFundingSource,
  reset: async () => {
    await pool.query('TRUNCATE principals RESTART IDENTITY CASCADE');
  },
  dispose: async () => {},
}));
