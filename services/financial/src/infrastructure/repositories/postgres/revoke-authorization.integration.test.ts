/**
 * Integration: tools/ops/revoke-authorization.ts drives the REAL domain revoke()
 * + repository save(). Testcontainers-backed (matches the integration project).
 *
 * Covers cases a, b, d, e from the ops spec. Case (c) — a revoked principal's
 * next /rpc call returns the `authorization_revoked` code — is the capacity
 * enforcement behavior already guarded by
 * apps/api/src/capacity/capacity_enforcement.integration.test.ts (PR #333, case d)
 * and is proven live against the API during the M9 signer retirement.
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
import { revokeAuthorizations } from '../../../../../../tools/ops/revoke-authorization.js';

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
  pool.on('error', () => {});
  repo = new PostgresAuthorizationRepository(pool);
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop().catch(() => undefined);
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE authorizations, authorization_nonces, draws, ledger_entries, ledger_txns, funding_sources, accounts, principals RESTART IDENTITY CASCADE',
  );
  await pool.query(`INSERT INTO principals (id, kind) VALUES ('prn_owner','machine')`);
  // Re-seed the platform system accounts (migration 005) that TRUNCATE wiped —
  // needed to book a balanced ledger txn in case (e).
  await pool.query(`INSERT INTO principals (id, kind, display_name, state)
                    VALUES ('prn_platform','platform','Satelink Platform','active')`);
  await pool.query(
    `INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals, state) VALUES
       ('acct_platform_revenue','prn_platform','revenue','credit','USDT',6,'open'),
       ('acct_platform_suspense','prn_platform','suspense','debit','USDT',6,'open')`,
  );
  await pool.query(
    `INSERT INTO funding_sources (id, principal_id, rail_id, rail_reference, mode, capabilities, state, version)
     VALUES ('fs_owner','prn_owner','x402-base-usdc','{"refType":"f","refValue":"x"}'::jsonb,'authorization',
             '{"supportsRecurring":true,"supportsEscrow":false,"supportsRefund":false,"agentCompatible":true,"settlementLatency":"instant","custodial":false}'::jsonb,
             'active',1)`,
  );
});

function buildAuth(id: string, signer: string, capMinor: bigint, nonceValues: string[]): Authorization {
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
      signature: must(SignatureEnvelope.of('eip3009', '0xsig', signer)),
      nonces,
    }),
  );
}

async function stateOf(id: string): Promise<{ state: string; version: number; consumed: string }> {
  const { rows } = await pool.query(
    'SELECT state, version, consumed_amount::text AS consumed FROM authorizations WHERE id=$1',
    [id],
  );
  return { state: rows[0].state, version: rows[0].version, consumed: rows[0].consumed };
}

const OPTS = { reason: 'test', actor: 'vitest', log: () => {} };

describe('revokeAuthorizations — domain-path revocation', () => {
  it('(a) revokes an active authorization → state=revoked', async () => {
    await repo.save(buildAuth('auth_a', '0xsigner_a', 100n, ['n0']));
    const res = await revokeAuthorizations(pool, { ids: ['auth_a'], dryRun: false, ...OPTS });
    expect(res).to.have.length(1);
    expect(res[0].action).to.equal('revoke');
    expect(res[0].mutated).to.equal(true);
    const after = await stateOf('auth_a');
    expect(after.state).to.equal('revoked');
    expect(after.version).to.equal(2); // version bumped by save()
  });

  it('(b) revoking an already-revoked authorization → no-op, no error', async () => {
    await repo.save(buildAuth('auth_b', '0xsigner_b', 100n, ['n0']));
    await revokeAuthorizations(pool, { ids: ['auth_b'], dryRun: false, ...OPTS });
    const first = await stateOf('auth_b');
    // second call: idempotent no-op
    const res = await revokeAuthorizations(pool, { ids: ['auth_b'], dryRun: false, ...OPTS });
    expect(res[0].action).to.equal('noop-already-revoked');
    expect(res[0].mutated).to.equal(false);
    const second = await stateOf('auth_b');
    expect(second).to.deep.equal(first); // NOTHING changed on the no-op (version too)
  });

  it('(d) --dry-run mutates nothing — row byte-identical after', async () => {
    await repo.save(buildAuth('auth_d', '0xsigner_d', 100n, ['n0']));
    const before = await stateOf('auth_d');
    const res = await revokeAuthorizations(pool, { ids: ['auth_d'], dryRun: true, ...OPTS });
    expect(res[0].action).to.equal('revoke'); // plan says it WOULD revoke
    expect(res[0].mutated).to.equal(false); // but did not
    const after = await stateOf('auth_d');
    expect(after).to.deep.equal(before);
    expect(after.state).to.equal('active');
  });

  it('(e) consumed_amount and ledger_entries are UNCHANGED by revocation', async () => {
    // auth with consumed>0 (revocation must preserve history, not zero it)
    const auth = buildAuth('auth_e', '0xsigner_e', 1000n, ['n0']);
    await repo.save(auth);
    const loaded = must(await repo.findById('auth_e'))!;
    await repo.save(
      must(loaded.consume({ nonce: must(NonceValue.of('n0')), amount: Money.fromMinorUnits(250n, USDT), clockMs: 500 })),
    );
    // a balanced ledger txn that revocation must not touch
    await pool.query(
      `INSERT INTO ledger_txns (txn_id, kind, ref_type, ref_id, currency, state, created_at)
       VALUES ('ltx_e','deposit','revenue_event','rev_e','USDT','posted', now())`,
    );
    await pool.query(
      `INSERT INTO ledger_entries (txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key, created_at) VALUES
        ('ltx_e','acct_platform_suspense','debit', 100,'USDT','posted','revenue_event','rev_e','idem_e_d', now()),
        ('ltx_e','acct_platform_revenue', 'credit',100,'USDT','posted','revenue_event','rev_e','idem_e_c', now())`,
    );
    const ledgerBefore = (await pool.query('SELECT count(*)::int n, COALESCE(sum(amount),0)::text s FROM ledger_entries')).rows[0];
    const consumedBefore = (await stateOf('auth_e')).consumed;

    await revokeAuthorizations(pool, { ids: ['auth_e'], dryRun: false, ...OPTS });

    const after = await stateOf('auth_e');
    expect(after.state).to.equal('revoked');
    expect(after.consumed).to.equal(consumedBefore); // consumed preserved (250)
    expect(Number(consumedBefore)).to.equal(250);
    const ledgerAfter = (await pool.query('SELECT count(*)::int n, COALESCE(sum(amount),0)::text s FROM ledger_entries')).rows[0];
    expect(ledgerAfter).to.deep.equal(ledgerBefore); // ledger untouched: same count AND sum
  });

  it('resolves by signer with the canonical tiebreak (valid_before ASC, id ASC)', async () => {
    await repo.save(buildAuth('auth_z', '0xshared', 100n, ['n0']));
    await repo.save(buildAuth('auth_a2', '0xshared', 100n, ['n1']));
    const res = await revokeAuthorizations(pool, { signer: '0xshared', dryRun: true, ...OPTS });
    expect(res.map((r) => r.authId)).to.deep.equal(['auth_a2', 'auth_z']); // id ASC (same valid_before)
  });
});
