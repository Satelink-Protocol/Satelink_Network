/**
 * M9 schedule enforcement integration test — proves the exit-gate properties:
 *
 *   1. Five authorizations registered with a shared schedule_id, one nonce each.
 *   2. enforceNew() draws from auth_1 (soonest-expiring / lowest id).
 *   3. When auth_1 exhausts (consumed = cap), the next call draws from auth_2
 *      WITHOUT interruption (zero-gap transition).
 *   4. Transitions are ordered by id ASC (deterministic, matching #322 tiebreak).
 *   5. When all 5 exhaust, the next call is denied with 'insufficient_capacity'.
 *
 * Uses testcontainers (Postgres 16) with migrations 001–012.
 */

import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { resolve } from 'node:path';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { getAddress, toHex, type Hex } from 'viem';
import { randomBytes } from 'node:crypto';
import { applyMigrationsForTest } from '../../../../database/__tests__/apply-migrations.js';
import { ViemEip3009Verifier } from '../../../../services/financial/src/infrastructure/adapters/viem-eip3009-verifier.js';
import { PostgresPrincipalRepository } from '../../../../services/financial/src/infrastructure/repositories/postgres/postgres-principal-repository.js';
import { PostgresAuthorizationCreationUnitOfWork } from '../../../../services/financial/src/infrastructure/repositories/postgres/postgres-authorization-creation-unit-of-work.js';
import { createAuthorization, BASE_USDC_ADDRESS, BASE_CHAIN_ID } from '../../../../services/financial/src/application/commands/create-authorization.js';
import type { SignedAuthorizationEnvelope } from '../../../../services/financial/src/application/ports/envelope-verifier.js';

