/**
 * Money — immutable value object for financial amounts.
 *
 * Invariants (from CLAUDE.md):
 *   #2  Money is bigint in integer minor units. NEVER a float. NEVER a JS number.
 *   #8  Draws are never partially applied (relevant to allocate — no drift).
 *
 * All amounts are stored as bigint in the currency's minor unit. A Money
 * object is branded on its Currency so that cross-currency operations are
 * caught at compile time where statically knowable, and via explicit Result
 * failure at runtime.
 */

import type { Result } from './result.js';
import { ok, err } from './result.js';
import { Currency } from './currency.js';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class CurrencyMismatchError {
  readonly tag = 'CurrencyMismatchError' as const;
  constructor(
    readonly left: Currency,
    readonly right: Currency,
  ) {}

  toString(): string {
    return `CurrencyMismatchError: cannot combine ${this.left.code} with ${this.right.code}`;
  }
}

export class InvalidMoneyFormatError {
  readonly tag = 'InvalidMoneyFormatError' as const;
  constructor(
    readonly input: string,
    readonly reason: string,
  ) {}

  toString(): string {
    return `InvalidMoneyFormatError: "${this.input}" — ${this.reason}`;
  }
}

export class InvalidAllocateRatiosError {
  readonly tag = 'InvalidAllocateRatiosError' as const;
  constructor(readonly reason: string) {}

  toString(): string {
    return `InvalidAllocateRatiosError: ${this.reason}`;
  }
}

// ---------------------------------------------------------------------------
// Decimal string validation regex
// ---------------------------------------------------------------------------

/**
 * Matches a valid decimal string: optional leading minus, digits, optional
 * decimal point followed by digits. No leading zeros (except "0" itself or
 * "0.xxx"), no trailing dot, no empty string.
 */
