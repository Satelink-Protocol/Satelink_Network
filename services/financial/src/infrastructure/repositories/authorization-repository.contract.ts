/**
 * Shared AuthorizationRepository contract — run against Postgres and in-memory.
 * Proves the full nonce set round-trips with the root, consumption persists, and
 * optimistic locking rejects a concurrent stale write.
 *
 * The harness supplies ensurePrincipal()/ensureFundingSource() for the Postgres
 * FKs; in-memory makes them no-ops.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
import type { AuthorizationRepository } from '../../application/ports/authorization-repository.js';

export interface AuthorizationRepoHarness {
  readonly repo: AuthorizationRepository;
  ensurePrincipal(id: string): Promise<void>;
  ensureFundingSource(id: string, principalId: string): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
function nonceInputs(values: string[]): AuthorizationNonceInput[] {
  return values.map((v) => ({
    value: must(NonceValue.of(v)),
    window: must(ValidityWindow.of(0, 1_000_000)),
  }));
}
function newAuth(id: string, capMinor: bigint, nonces: string[]): Authorization {
  return must(
    Authorization.create({
      id: must(AuthorizationId.of(id)),
      principalId: must(PrincipalId.of('prn_owner')),
      fundingSourceId: must(FundingSourceId.of('fs_owner')),
      cap: must(Cap.of(Money.fromMinorUnits(capMinor, USDT))),
      window: must(ValidityWindow.of(0, 1_000_000)),
      signature: must(SignatureEnvelope.of('eip3009', '0xsig', '0xsigner')),
      nonces: nonceInputs(nonces),
    }),
  );
}

export function runAuthorizationRepositoryContract(
  name: string,
  makeHarness: () => Promise<AuthorizationRepoHarness>,
): void {
  describe(`AuthorizationRepository contract — ${name}`, () => {
    let h: AuthorizationRepoHarness;
    beforeAll(async () => {
      h = await makeHarness();
    });
    beforeEach(async () => {
      await h.reset();
      await h.ensurePrincipal('prn_owner');
      await h.ensureFundingSource('fs_owner', 'prn_owner');
    });
    afterAll(async () => {
      await h?.dispose();
    });

    it('save then findById returns the authorization WITH its full nonce set', async () => {
      expect((await h.repo.save(newAuth('auth_a', 1000n, ['n0', 'n1', 'n2']))).isOk).toBe(true);
      const found = must(await h.repo.findById('auth_a'));
      expect(found).not.toBeNull();
      const a = found!;
      expect(a.id.value).toBe('auth_a');
      expect(a.version).toBe(1);
      expect(a.cap.money.amount).toBe(1000n);
      expect(a.nonces.length).toBe(3);
      expect(a.noncesRemaining()).toBe(3);
    });

    it('findById returns null for unknown id', async () => {
      expect(must(await h.repo.findById('nope'))).toBeNull();
    });

    it('consumption persists (consumed amount + nonce state) across a reload', async () => {
      await h.repo.save(newAuth('auth_c', 1000n, ['n0', 'n1']));
      const loaded = must(await h.repo.findById('auth_c'))!;
      const consumed = must(loaded.consume({ nonce: must(NonceValue.of('n0')), amount: Money.fromMinorUnits(300n, USDT), clockMs: 500 }));
      expect((await h.repo.save(consumed)).isOk).toBe(true);

      const reloaded = must(await h.repo.findById('auth_c'))!;
      expect(reloaded.consumed.money.amount).toBe(300n);
      expect(reloaded.available().amount).toBe(700n);
      expect(reloaded.noncesRemaining()).toBe(1); // n0 consumed, n1 remains
      expect(reloaded.version).toBe(2);
    });

    it('findByPrincipal returns each authorization with its nonces', async () => {
      await h.repo.save(newAuth('auth_p', 500n, ['n0']));
      const list = must(await h.repo.findByPrincipal('prn_owner'));
      expect(list.map((a) => a.id.value)).toEqual(['auth_p']);
      expect(list[0]!.nonces.length).toBe(1);
    });

    it('optimistic locking: a concurrent stale write is rejected', async () => {
      await h.repo.save(newAuth('auth_v', 1000n, ['n0', 'n1']));
      const a = must(await h.repo.findById('auth_v'))!;
      const b = must(await h.repo.findById('auth_v'))!;

      const aConsumed = must(a.consume({ nonce: must(NonceValue.of('n0')), amount: Money.fromMinorUnits(1n, USDT), clockMs: 500 }));
      expect((await h.repo.save(aConsumed)).isOk).toBe(true);

      const bConsumed = must(b.consume({ nonce: must(NonceValue.of('n1')), amount: Money.fromMinorUnits(1n, USDT), clockMs: 500 }));
      const stale = await h.repo.save(bConsumed);
      expect(stale.isErr).toBe(true);
      if (stale.isErr) expect(stale.error.tag).toBe('StaleVersionError');

      const reloaded = must(await h.repo.findById('auth_v'))!;
      expect(reloaded.consumed.money.amount).toBe(1n); // only the first write landed
      expect(reloaded.version).toBe(2);
    });
  });
}
