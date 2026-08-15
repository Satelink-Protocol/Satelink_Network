/**
 * create-authorization against a real Postgres (testcontainers, migrations
 * 001–007) with REAL EIP-712 signatures (viem). Proves the three exit-gate
 * safety properties:
 *   1. a valid envelope creates exactly one authorization + funding source +
 *      USDC capacity account, atomically;
 *   2. re-submitting the same envelope creates nothing new (idempotent);
 *   3. a tampered envelope is rejected and NOTHING is persisted.
 */

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { getAddress, type Hex } from 'viem';
import { migrate } from '../../../../../database/runner.js';
import { ViemEip3009Verifier } from '../../infrastructure/adapters/viem-eip3009-verifier.js';
import { PostgresAuthorizationCreationUnitOfWork } from '../../infrastructure/repositories/postgres/postgres-authorization-creation-unit-of-work.js';
import { PostgresPrincipalRepository } from '../../infrastructure/repositories/postgres/postgres-principal-repository.js';
import { createAuthorization, BASE_USDC_ADDRESS, BASE_CHAIN_ID } from './create-authorization.js';
import type { SignedAuthorizationEnvelope } from '../ports/envelope-verifier.js';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../../../../database/migrations',
);

let container: StartedPostgreSqlContainer;
let pool: Pool;

const DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: BASE_CHAIN_ID,
  verifyingContract: getAddress(BASE_USDC_ADDRESS),
} as const;

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const PAY_TO = '0x966E1Ae22996545015b1414B35234b10719d7Ad4';

async function signEnvelope(opts: {
  privateKey?: Hex;
  value: bigint;
  nonce: Hex;
  validAfter?: bigint;
  validBefore?: bigint;
}): Promise<SignedAuthorizationEnvelope> {
  const pk = opts.privateKey ?? generatePrivateKey();
  const account = privateKeyToAccount(pk);
  const validAfter = opts.validAfter ?? 0n;
  const validBefore = opts.validBefore ?? 9_999_999_999n; // year 2286
  const message = {
    from: account.address,
    to: getAddress(PAY_TO),
    value: opts.value,
    validAfter,
    validBefore,
    nonce: opts.nonce,
  };
  const signature = await account.signTypedData({
    domain: DOMAIN,
    types: TYPES,
    primaryType: 'TransferWithAuthorization',
    message,
  });
  return {
    scheme: 'exact',
    signature,
    signer: account.address,
    domain: { ...DOMAIN },
    message: {
      from: account.address,
      to: getAddress(PAY_TO),
      value: opts.value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce: opts.nonce,
    },
  };
}

function makeDeps() {
  return {
    verifier: new ViemEip3009Verifier(),
    principals: new PostgresPrincipalRepository(pool),
    uow: new PostgresAuthorizationCreationUnitOfWork(pool),
  };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const result = await migrate(container.getConnectionUri(), MIGRATIONS_DIR);
  if (result.errors.length > 0) throw new Error(`migration failed: ${result.errors.join('; ')}`);
  pool = new Pool({ connectionString: container.getConnectionUri() });
  pool.on('error', () => {});
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
});

beforeEach(async () => {
  await pool.query('TRUNCATE principals RESTART IDENTITY CASCADE');
});

async function counts() {
  const [a, f, ac, n, p] = await Promise.all([
    pool.query('SELECT count(*)::int AS c FROM authorizations'),
    pool.query('SELECT count(*)::int AS c FROM funding_sources'),
    pool.query('SELECT count(*)::int AS c FROM accounts'),
    pool.query('SELECT count(*)::int AS c FROM authorization_nonces'),
    pool.query('SELECT count(*)::int AS c FROM principals'),
  ]);
  return {
    authorizations: a.rows[0].c,
    funding_sources: f.rows[0].c,
    accounts: ac.rows[0].c,
    nonces: n.rows[0].c,
    principals: p.rows[0].c,
  };
}

describe('createAuthorization (integration)', () => {
  it('creates exactly one authorization + funding source + USDC capacity account from a valid signature', async () => {
    const env = await signEnvelope({ value: 5000n, nonce: `0x${'a1'.repeat(32)}` });
    const res = await createAuthorization(makeDeps(), env);

    expect(res.isOk, res.isErr ? res.error.toString() : '').toBe(true);
    if (res.isErr) return;
    expect(res.value.created).toBe(true);
    expect(res.value.currency).toBe('USDC');
    expect(res.value.capMinorUnits).toBe('5000');

    const c = await counts();
    expect(c).toMatchObject({ authorizations: 1, funding_sources: 1, accounts: 1, nonces: 1, principals: 1 });

    const acct = await pool.query(
      'SELECT kind, normality, currency, balance_invariant, state, decimals FROM accounts WHERE id=$1',
      [res.value.accountId],
    );
    expect(acct.rows[0]).toMatchObject({
      kind: 'capacity',
      normality: 'credit',
      currency: 'USDC',
      balance_invariant: 'non_negative',
      state: 'open',
      decimals: 6,
    });

    const auth = await pool.query(
      'SELECT cap_amount, consumed_amount, currency, state, signature_envelope FROM authorizations WHERE id=$1',
      [res.value.authorizationId],
    );
    expect(auth.rows[0]).toMatchObject({
      cap_amount: '5000',
      consumed_amount: '0',
      currency: 'USDC',
      state: 'active',
    });
    expect(auth.rows[0].signature_envelope.scheme).toBe('exact');
    expect(auth.rows[0].signature_envelope.signer.toLowerCase()).toBe(env.signer.toLowerCase());
  });

  it('is idempotent — re-submitting the same envelope creates nothing new', async () => {
    const env = await signEnvelope({ value: 2_000_000n, nonce: `0x${'b2'.repeat(32)}` });
    const first = await createAuthorization(makeDeps(), env);
    expect(first.isOk).toBe(true);
    if (first.isErr) return;
    expect(first.value.created).toBe(true);
    const afterFirst = await counts();

    const second = await createAuthorization(makeDeps(), env);
    expect(second.isOk).toBe(true);
    if (second.isErr) return;
    expect(second.value.created).toBe(false);
    expect(second.value.authorizationId).toBe(first.value.authorizationId);

    const afterSecond = await counts();
    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond).toMatchObject({ authorizations: 1, funding_sources: 1, accounts: 1, nonces: 1 });
  });

  it('rejects a tampered envelope and persists nothing', async () => {
    const env = await signEnvelope({ value: 5000n, nonce: `0x${'c3'.repeat(32)}` });
    // Tamper: inflate the value AFTER signing — the signature no longer covers it.
    const tampered: SignedAuthorizationEnvelope = {
      ...env,
      message: { ...env.message, value: '999999999' },
    };

    const res = await createAuthorization(makeDeps(), tampered);
    expect(res.isErr).toBe(true);
    if (res.isOk) return;
    expect(res.error.reason).toMatch(/verification failed|recovered signer/i);

    const c = await counts();
    expect(c).toMatchObject({ authorizations: 0, funding_sources: 0, accounts: 0, nonces: 0, principals: 0 });
  });

  it('rejects an envelope whose claimed signer is not the actual signer', async () => {
    const env = await signEnvelope({ value: 5000n, nonce: `0x${'d4'.repeat(32)}` });
    const impostor = privateKeyToAccount(generatePrivateKey()).address;
    const spoofed: SignedAuthorizationEnvelope = {
      ...env,
      signer: impostor,
      message: { ...env.message, from: impostor },
    };

    const res = await createAuthorization(makeDeps(), spoofed);
    expect(res.isErr).toBe(true);
    const c = await counts();
    expect(c.authorizations).toBe(0);
  });
});