const DECIMAL_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export class Money<C extends Currency = Currency> {
  /** Amount in minor units (e.g. cents for USDC). Always a bigint. */
  readonly amount: bigint;
  /** The currency this money is denominated in. */
  readonly currency: C;

  private constructor(amount: bigint, currency: C) {
    this.amount = amount;
    this.currency = currency;
    Object.freeze(this);
  }

  // -----------------------------------------------------------------------
  // Constructors
  // -----------------------------------------------------------------------

  /** Create Money from an exact bigint of minor units. */
  static fromMinorUnits<C extends Currency>(amount: bigint, currency: C): Money<C> {
    return new Money(amount, currency);
  }

  /**
   * Parse a decimal string into Money.
   *
   * Accepts strings like "10.50", "-3.14", "0", "0.000001".
   * Rejects JS numbers at the type level. Validates format and decimal places.
   */
  static fromDecimalString<C extends Currency>(
    input: string,
    currency: C,
  ): Result<Money<C>, InvalidMoneyFormatError> {
    if (typeof input !== 'string') {
      return err(new InvalidMoneyFormatError(String(input), 'input must be a string, not a number'));
    }

    const trimmed = input.trim();
    if (!DECIMAL_RE.test(trimmed)) {
      return err(new InvalidMoneyFormatError(input, 'invalid decimal format'));
    }

    const isNegative = trimmed.startsWith('-');
    const abs = isNegative ? trimmed.slice(1) : trimmed;
    const dotIndex = abs.indexOf('.');

    let integerPart: string;
    let fractionalPart: string;

    if (dotIndex === -1) {
      integerPart = abs;
      fractionalPart = '';
    } else {
      integerPart = abs.slice(0, dotIndex);
      fractionalPart = abs.slice(dotIndex + 1);
    }

    if (fractionalPart.length > currency.decimals) {
      return err(
        new InvalidMoneyFormatError(
          input,
          `too many decimal places: got ${fractionalPart.length}, max ${currency.decimals}`,
        ),
      );
    }

    // Pad fractional part to full minor unit width
    const paddedFraction = fractionalPart.padEnd(currency.decimals, '0');
    const minorStr = integerPart + paddedFraction;
    let amount = BigInt(minorStr);

    if (isNegative) {
      amount = -amount;
    }

    return ok(new Money(amount, currency));
  }

  // -----------------------------------------------------------------------
  // Formatting
  // -----------------------------------------------------------------------

  /**
   * Format as a decimal string with exact precision.
   *
   * Always includes the full number of decimal places for the currency.
   * Round-trip invariant: fromDecimalString(m.toDecimalString(), c) === m
   */
  toDecimalString(): string {
    const decimals = this.currency.decimals;
    const isNegative = this.amount < 0n;
    const abs = isNegative ? -this.amount : this.amount;
    const absStr = abs.toString().padStart(decimals + 1, '0');

    const integerPart = absStr.slice(0, absStr.length - decimals);
    const fractionalPart = absStr.slice(absStr.length - decimals);

    const formatted = `${integerPart}.${fractionalPart}`;

    return isNegative ? `-${formatted}` : formatted;
  }

  // -----------------------------------------------------------------------
  // Arithmetic — same currency enforced by generics
  // -----------------------------------------------------------------------

  /**
   * Add two Money values. Cross-currency is a compile error when types are
   * known, and a runtime Result failure when dynamic.
   */
  add(other: Money<C>): Result<Money<C>, CurrencyMismatchError> {
    if (!this.currency.equals(other.currency)) {
      return err(new CurrencyMismatchError(this.currency, other.currency));
    }
    return ok(new Money(this.amount + other.amount, this.currency));
  }

  /** Subtract another Money value. */
  subtract(other: Money<C>): Result<Money<C>, CurrencyMismatchError> {
    if (!this.currency.equals(other.currency)) {
      return err(new CurrencyMismatchError(this.currency, other.currency));
    }
    return ok(new Money(this.amount - other.amount, this.currency));
  }

  /** Multiply by an integer scalar. */
  multiplyByInteger(n: bigint): Money<C> {
    return new Money(this.amount * n, this.currency);
  }

  /** Negate: -amount. */
  negate(): Money<C> {
    return new Money(-this.amount, this.currency);
  }

  /** Absolute value. */
  absolute(): Money<C> {
    return new Money(this.amount < 0n ? -this.amount : this.amount, this.currency);
  }

  // -----------------------------------------------------------------------
  // Comparisons
  // -----------------------------------------------------------------------

  /** Equality: same amount AND same currency. */
  equals(other: Money<C>): boolean {
    return this.amount === other.amount && this.currency.equals(other.currency);
  }

  lessThan(other: Money<C>): Result<boolean, CurrencyMismatchError> {
    if (!this.currency.equals(other.currency)) {
      return err(new CurrencyMismatchError(this.currency, other.currency));
    }
    return ok(this.amount < other.amount);
  }

  greaterThan(other: Money<C>): Result<boolean, CurrencyMismatchError> {
    if (!this.currency.equals(other.currency)) {
      return err(new CurrencyMismatchError(this.currency, other.currency));
    }
    return ok(this.amount > other.amount);
  }

  lessThanOrEqual(other: Money<C>): Result<boolean, CurrencyMismatchError> {
    if (!this.currency.equals(other.currency)) {
      return err(new CurrencyMismatchError(this.currency, other.currency));
    }
    return ok(this.amount <= other.amount);
  }

  greaterThanOrEqual(other: Money<C>): Result<boolean, CurrencyMismatchError> {
    if (!this.currency.equals(other.currency)) {
      return err(new CurrencyMismatchError(this.currency, other.currency));
    }
    return ok(this.amount >= other.amount);
  }

  isZero(): boolean {
    return this.amount === 0n;
  }

  isPositive(): boolean {
    return this.amount > 0n;
  }

  isNegative(): boolean {
    return this.amount < 0n;
  }

  // -----------------------------------------------------------------------
  // Allocation — residual pattern
  // -----------------------------------------------------------------------

  /**
   * Split this amount across `ratios` with NO rounding drift.
   *
   * The residual pattern: each part gets `floor(amount * ratio / totalRatio)`,
   * then the remainder `original - sum(parts)` is added to parts[0].
   *
   * INVARIANT: sum(result) === this.amount EXACTLY, for any ratios and amount.
   * This is what the frozen SplitRule design depends on.
   */
  allocate(
    ratios: readonly number[],
  ): Result<readonly Money<C>[], InvalidAllocateRatiosError> {
    if (ratios.length === 0) {
      return err(new InvalidAllocateRatiosError('ratios must not be empty'));
    }

    for (let i = 0; i < ratios.length; i++) {
      const r = ratios[i]!;
      if (!Number.isFinite(r) || r < 0) {
        return err(
          new InvalidAllocateRatiosError(
            `ratio at index ${i} must be a non-negative finite number, got ${r}`,
          ),
        );
      }
    }

    const total = ratios.reduce((sum, r) => sum + r, 0);
    if (total === 0) {
      return err(new InvalidAllocateRatiosError('sum of ratios must be greater than zero'));
    }

    // Scale ratios to bigint for integer arithmetic.
    // Multiply by a large factor to preserve ratio precision.
    const SCALE = 10n ** 18n;
    const totalBig = BigInt(Math.round(total * Number(SCALE)));

    const isNegative = this.amount < 0n;
    const absAmount = isNegative ? -this.amount : this.amount;

    const scaledRatios = ratios.map((r) => BigInt(Math.round(r * Number(SCALE))));
    const parts: Money<C>[] = scaledRatios.map((sr) => {
      const partAbs = (absAmount * sr) / totalBig;
      const partAmount = isNegative ? -partAbs : partAbs;
      return new Money(partAmount, this.currency);
    });

    // Compute residual and assign to first part
    let partsSum = 0n;
    for (const p of parts) {
      partsSum += p.amount;
    }
    const residual = this.amount - partsSum;
    if (residual !== 0n) {
      parts[0] = new Money(parts[0]!.amount + residual, this.currency);
    }

    return ok(Object.freeze(parts));
  }

  // -----------------------------------------------------------------------
  // Debug
  // -----------------------------------------------------------------------

  toString(): string {
    return `${this.toDecimalString()} ${this.currency.code}`;
  }
}
