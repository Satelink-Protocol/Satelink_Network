/**
 * FundingSourceId — identity of a FundingSource. Lives in shared/ because
 * Authorization references it by Id, and the no-aggregate-to-aggregate rule
 * forbids authorization/ importing funding-source/.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 200;

export class InvalidFundingSourceIdError {
  readonly tag = 'InvalidFundingSourceIdError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidFundingSourceIdError: ${this.reason}`;
  }
}

export class FundingSourceId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<FundingSourceId, InvalidFundingSourceIdError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidFundingSourceIdError('funding source id must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidFundingSourceIdError(`funding source id must be <= ${MAX_LEN} chars`));
    }
    return ok(new FundingSourceId(raw));
  }

  equals(other: FundingSourceId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
