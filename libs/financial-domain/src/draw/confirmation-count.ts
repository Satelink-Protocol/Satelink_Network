/**
 * ConfirmationCount — non-negative integer wrapping the number of on-chain
 * confirmations observed. Used by Settlement.confirm() to check against
 * the funding source's requiredConfirmations (Decision A).
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export class InvalidConfirmationCountError {
  readonly tag = 'InvalidConfirmationCountError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidConfirmationCountError: ${this.reason}`;
  }
}

export class ConfirmationCount {
  private constructor(readonly value: number) {
    Object.freeze(this);
  }

  static of(n: number): Result<ConfirmationCount, InvalidConfirmationCountError> {
    if (!Number.isInteger(n) || n < 0) {
      return err(new InvalidConfirmationCountError('must be a non-negative integer'));
    }
    return ok(new ConfirmationCount(n));
  }

  static zero(): ConfirmationCount {
    return new ConfirmationCount(0);
  }

  gte(other: ConfirmationCount): boolean {
    return this.value >= other.value;
  }

  toString(): string {
    return String(this.value);
  }
}
