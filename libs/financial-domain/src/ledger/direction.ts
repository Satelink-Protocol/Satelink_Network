/**
 * Direction — a ledger entry is either a debit or a credit.
 *
 * Closed set of two frozen singletons. Construction from an arbitrary string
 * fails explicitly via Result.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type DirectionValue = 'debit' | 'credit';

export class InvalidDirectionError {
  readonly tag = 'InvalidDirectionError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidDirectionError: "${this.value}" is not a valid direction`;
  }
}

export class Direction {
  private constructor(readonly value: DirectionValue) {
    Object.freeze(this);
  }

  static readonly DEBIT: Direction = new Direction('debit');
  static readonly CREDIT: Direction = new Direction('credit');

  static of(raw: string): Result<Direction, InvalidDirectionError> {
    if (raw === 'debit') {
      return ok(Direction.DEBIT);
    }
    if (raw === 'credit') {
      return ok(Direction.CREDIT);
    }
    return err(new InvalidDirectionError(raw));
  }

  isDebit(): boolean {
    return this.value === 'debit';
  }

  isCredit(): boolean {
    return this.value === 'credit';
  }

  /** The opposite direction — used when building a reversal transaction. */
  opposite(): Direction {
    return this.value === 'debit' ? Direction.CREDIT : Direction.DEBIT;
  }

  equals(other: Direction): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
