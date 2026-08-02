/**
 * Shared LedgerRepository contract.
 *
 * The SAME behavioural specification is run against every implementation. This
 * is what keeps the in-memory double honest: if it and Postgres ever diverge,
 * one of them fails this suite. A repository is only a valid substitute if it
 * passes here.
 *
 * Not a *.test.ts itself — it exports a function that the per-implementation
 * *.integration.test.ts runners invoke with a harness.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { LedgerTransaction, TxnId, AccountRef, SourceReference } from '@satelink/financial-domain';
import { Money, USDT } from '@satelink/kernel';
import type { Result } from '@satelink/kernel';
import { EntryState } from '@satelink/financial-domain';
import type { LedgerRepository } from '../../application/ports/ledger-repository.js';

export interface LedgerRepoHarness {
  readonly repo: LedgerRepository;
  /** Ensure the referenced account exists (satisfies FKs in Postgres; no-op in memory). */
  ensureAccount(accountId: string): Promise<void>;
  /** Remove all ledger transactions between tests. */
  reset(): Promise<void>;
  /** Tear down (stop containers, close pools). */
  dispose(): Promise<void>;
}

function must<T, E extends { toString(): string }>(r: Result<T, E>): T {
  if (r.isErr) throw new Error(`unexpected Err in contract setup: ${r.error.toString()}`);
  return r.value;
}

function buildTransfer(txn: string, debit: string, credit: string, minor: bigint): LedgerTransaction {
  return must(
    LedgerTransaction.transfer({
      txnId: must(TxnId.of(txn)),
      source: must(SourceReference.of('revenue_event', txn)),
      debitAccount: must(AccountRef.of(debit)),
      creditAccount: must(AccountRef.of(credit)),
      amount: Money.fromMinorUnits(minor, USDT),
      state: EntryState.POSTED,
    }),
  );
}

export function runLedgerRepositoryContract(
  name: string,
  makeHarness: () => Promise<LedgerRepoHarness>,
): void {
  describe(`LedgerRepository contract — ${name}`, () => {
    let h: LedgerRepoHarness;

    beforeAll(async () => {
      h = await makeHarness();
    });
    beforeEach(async () => {
      await h.reset();
      await h.ensureAccount('acct_a');
      await h.ensureAccount('acct_b');
    });
    afterAll(async () => {
      await h?.dispose();
    });

    it('post then findByTxnId returns the transaction', async () => {
      const txn = buildTransfer('txn_c1', 'acct_a', 'acct_b', 1000n);
      const posted = await h.repo.post(txn);
      expect(posted.isOk).toBe(true);

      const found = await h.repo.findByTxnId('txn_c1');
      expect(found.isOk).toBe(true);
      if (!found.isOk) return;
      expect(found.value).not.toBeNull();
      const loaded = found.value!;
      expect(loaded.txnId.value).toBe('txn_c1');
      expect(loaded.entryCount).toBe(2);
      expect(loaded.isBalanced()).toBe(true);
      expect(loaded.totalCredits().amount).toBe(1000n);
      expect(loaded.totalDebits().amount).toBe(1000n);
    });

    it('findByTxnId returns null for an unknown id', async () => {
      const found = await h.repo.findByTxnId('txn_does_not_exist');
      expect(found.isOk).toBe(true);
      if (found.isOk) expect(found.value).toBeNull();
    });

    it('post is idempotent — re-posting the same transaction does not duplicate', async () => {
      const txn = buildTransfer('txn_idem', 'acct_a', 'acct_b', 500n);
      expect((await h.repo.post(txn)).isOk).toBe(true);
      expect((await h.repo.post(txn)).isOk).toBe(true);

      const found = await h.repo.findByTxnId('txn_idem');
      expect(found.isOk).toBe(true);
      if (found.isOk) expect(found.value?.entryCount).toBe(2);

      // Only two entries total for acct_a across both posts (one debit leg).
      const stream = await h.repo.streamByAccount('acct_a', {});
      expect(stream.isOk).toBe(true);
      if (stream.isOk) {
        expect(stream.value.filter((e) => e.source.refId === 'txn_idem').length).toBe(1);
      }
    });

    it('streamByAccount returns the entries for that account only', async () => {
      await h.repo.post(buildTransfer('txn_s1', 'acct_a', 'acct_b', 100n));
      await h.repo.post(buildTransfer('txn_s2', 'acct_b', 'acct_a', 200n));

      const a = await h.repo.streamByAccount('acct_a', {});
      expect(a.isOk).toBe(true);
      if (a.isOk) {
        // acct_a appears once per transaction (debit in s1, credit in s2).
        expect(a.value.length).toBe(2);
        for (const e of a.value) {
          expect(e.account.value).toBe('acct_a');
        }
      }
    });
  });
}
