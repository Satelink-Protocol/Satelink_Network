/**
 * DrawId — identity of a Draw. Non-empty, bounded string.
 *
 * Aggregates reference each other by Id only (invariant #7).
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

const MAX_LEN = 200;

export class InvalidDrawIdError {
  readonly tag = 'InvalidDrawIdError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidDrawIdError: ${this.reason}`;
  }
}

export class DrawId {
  private constructor(readonly value: string) {
    Object.freeze(this);
  }

  static of(raw: string): Result<DrawId, InvalidDrawIdError> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return err(new InvalidDrawIdError('draw id must be a non-empty string'));
    }
    if (raw.length > MAX_LEN) {
      return err(new InvalidDrawIdError(`draw id must be <= ${MAX_LEN} characters`));
    }
    return ok(new DrawId(raw));
  }

  equals(other: DrawId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
