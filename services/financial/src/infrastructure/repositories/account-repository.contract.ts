/**
 * Shared AccountRepository contract — run against Postgres and in-memory.
 * Covers findByPrincipalKindCurrency, the (principal_id, kind, currency)
 * uniqueness rule, and optimistic locking.
 *
 * The harness provides ensurePrincipal() so the Postgres FK (accounts ->
 * principals) is satisfied; in-memory makes it a no-op.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Account, AccountId, AccountKind, Normality, BalanceInvariant, PrincipalId } from '@satelink/financial-domain';
import { USDT } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import type { AccountRepository } from '../../application/ports/account-repository.js';

export interface AccountRepoHarness {
  readonly repo: AccountRepository;
  ensurePrincipal(id: string): Promise<void>;
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
function newAccount(id: string, principalId: string): Account {
  return must(
    Account.create({
      id: must(AccountId.of(id)),
      principalId: must(PrincipalId.of(principalId)),
      kind: AccountKind.CAPACITY,
      normality: Normality.CREDIT,
      currency: USDT,
      balanceInvariant: BalanceInvariant.NON_NEGATIVE,
    }),
  );
}

export function runAccountRepositoryContract(
  name: string,
  makeHarness: () => Promise<AccountRepoHarness>,
): void {
  describe(`AccountRepository contract — ${name}`, () => {
    let h: AccountRepoHarness;
    beforeAll(async () => {
      h = await makeHarness();
    });
    beforeEach(async () => {
      await h.reset();
      await h.ensurePrincipal('prn_owner');
    });
    afterAll(async () => {
      await h?.dispose();
    });

    it('save then findById returns the account at version 1', async () => {
      expect((await h.repo.save(newAccount('acct_a', 'prn_owner'))).isOk).toBe(true);
      const found = must(await h.repo.findById('acct_a'));
      expect(found?.id.value).toBe('acct_a');
      expect(found?.version).toBe(1);
      expect(found?.currency.code).toBe('USDT');
    });

    it('findByPrincipal returns all accounts for a principal', async () => {
      await h.repo.save(newAccount('acct_a', 'prn_owner'));
      const list = must(await h.repo.findByPrincipal('prn_owner'));
      expect(list.map((a) => a.id.value)).toEqual(['acct_a']);
    });

    it('findByPrincipalKindCurrency locates the capacity account', async () => {
      await h.repo.save(newAccount('acct_a', 'prn_owner'));
      const found = must(await h.repo.findByPrincipalKindCurrency('prn_owner', 'capacity', 'USDT'));
      expect(found?.id.value).toBe('acct_a');
      expect(must(await h.repo.findByPrincipalKindCurrency('prn_owner', 'revenue', 'USDT'))).toBeNull();
    });

    it('rejects a duplicate (principal_id, kind, currency)', async () => {
      expect((await h.repo.save(newAccount('acct_a', 'prn_owner'))).isOk).toBe(true);
      // Same tuple, different id -> unique violation.
      const dup = await h.repo.save(newAccount('acct_b', 'prn_owner'));
      expect(dup.isErr).toBe(true);
    });

    it('optimistic locking: a concurrent stale write is rejected', async () => {
      await h.repo.save(newAccount('acct_v', 'prn_owner'));
      const a = must(await h.repo.findById('acct_v'))!;
      const b = must(await h.repo.findById('acct_v'))!;

      expect((await h.repo.save(must(a.freeze()))).isOk).toBe(true);
      const stale = await h.repo.save(must(b.freeze()));
      expect(stale.isErr).toBe(true);
      if (stale.isErr) expect(stale.error.tag).toBe('StaleVersionError');

      const reloaded = must(await h.repo.findById('acct_v'))!;
      expect(reloaded.state.value).toBe('frozen');
      expect(reloaded.version).toBe(2);
    });
  });
}
