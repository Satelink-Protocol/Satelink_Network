/**
 * ValidityWindow — an inclusive [validAfter, validBefore] window in epoch
 * MILLISECONDS. Used both for the authorization overall and per nonce.
 *
 * Timestamps are integer milliseconds (not money — no bigint needed, but must be
 * integers). The domain never reads a clock; the clock is passed to contains().
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export class InvalidValidityWindowError {
  readonly tag = 'InvalidValidityWindowError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidValidityWindowError: ${this.reason}`;
  }
}

export class ValidityWindow {
  private constructor(
    readonly validAfter: number,
    readonly validBefore: number,
  ) {
    Object.freeze(this);
  }

  static of(validAfter: number, validBefore: number): Result<ValidityWindow, InvalidValidityWindowError> {
    if (!Number.isInteger(validAfter) || !Number.isInteger(validBefore)) {
      return err(new InvalidValidityWindowError('validAfter/validBefore must be integer ms'));
    }
    if (validAfter < 0 || validBefore < 0) {
      return err(new InvalidValidityWindowError('validAfter/validBefore must be >= 0'));
    }
    if (validAfter > validBefore) {
      return err(new InvalidValidityWindowError('validAfter must be <= validBefore'));
    }
    return ok(new ValidityWindow(validAfter, validBefore));
  }

  /** Inclusive on both ends. */
  contains(clockMs: number): boolean {
    return clockMs >= this.validAfter && clockMs <= this.validBefore;
  }

  equals(other: ValidityWindow): boolean {
    return this.validAfter === other.validAfter && this.validBefore === other.validBefore;
  }
}
