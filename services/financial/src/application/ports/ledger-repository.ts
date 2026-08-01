/**
 * LedgerRepository — the persistence PORT for the ledger aggregate.
 *
 * Declared in the application layer, implemented in infrastructure (dependency
 * inversion; enforced by `application-not-to-infrastructure` in
 * .dependency-cruiser.cjs).
 *
 * APPEND-ONLY BY TYPE: there is deliberately no update() and no delete(). The
 * ledger is append-only (invariant #5); making mutation *unrepresentable in the
 * interface* is stronger than leaving it merely unused. Reversals are expressed
 * as a new LedgerTransaction (see LedgerTransaction.reverse).
 */

import type { LedgerTransaction, LedgerEntryView } from '@satelink/financial-domain';
import type { Result } from '@satelink/kernel';

/** Inclusive time window for streaming entries; ISO-8601 strings. */
export interface TimeRange {
  readonly since?: string | undefined;
  readonly until?: string | undefined;
}

/** Repository-level failure (I/O, mapping). Distinct from domain LedgerError. */
export interface LedgerRepositoryError {
  readonly tag: 'LedgerRepositoryError';
  readonly message: string;
  readonly cause?: unknown;
}

export interface LedgerRepository {
  /**
   * Persist a balanced transaction. MUST be idempotent: posting a transaction
   * whose entries already exist is a no-op success (invariant #6).
   */
  post(txn: LedgerTransaction): Promise<Result<void, LedgerRepositoryError>>;

  /** Load a transaction by id, or ok(null) if none exists. */
  findByTxnId(id: string): Promise<Result<LedgerTransaction | null, LedgerRepositoryError>>;

  /** Read entries for one account within a time range (for balance derivation). */
  streamByAccount(
    accountId: string,
    range: TimeRange,
  ): Promise<Result<readonly LedgerEntryView[], LedgerRepositoryError>>;
}

/** Helper to build a repository error. */
export function ledgerRepositoryError(message: string, cause?: unknown): LedgerRepositoryError {
  return { tag: 'LedgerRepositoryError', message, cause };
}
