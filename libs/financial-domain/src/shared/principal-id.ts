/**
 * PrincipalId — identity of a Principal. Non-empty, bounded string.
 *
 * Aggregates reference each other by Id only (invariant #7); this is the type
 * other aggregates hold instead of a Principal instance.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 200;

export class InvalidPrincipalIdError {
  readonly tag = 'InvalidPrincipalIdError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidPrincipalIdError: ${this.reason}`;
  }
}

export class PrincipalId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<PrincipalId, InvalidPrincipalIdError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidPrincipalIdError('principal id must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidPrincipalIdError(`principal id must be <= ${MAX_LEN} characters`));
    }
    return ok(new PrincipalId(raw));
  }

  equals(other: PrincipalId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
