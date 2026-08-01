/**
 * InMemoryLedgerRepository — the in-memory double used to keep the shared
 * contract suite honest and to test application logic without Docker.
 *
 * Same append-only contract as Postgres: post is idempotent (first write wins),
 * there is no way to mutate or remove a stored transaction.
 */

import type {
  LedgerRepository,
  LedgerRepositoryError,
  TimeRange,
} from '../../../application/ports/ledger-repository.js';
import type { LedgerTransaction, LedgerEntryView } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';
import { ok } from '@satelink/kernel';

export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly byTxnId = new Map<string, LedgerTransaction>();

  async post(txn: LedgerTransaction): Promise<Result<void, LedgerRepositoryError>> {
    const id = txn.txnId.value;
    // Idempotent: a repeat post of the same id is a no-op success.
    if (!this.byTxnId.has(id)) {
      this.byTxnId.set(id, txn);
    }
    return ok(undefined);
  }

  async findByTxnId(id: string): Promise<Result<LedgerTransaction | null, LedgerRepositoryError>> {
    return ok(this.byTxnId.get(id) ?? null);
  }

  async streamByAccount(
    accountId: string,
    _range: TimeRange,
  ): Promise<Result<readonly LedgerEntryView[], LedgerRepositoryError>> {
    const views: LedgerEntryView[] = [];
    for (const txn of this.byTxnId.values()) {
      for (const entry of txn.entries) {
        if (entry.account.value === accountId) {
          views.push(entry);
        }
      }
    }
    return ok(views);
  }

  /** Test-only reset. */
  clear(): void {
    this.byTxnId.clear();
  }
}
