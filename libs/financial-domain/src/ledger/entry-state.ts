/**
 * EntryState — lifecycle state of a ledger entry.
 *
 *   pending — recorded but not yet confirmed; contributes to holds, not to
 *             posted balance (invariant #3).
 *   posted  — confirmed and settled.
 *   voided  — excluded from balance entirely (mirrors the `state != 'voided'`
 *             filter in the M2 account_balances view).
 *
 * Matches the CHECK constraint on ledger_entries.state in 003.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type EntryStateValue = 'pending' | 'posted' | 'voided';

export class InvalidEntryStateError {
  readonly tag = 'InvalidEntryStateError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidEntryStateError: "${this.value}" is not a valid entry state`;
  }
}

export class EntryState {
  private constructor(readonly value: EntryStateValue) {
    Object.freeze(this);
  }

  static readonly PENDING: EntryState = new EntryState('pending');
  static readonly POSTED: EntryState = new EntryState('posted');
  static readonly VOIDED: EntryState = new EntryState('voided');

  static of(raw: string): Result<EntryState, InvalidEntryStateError> {
    switch (raw) {
      case 'pending':
        return ok(EntryState.PENDING);
      case 'posted':
        return ok(EntryState.POSTED);
      case 'voided':
        return ok(EntryState.VOIDED);
      default:
        return err(new InvalidEntryStateError(raw));
    }
  }

  isPending(): boolean {
    return this.value === 'pending';
  }

  isPosted(): boolean {
    return this.value === 'posted';
  }

  isVoided(): boolean {
    return this.value === 'voided';
  }

  equals(other: EntryState): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
