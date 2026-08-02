/**
 * Cap — the maximum total an authorization may ever consume. Wraps Money
 * (bigint minor units; no floats). Must be strictly positive.
 */

import type { Money, Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export class InvalidCapError {
  readonly tag = 'InvalidCapError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidCapError: ${this.reason}`;
  }
}

export class Cap {
  private constructor(readonly money: Money) {
    Object.freeze(this);
  }

  static of(money: Money): Result<Cap, InvalidCapError> {
    if (!money.isPositive()) {
      return err(new InvalidCapError('cap must be > 0'));
    }
    return ok(new Cap(money));
  }

  equals(other: Cap): boolean {
    return this.money.equals(other.money);
  }

  toString(): string {
    return this.money.toString();
  }
}
