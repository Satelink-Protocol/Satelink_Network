/**
 * Integration: optimistic locking makes concurrent consumption safe.
 *
 * N concurrent consumers each try to consume 1 unit via a distinct nonce against
 * a cap of N-1. With compare-and-set on version + retry, EXACTLY N-1 succeed and
 * the last hits CapExceededError — total consumed never exceeds cap (no lost
 * update). Also exercises the read-only GetCapacity query.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { migrate } from '../../../../../../database/runner.js';
import {
  Authorization,
  AuthorizationId,
  PrincipalId,
  FundingSourceId,
  Cap,
  ValidityWindow,
  SignatureEnvelope,
  NonceValue,
} from '@satelink/financial-domain';
import type { AuthorizationNonceInput } from '@satelink/financial-domain';
import { Money, USDT } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import { PostgresAuthorizationRepository } from './postgres-authorization-repository.js';
import { getCapacity } from '../../../application/queries/get-capacity.js';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../../../../../database/migrations',
);

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}

let container: StartedPostgreSqlContainer;
let pool: Pool;
let repo: PostgresAuthorizationRepository;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const result = await migrate(container.getConnectionUri(), MIGRATIONS_DIR);
  if (result.errors.length > 0) throw new Error(`migration failed: ${result.errors.join('; ')}`);
  pool = new Pool({ connectionString: container.getConnectionUri() });
  // Swallow idle-client connection errors (e.g. a socket reset when the
  // testcontainer stops in afterAll) so they never surface as unhandled
  // rejections. Query errors still reject their own promises.
  pool.on('error', () => {});
  repo = new PostgresAuthorizationRepository(pool);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
});

beforeEach(async () => {
  await pool.query('TRUNCATE principals RESTART IDENTITY CASCADE');
  await pool.query(`INSERT INTO principals (id, kind) VALUES ('prn_owner','machine')`);
  await pool.query(
    `INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state, version)
     VALUES ('fs_owner','prn_owner','x402-base-usdc','{"refType":"f","refValue":"x"}'::jsonb,'authorization',
             '{"supportsRecurring":true,"supportsEscrow":false,"supportsRefund":false,"agentCompatible":true,"settlementLatency":"instant","custodial":false}'::jsonb,
             'active',1)`,
  );
});

function buildAuth(id: string, capMinor: bigint, nonceValues: string[]): Authorization {
  const nonces: AuthorizationNonceInput[] = nonceValues.map((v) => ({
    value: must(NonceValue.of(v)),
    window: must(ValidityWindow.of(0, 1_000_000)),
  }));
  return must(
    Authorization.create({
      id: must(AuthorizationId.of(id)),
      principalId: must(PrincipalId.of('prn_owner')),
      fundingSourceId: must(FundingSourceId.of('fs_owner')),
      cap: must(Cap.of(Money.fromMinorUnits(capMinor, USDT))),
      window: must(ValidityWindow.of(0, 1_000_000)),
      signature: must(SignatureEnvelope.of('eip3009', '0xsig', '0xsigner')),
      nonces,
    }),
  );
}

async function consumeOnce(authId: string, nonce: string): Promise<'ok' | 'cap' | 'other'> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const found = await repo.findById(authId);
    if (found.isErr || found.value === null) return 'other';
    const c = found.value.consume({
      nonce: must(NonceValue.of(nonce)),
      amount: Money.fromMinorUnits(1n, USDT),
      clockMs: 500,
    });
    if (c.isErr) return c.error.tag === 'CapExceededError' ? 'cap' : 'other';
    const saved = await repo.save(c.value);
    if (saved.isOk) return 'ok';
    if (saved.error.tag === 'StaleVersionError') continue; // reload + retry
    return 'other';
  }
  return 'other';
}

describe('Authorization — concurrency under optimistic locking', () => {
  it('N concurrent consumes against cap N-1 => EXACTLY N-1 succeed', async () => {
    const N = 6;
    const cap = BigInt(N - 1); // 5 units
    const nonceValues = Array.from({ length: N }, (_, i) => `n${i}`);
    await repo.save(buildAuth('auth_conc', cap, nonceValues));

    const results = await Promise.all(nonceValues.map((n) => consumeOnce('auth_conc', n)));
    const ok = results.filter((r) => r === 'ok').length;
    const capped = results.filter((r) => r === 'cap').length;

    expect(ok).toBe(N - 1); // exactly cap units consumed
    expect(capped).toBe(1); // exactly one rejected on cap

    const final = must(await repo.findById('auth_conc'))!;
    expect(final.consumed.money.amount).toBe(cap); // never exceeded cap
    expect(final.noncesRemaining()).toBe(1);
  });
});

describe('GetCapacity — read-only query', () => {
  it('reports cap, consumed, available, and nonces remaining', async () => {
    await repo.save(buildAuth('auth_gc', 1000n, ['n0', 'n1', 'n2']));
    const loaded = must(await repo.findById('auth_gc'))!;
    await repo.save(
      must(loaded.consume({ nonce: must(NonceValue.of('n0')), amount: Money.fromMinorUnits(300n, USDT), clockMs: 500 })),
    );

    const cap = must(await getCapacity(repo, 'prn_owner'));
    expect(cap.currency).toBe('USDT');
    expect(cap.cap).toBe('0.001000'); // 1000 minor, USDT/6
    expect(cap.consumed).toBe('0.000300');
    expect(cap.available).toBe('0.000700');
    expect(cap.noncesRemaining).toBe(2);
    expect(cap.authorizationCount).toBe(1);
  });

  it('returns zeros for a principal with no authorizations', async () => {
    const cap = must(await getCapacity(repo, 'prn_nobody'));
    expect(cap.authorizationCount).toBe(0);
    expect(cap.available).toBe('0');
    expect(cap.currency).toBeNull();
  });
});
