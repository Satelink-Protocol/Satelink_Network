/**
 * LedgerEntry — the entity INSIDE the LedgerTransaction aggregate.
 *
 * It is intentionally NOT exported from the package barrel (index.ts). External
 * code can only ever see a `LedgerEntryView` produced by the aggregate root.
 * This is what keeps the balanced-set invariant enforceable: you cannot hold a
 * mutable entry and change it out from under the transaction that owns it.
 *
 * Instances are immutable; every field is frozen at construction.
 */

import type { Money } from '@satelink/kernel';
import type { AccountRef } from './account-ref.js';
import type { Direction } from './direction.js';
import type { EntryState } from './entry-state.js';
import type { SourceReference } from './source-reference.js';
import type { LedgerEntryView } from './types.js';

export class LedgerEntry {
  private constructor(
    readonly account: AccountRef,
    readonly direction: Direction,
    readonly amount: Money,
    readonly state: EntryState,
    readonly source: SourceReference,
    readonly reversesEntryId: string | undefined,
    readonly entryId: string | undefined,
  ) {
    Object.freeze(this);
  }

  static create(props: {
    account: AccountRef;
    direction: Direction;
    amount: Money;
    state: EntryState;
    source: SourceReference;
    reversesEntryId?: string | undefined;
    entryId?: string | undefined;
  }): LedgerEntry {
    return new LedgerEntry(
      props.account,
      props.direction,
      props.amount,
      props.state,
      props.source,
      props.reversesEntryId,
      props.entryId,
    );
  }

  /** Project to the read-only view that is safe to expose. */
  toView(): LedgerEntryView {
    return {
      account: this.account,
      direction: this.direction,
      amount: this.amount,
      state: this.state,
      source: this.source,
      reversesEntryId: this.reversesEntryId,
      entryId: this.entryId,
    };
  }
}