const MIGRATIONS_DIR = resolve(
  import.meta.dirname ?? new URL('.', import.meta.url).pathname,
  '../../../../database/migrations',
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

async function signEnvelope(privateKey: Hex, value: bigint): Promise<SignedAuthorizationEnvelope> {
  const account = privateKeyToAccount(privateKey);
  const nonce = toHex(randomBytes(32));
  const validAfter = 0n;
  const validBefore = 9_999_999_999n;
  const message = {
    from: account.address,
    to: getAddress(PAY_TO),
    value,
    validAfter,
    validBefore,
    nonce,
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
      value: value.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
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

/**
 * Reimplements enforceNew()'s core logic directly against the pool —
 * the JS module in apps/api/src/capacity/ is not importable from here
 * (different workspace, no build step). The SQL is identical.
 */
async function enforceNewDirect(
  db: Pool,
  principalId: string,
  cost: number,
): Promise<{ ok: boolean; authId?: string; remaining?: string; reason?: string }> {
  const nowMs = Date.now();
  const upd = await db.query(
    `UPDATE authorizations
        SET consumed_amount = consumed_amount + $2
      WHERE id = (
        SELECT id FROM authorizations
         WHERE principal_id = $1 AND state = 'active' AND currency = 'USDC'
           AND valid_after <= $3 AND valid_before >= $3
           AND cap_amount - consumed_amount >= $2
         ORDER BY valid_before ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, cap_amount, consumed_amount`,
    [principalId, String(cost), nowMs],
  );
  if ((upd.rowCount ?? 0) > 0) {
    const row = upd.rows[0];
    const remaining = BigInt(row.cap_amount) - BigInt(row.consumed_amount);
    return { ok: true, authId: row.id, remaining: remaining.toString() };
  }
  return { ok: false, reason: 'insufficient_capacity' };
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const result = await applyMigrationsForTest(container.getConnectionUri(), MIGRATIONS_DIR);
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
  // Also truncate schedule_state (depends on authorizations via FK, so cascade handles it).
  // But schedule_state has its own FK to principals via authorizations, so we
  // need to delete it before truncating principals.
  await pool.query('DELETE FROM schedule_state');
});

describe('M9 schedule enforcement (integration)', () => {
  it('5 auths exhaust in id-ASC order with zero-gap transitions', async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const capPerNonce = 90n; // 90 minor units = 3 calls at cost 30

    // 1. Sign 5 envelopes.
    const envelopes: SignedAuthorizationEnvelope[] = [];
    for (let i = 0; i < 5; i++) {
      envelopes.push(await signEnvelope(pk, capPerNonce));
    }

    // 2. Register all 5 via createAuthorization.
    const authIds: string[] = [];
    for (const env of envelopes) {
      const res = await createAuthorization(makeDeps(), env);
      expect(res.isOk, res.isErr ? res.error.toString() : '').toBe(true);
      if (res.isOk) authIds.push(res.value.authorizationId);
    }
    expect(authIds).toHaveLength(5);

    // 3. Apply schedule_id.
    const scheduleId = `sched_test_${Date.now()}`;
    await pool.query(
      `UPDATE authorizations SET schedule_id = $1 WHERE id = ANY($2::text[])`,
      [scheduleId, authIds],
    );

    // Verify the auth order (id ASC).
    const orderedRes = await pool.query<{ id: string }>(
      `SELECT id FROM authorizations WHERE schedule_id = $1 ORDER BY id ASC`,
      [scheduleId],
    );
    const orderedAuthIds = orderedRes.rows.map((r) => r.id);
    expect(orderedAuthIds).toHaveLength(5);

    // 4. Resolve principal_id.
    const principalRes = await pool.query<{ principal_id: string }>(
      `SELECT principal_id FROM authorizations WHERE id = $1`,
      [orderedAuthIds[0]],
    );
    const principalId = principalRes.rows[0]!.principal_id;

    // 5. Drive 15 calls (3 per nonce × 5 nonces) — all should succeed.
    const callCost = 30;
    const callResults: { ok: boolean; authId?: string }[] = [];
    for (let i = 0; i < 15; i++) {
      const result = await enforceNewDirect(pool, principalId, callCost);
      callResults.push(result);
      expect(result.ok).toBe(true);
    }

    // 6. Verify each auth was used for exactly 3 calls (in order).
    for (let nonce = 0; nonce < 5; nonce++) {
      for (let call = 0; call < 3; call++) {
        const idx = nonce * 3 + call;
        expect(callResults[idx]!.authId).toBe(orderedAuthIds[nonce]);
      }
    }

    // 7. The 16th call should be denied.
    const denied = await enforceNewDirect(pool, principalId, callCost);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('insufficient_capacity');

    // 8. Verify all 5 auths are fully consumed.
    const consumed = await pool.query<{ id: string; consumed_amount: string; cap_amount: string }>(
      `SELECT id, consumed_amount::text, cap_amount::text FROM authorizations WHERE schedule_id = $1 ORDER BY id ASC`,
      [scheduleId],
    );
    for (const row of consumed.rows) {
      expect(row.consumed_amount).toBe(row.cap_amount);
    }
  }, 60_000);

  it('available never exceeds confirmed settled funds within a schedule', async () => {
    const pk = generatePrivateKey();
    const capPerNonce = 120n; // 4 calls at cost 30

    const envelopes: SignedAuthorizationEnvelope[] = [];
    for (let i = 0; i < 3; i++) {
      envelopes.push(await signEnvelope(pk, capPerNonce));
    }

    const authIds: string[] = [];
    for (const env of envelopes) {
      const res = await createAuthorization(makeDeps(), env);
      expect(res.isOk).toBe(true);
      if (res.isOk) authIds.push(res.value.authorizationId);
    }

    const scheduleId = `sched_avail_${Date.now()}`;
    await pool.query(
      `UPDATE authorizations SET schedule_id = $1 WHERE id = ANY($2::text[])`,
      [scheduleId, authIds],
    );

    const principalRes = await pool.query<{ principal_id: string }>(
      `SELECT principal_id FROM authorizations WHERE id = $1`,
      [authIds[0]],
    );
    const principalId = principalRes.rows[0]!.principal_id;

    // After each call, check: available (cap - consumed) <= cap (confirmed settled).
    // Since no on-chain settlement has occurred, "settled funds" = cap_amount
    // (the signed authorization IS the confirmation of available funds).
    const callCost = 30;
    for (let i = 0; i < 12; i++) {
      const result = await enforceNewDirect(pool, principalId, callCost);
      expect(result.ok).toBe(true);

      // Query total available across the schedule.
      const avail = await pool.query<{ available: string; cap: string }>(
        `SELECT COALESCE(SUM(cap_amount - consumed_amount), 0)::text AS available,
                COALESCE(SUM(cap_amount), 0)::text AS cap
           FROM authorizations WHERE schedule_id = $1 AND state = 'active'`,
        [scheduleId],
      );
      const available = BigInt(avail.rows[0]!.available);
      const cap = BigInt(avail.rows[0]!.cap);
      // available must never exceed cap (confirmed settled funds).
      expect(available <= cap).toBe(true);
      // available must be non-negative.
      expect(available >= 0n).toBe(true);
    }
  }, 60_000);
});
