/**
 * AccountKind — the role an account plays (e.g. 'capacity', 'revenue',
 * 'suspense'). An open, validated string rather than a closed enum: the ledger
 * schema (002) stores it as free TEXT and new kinds arrive without a domain
 * change. `CAPACITY` is the kind the M4 backfill creates.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 64;

export class InvalidAccountKindError {
  readonly tag = 'InvalidAccountKindError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidAccountKindError: ${this.reason}`;
  }
}

export class AccountKind {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<AccountKind, InvalidAccountKindError> {
    if (typeof raw !== 'string' || !/^[a-z][a-z0-9_]*$/.test(raw)) {
      return err(
        new InvalidAccountKindError('account kind must be snake_case starting with a letter'),
      );
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidAccountKindError(`account kind must be <= ${MAX_LEN} characters`));
    }
    return ok(new AccountKind(raw));
  }

  /** The capacity account kind the backfill provisions. */
  static readonly CAPACITY: AccountKind = new AccountKind('capacity');

  equals(other: AccountKind): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
