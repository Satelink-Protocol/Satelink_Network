/**
 * ConsumedAmount — how much of an authorization's cap has been consumed. Wraps
 * Money; must be >= 0. Monotonic non-decreasing over the aggregate's life
 * (enforced by the Authorization aggregate, which only ever adds).
 */

import type { Money, Currency, Result } from '@satelink/kernel';
import { Money as MoneyVO, ok, err } from '@satelink/kernel';

export class InvalidConsumedAmountError {
  readonly tag = 'InvalidConsumedAmountError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `InvalidConsumedAmountError: ${this.reason}`;
  }
}

export class ConsumedAmount {
  private constructor(readonly money: Money) {
    Object.freeze(this);
  }

  static zero(currency: Currency): ConsumedAmount {
    return new ConsumedAmount(MoneyVO.fromMinorUnits(0n, currency));
  }

  static of(money: Money): Result<ConsumedAmount, InvalidConsumedAmountError> {
    if (money.isNegative()) {
      return err(new InvalidConsumedAmountError('consumed amount must be >= 0'));
    }
    return ok(new ConsumedAmount(money));
  }

  equals(other: ConsumedAmount): boolean {
    return this.money.equals(other.money);
  }

  toString(): string {
    return this.money.toString();
  }
}
