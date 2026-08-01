/**
 * Read-model shapes for ledger entries.
 *
 * `LedgerEntryView` is the ONLY way entry data leaves the aggregate. It is a
 * plain readonly value shape, not the LedgerEntry entity — the entity itself is
 * never exposed outside LedgerTransaction. Repositories persist and reconstruct
 * from views; BalanceCalculator reads from views.
 */

import type { Money } from '@satelink/kernel';
import type { AccountRef } from './account-ref.js';
import type { Direction } from './direction.js';
import type { EntryState } from './entry-state.js';
import type { SourceReference } from './source-reference.js';

/** Immutable, read-only projection of a single ledger entry. */
export interface LedgerEntryView {
  readonly account: AccountRef;
  readonly direction: Direction;
  readonly amount: Money;
  readonly state: EntryState;
  readonly source: SourceReference;
  /** Entry id this entry reverses, if any (reversals are new entries). */
  readonly reversesEntryId: string | undefined;
  /** Storage id, present only after persistence / on reconstruction. */
  readonly entryId: string | undefined;
}

/** Input shape for a single entry when constructing a transaction. */
export interface LedgerEntryInput {
  readonly account: AccountRef;
  readonly direction: Direction;
  readonly amount: Money;
  readonly state: EntryState;
  readonly source: SourceReference;
  readonly reversesEntryId?: string | undefined;
  readonly entryId?: string | undefined;
}
