/**
 * AccountId — identity of an Account. Non-empty, bounded string.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 200;

export class InvalidAccountIdError {
  readonly tag = 'InvalidAccountIdError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidAccountIdError: ${this.reason}`;
  }
}

export class AccountId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<AccountId, InvalidAccountIdError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidAccountIdError('account id must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidAccountIdError(`account id must be <= ${MAX_LEN} characters`));
    }
    return ok(new AccountId(raw));
  }

  equals(other: AccountId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
