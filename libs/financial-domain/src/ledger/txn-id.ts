/**
 * TxnId — identity of a LedgerTransaction. A non-empty, bounded string.
 *
 * All entries of one balanced transaction share a TxnId; it is how the
 * repository groups rows back into an aggregate.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 200;

export class InvalidTxnIdError {
  readonly tag = 'InvalidTxnIdError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidTxnIdError: ${this.reason}`;
  }
}

export class TxnId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<TxnId, InvalidTxnIdError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidTxnIdError('txn id must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidTxnIdError(`txn id must be <= ${MAX_LEN} characters`));
    }
    return ok(new TxnId(raw));
  }

  equals(other: TxnId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
