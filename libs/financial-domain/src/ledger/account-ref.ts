/**
 * AccountRef — a reference to an Account by id. Opaque, non-empty string.
 *
 * The ledger references accounts by id only (invariant #7). It never imports the
 * Account aggregate; that would couple the ledger to another aggregate root.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 200;

export class InvalidAccountRefError {
  readonly tag = 'InvalidAccountRefError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidAccountRefError: ${this.reason}`;
  }
}

export class AccountRef {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<AccountRef, InvalidAccountRefError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidAccountRefError('account ref must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidAccountRefError(`account ref must be <= ${MAX_LEN} characters`));
    }
    return ok(new AccountRef(raw));
  }

  equals(other: AccountRef): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
