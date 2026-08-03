/**
 * AttemptCount — non-negative integer tracking settlement retry attempts.
 * Immutable; increment() returns a new AttemptCount.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export class InvalidAttemptCountError {
  readonly tag = 'InvalidAttemptCountError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidAttemptCountError: ${this.reason}`;
  }
}

export class AttemptCount {
  private constructor(readonly value: number) {
    Object.freeze(this);
  }

  static of(n: number): Result<AttemptCount, InvalidAttemptCountError> {
    if (!Number.isInteger(n) || n < 0) {
      return err(new InvalidAttemptCountError('must be a non-negative integer'));
    }
    return ok(new AttemptCount(n));
  }

  static zero(): AttemptCount {
    return new AttemptCount(0);
  }

  increment(): AttemptCount {
    return new AttemptCount(this.value + 1);
  }

  toString(): string {
    return String(this.value);
  }
}
