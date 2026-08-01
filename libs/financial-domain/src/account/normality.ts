/**
 * Normality — the natural balance direction of an account: debit-normal
 * (assets/expenses) or credit-normal (liabilities/revenue/equity). Matches the
 * CHECK constraint on accounts.normality (002).
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type NormalityValue = 'debit' | 'credit';

export class InvalidNormalityError {
  readonly tag = 'InvalidNormalityError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidNormalityError: "${this.value}" is not a valid normality`;
  }
}

export class Normality {
  private constructor(readonly value: NormalityValue) {
    Object.freeze(this);
  }

  static readonly DEBIT: Normality = new Normality('debit');
  static readonly CREDIT: Normality = new Normality('credit');

  static of(raw: string): Result<Normality, InvalidNormalityError> {
    if (raw === 'debit') return ok(Normality.DEBIT);
    if (raw === 'credit') return ok(Normality.CREDIT);
    return err(new InvalidNormalityError(raw));
  }

  equals(other: Normality): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
