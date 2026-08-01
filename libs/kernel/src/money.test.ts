import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { Money, CurrencyMismatchError, InvalidMoneyFormatError, InvalidAllocateRatiosError } from './money.js';
import { Currency, USDC, USDT, ETH, POL } from './currency.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Arbitrary bigint in a reasonable range for property tests. */
const arbMinorUnits = fc.bigInt({ min: -(10n ** 24n), max: 10n ** 24n });

/** Arbitrary currency. */
const arbCurrency = fc.constantFrom(USDC, USDT, ETH, POL);

/** Arbitrary Money for a given currency. */
function arbMoney<C extends Currency>(currency: C) {
  return arbMinorUnits.map((amount) => Money.fromMinorUnits(amount, currency));
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('Money', () => {
  describe('fromMinorUnits()', () => {
    it('creates Money with exact amount', () => {
      const m = Money.fromMinorUnits(10_500_000n, USDC);
      expect(m.amount).toBe(10_500_000n);
      expect(m.currency).toBe(USDC);
    });

    it('handles zero', () => {
      const m = Money.fromMinorUnits(0n, USDC);
      expect(m.amount).toBe(0n);
      expect(m.isZero()).toBe(true);
    });

    it('handles negative', () => {
      const m = Money.fromMinorUnits(-100n, USDC);
      expect(m.amount).toBe(-100n);
      expect(m.isNegative()).toBe(true);
    });

    it('handles maximum bigint', () => {
      const huge = 2n ** 256n;
      const m = Money.fromMinorUnits(huge, ETH);
      expect(m.amount).toBe(huge);
    });

    it('produces a frozen instance', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      expect(Object.isFrozen(m)).toBe(true);
    });
  });

  describe('fromDecimalString()', () => {
    it('parses "10.50" for USDC (6 decimals)', () => {
      const r = Money.fromDecimalString('10.50', USDC);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(10_500_000n);
      }
    });

    it('parses "0" for USDC', () => {
      const r = Money.fromDecimalString('0', USDC);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(0n);
      }
    });

    it('parses "0.000001" for USDC (smallest unit)', () => {
      const r = Money.fromDecimalString('0.000001', USDC);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(1n);
      }
    });

    it('parses "-3.14" for USDC', () => {
      const r = Money.fromDecimalString('-3.14', USDC);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(-3_140_000n);
      }
    });

    it('parses integer without decimal point', () => {
      const r = Money.fromDecimalString('100', USDC);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(100_000_000n);
      }
    });

    it('parses "1.0" for ETH (18 decimals)', () => {
      const r = Money.fromDecimalString('1.0', ETH);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(10n ** 18n);
      }
    });

    it('parses with partial decimal places (less than max)', () => {
      const r = Money.fromDecimalString('1.5', USDC);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(1_500_000n);
      }
    });

    it('trims whitespace', () => {
      const r = Money.fromDecimalString('  10.50  ', USDC);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(10_500_000n);
      }
    });

    // Edge cases — failures
    it('rejects too many decimal places', () => {
      const r = Money.fromDecimalString('10.1234567', USDC);
      expect(r.isErr).toBe(true);
      if (r.isErr) {
        expect(r.error).toBeInstanceOf(InvalidMoneyFormatError);
        expect(r.error.reason).toContain('too many decimal places');
      }
    });

    it('rejects leading zeros (e.g. "01.5")', () => {
      const r = Money.fromDecimalString('01.5', USDC);
      expect(r.isErr).toBe(true);
    });

    it('rejects empty string', () => {
      const r = Money.fromDecimalString('', USDC);
      expect(r.isErr).toBe(true);
    });

    it('rejects non-numeric', () => {
      const r = Money.fromDecimalString('abc', USDC);
      expect(r.isErr).toBe(true);
    });

    it('rejects trailing dot', () => {
      const r = Money.fromDecimalString('10.', USDC);
      expect(r.isErr).toBe(true);
    });

    it('rejects leading dot', () => {
      const r = Money.fromDecimalString('.5', USDC);
      expect(r.isErr).toBe(true);
    });

    it('rejects multiple dots', () => {
      const r = Money.fromDecimalString('1.2.3', USDC);
      expect(r.isErr).toBe(true);
    });

    it('rejects spaces in the middle', () => {
      const r = Money.fromDecimalString('10 50', USDC);
      expect(r.isErr).toBe(true);
    });

    it('rejects number type at runtime', () => {
      // Deliberately bypass TypeScript to test runtime guard
      const r = Money.fromDecimalString(10.5 as unknown as string, USDC);
      expect(r.isErr).toBe(true);
      if (r.isErr) {
        expect(r.error.reason).toContain('string, not a number');
      }
    });
  });

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  describe('toDecimalString()', () => {
    it('formats 10500000 minor units as "10.500000" for USDC', () => {
      const m = Money.fromMinorUnits(10_500_000n, USDC);
      expect(m.toDecimalString()).toBe('10.500000');
    });

    it('formats zero', () => {
      const m = Money.fromMinorUnits(0n, USDC);
      expect(m.toDecimalString()).toBe('0.000000');
    });

    it('formats negative', () => {
      const m = Money.fromMinorUnits(-3_140_000n, USDC);
      expect(m.toDecimalString()).toBe('-3.140000');
    });

    it('formats 1 minor unit of USDC', () => {
      const m = Money.fromMinorUnits(1n, USDC);
      expect(m.toDecimalString()).toBe('0.000001');
    });

    it('formats 1 ETH (18 decimals)', () => {
      const m = Money.fromMinorUnits(10n ** 18n, ETH);
      expect(m.toDecimalString()).toBe('1.000000000000000000');
    });

    it('formats sub-unit ETH', () => {
      const m = Money.fromMinorUnits(1n, ETH);
      expect(m.toDecimalString()).toBe('0.000000000000000001');
    });
  });

  describe('toString()', () => {
    it('includes amount and currency code', () => {
      const m = Money.fromMinorUnits(10_500_000n, USDC);
      expect(m.toString()).toBe('10.500000 USDC');
    });
  });

  // -------------------------------------------------------------------------
  // Arithmetic
  // -------------------------------------------------------------------------

  describe('add()', () => {
    it('adds two USDC amounts', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(200n, USDC);
      const r = a.add(b);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(300n);
      }
    });

    it('rejects cross-currency (USDC + USDT)', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(200n, USDT) as unknown as Money<typeof USDC>;
      const r = a.add(b);
      expect(r.isErr).toBe(true);
      if (r.isErr) {
        expect(r.error).toBeInstanceOf(CurrencyMismatchError);
        expect(r.error.tag).toBe('CurrencyMismatchError');
      }
    });
  });

  describe('subtract()', () => {
    it('subtracts two USDC amounts', () => {
      const a = Money.fromMinorUnits(300n, USDC);
      const b = Money.fromMinorUnits(100n, USDC);
      const r = a.subtract(b);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(200n);
      }
    });

    it('produces negative result', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(300n, USDC);
      const r = a.subtract(b);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value.amount).toBe(-200n);
      }
    });

    it('rejects cross-currency', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(100n, ETH) as unknown as Money<typeof USDC>;
      const r = a.subtract(b);
      expect(r.isErr).toBe(true);
    });
  });

  describe('multiplyByInteger()', () => {
    it('multiplies by positive integer', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.multiplyByInteger(3n);
      expect(r.amount).toBe(300n);
      expect(r.currency).toBe(USDC);
    });

    it('multiplies by zero', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.multiplyByInteger(0n);
      expect(r.amount).toBe(0n);
    });

    it('multiplies by negative', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.multiplyByInteger(-2n);
      expect(r.amount).toBe(-200n);
    });
  });

  describe('negate()', () => {
    it('negates positive', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      expect(m.negate().amount).toBe(-100n);
    });

    it('negates negative', () => {
      const m = Money.fromMinorUnits(-100n, USDC);
      expect(m.negate().amount).toBe(100n);
    });

    it('negates zero', () => {
      const m = Money.fromMinorUnits(0n, USDC);
      expect(m.negate().amount).toBe(0n);
    });
  });

  describe('absolute()', () => {
    it('returns same for positive', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      expect(m.absolute().amount).toBe(100n);
    });

    it('returns positive for negative', () => {
      const m = Money.fromMinorUnits(-100n, USDC);
      expect(m.absolute().amount).toBe(100n);
    });

    it('returns zero for zero', () => {
      const m = Money.fromMinorUnits(0n, USDC);
      expect(m.absolute().amount).toBe(0n);
    });
  });

  // -------------------------------------------------------------------------
  // Comparisons
  // -------------------------------------------------------------------------

  describe('equals()', () => {
    it('equal amounts and currency', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(100n, USDC);
      expect(a.equals(b)).toBe(true);
    });

    it('different amounts', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(200n, USDC);
      expect(a.equals(b)).toBe(false);
    });

    it('different currency', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(100n, USDT) as unknown as Money<typeof USDC>;
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('lessThan()', () => {
    it('100 < 200', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(200n, USDC);
      const r = a.lessThan(b);
      expect(r.isOk && r.value).toBe(true);
    });

    it('200 not < 100', () => {
      const a = Money.fromMinorUnits(200n, USDC);
      const b = Money.fromMinorUnits(100n, USDC);
      const r = a.lessThan(b);
      expect(r.isOk && r.value).toBe(false);
    });

    it('rejects cross-currency', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(200n, ETH) as unknown as Money<typeof USDC>;
      expect(a.lessThan(b).isErr).toBe(true);
    });
  });

  describe('greaterThan()', () => {
    it('200 > 100', () => {
      const a = Money.fromMinorUnits(200n, USDC);
      const b = Money.fromMinorUnits(100n, USDC);
      const r = a.greaterThan(b);
      expect(r.isOk && r.value).toBe(true);
    });

    it('rejects cross-currency', () => {
      const a = Money.fromMinorUnits(200n, USDC);
      const b = Money.fromMinorUnits(100n, USDT) as unknown as Money<typeof USDC>;
      expect(a.greaterThan(b).isErr).toBe(true);
    });
  });

  describe('lessThanOrEqual()', () => {
    it('100 <= 100', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(100n, USDC);
      const r = a.lessThanOrEqual(b);
      expect(r.isOk && r.value).toBe(true);
    });

    it('100 <= 200', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(200n, USDC);
      expect(a.lessThanOrEqual(b).isOk && a.lessThanOrEqual(b).unwrapOr(false)).toBe(true);
    });

    it('rejects cross-currency', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(100n, POL) as unknown as Money<typeof USDC>;
      expect(a.lessThanOrEqual(b).isErr).toBe(true);
    });
  });

  describe('greaterThanOrEqual()', () => {
    it('200 >= 100', () => {
      const a = Money.fromMinorUnits(200n, USDC);
      const b = Money.fromMinorUnits(100n, USDC);
      const r = a.greaterThanOrEqual(b);
      expect(r.isOk && r.value).toBe(true);
    });

    it('100 >= 100', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(100n, USDC);
      const r = a.greaterThanOrEqual(b);
      expect(r.isOk && r.value).toBe(true);
    });

    it('rejects cross-currency', () => {
      const a = Money.fromMinorUnits(100n, USDC);
      const b = Money.fromMinorUnits(100n, ETH) as unknown as Money<typeof USDC>;
      expect(a.greaterThanOrEqual(b).isErr).toBe(true);
    });
  });

  describe('isZero() / isPositive() / isNegative()', () => {
    it('zero', () => {
      const m = Money.fromMinorUnits(0n, USDC);
      expect(m.isZero()).toBe(true);
      expect(m.isPositive()).toBe(false);
      expect(m.isNegative()).toBe(false);
    });

    it('positive', () => {
      const m = Money.fromMinorUnits(1n, USDC);
      expect(m.isZero()).toBe(false);
      expect(m.isPositive()).toBe(true);
      expect(m.isNegative()).toBe(false);
    });

    it('negative', () => {
      const m = Money.fromMinorUnits(-1n, USDC);
      expect(m.isZero()).toBe(false);
      expect(m.isPositive()).toBe(false);
      expect(m.isNegative()).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Allocate
  // -------------------------------------------------------------------------

  describe('allocate()', () => {
    it('splits evenly with no remainder', () => {
      const m = Money.fromMinorUnits(300n, USDC);
      const r = m.allocate([1, 1, 1]);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value).toHaveLength(3);
        expect(r.value[0]!.amount).toBe(100n);
        expect(r.value[1]!.amount).toBe(100n);
        expect(r.value[2]!.amount).toBe(100n);
      }
    });

    it('assigns residual to first part when not evenly divisible', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.allocate([1, 1, 1]);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        const sum = r.value.reduce((s, p) => s + p.amount, 0n);
        expect(sum).toBe(100n);
        // First part gets the extra
        expect(r.value[0]!.amount).toBe(34n);
        expect(r.value[1]!.amount).toBe(33n);
        expect(r.value[2]!.amount).toBe(33n);
      }
    });

    it('works with weighted ratios', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.allocate([70, 20, 10]);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        const sum = r.value.reduce((s, p) => s + p.amount, 0n);
        expect(sum).toBe(100n);
      }
    });

    it('works with a single ratio', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.allocate([1]);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value[0]!.amount).toBe(100n);
      }
    });

    it('handles zero amount', () => {
      const m = Money.fromMinorUnits(0n, USDC);
      const r = m.allocate([1, 1]);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        expect(r.value[0]!.amount).toBe(0n);
        expect(r.value[1]!.amount).toBe(0n);
      }
    });

    it('handles negative amount', () => {
      const m = Money.fromMinorUnits(-100n, USDC);
      const r = m.allocate([1, 1, 1]);
      expect(r.isOk).toBe(true);
      if (r.isOk) {
        const sum = r.value.reduce((s, p) => s + p.amount, 0n);
        expect(sum).toBe(-100n);
      }
    });

    it('rejects empty ratios', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.allocate([]);
      expect(r.isErr).toBe(true);
      if (r.isErr) {
        expect(r.error).toBeInstanceOf(InvalidAllocateRatiosError);
      }
    });

    it('rejects all-zero ratios', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.allocate([0, 0, 0]);
      expect(r.isErr).toBe(true);
    });

    it('rejects negative ratios', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.allocate([1, -1]);
      expect(r.isErr).toBe(true);
    });

    it('rejects NaN ratio', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.allocate([NaN]);
      expect(r.isErr).toBe(true);
    });

    it('rejects Infinity ratio', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.allocate([Infinity]);
      expect(r.isErr).toBe(true);
    });

    it('returns frozen array', () => {
      const m = Money.fromMinorUnits(100n, USDC);
      const r = m.allocate([1, 1]);
      if (r.isOk) {
        expect(Object.isFrozen(r.value)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error types
  // -------------------------------------------------------------------------

  describe('error types', () => {
    it('CurrencyMismatchError has descriptive toString', () => {
      const e = new CurrencyMismatchError(USDC, USDT);
      expect(e.toString()).toContain('USDC');
      expect(e.toString()).toContain('USDT');
    });

    it('InvalidMoneyFormatError has descriptive toString', () => {
      const e = new InvalidMoneyFormatError('abc', 'bad format');
      expect(e.toString()).toContain('abc');
      expect(e.toString()).toContain('bad format');
    });

    it('InvalidAllocateRatiosError has descriptive toString', () => {
      const e = new InvalidAllocateRatiosError('empty');
      expect(e.toString()).toContain('empty');
    });
  });

  // -------------------------------------------------------------------------
  // Property-based tests (fast-check)
  // -------------------------------------------------------------------------

  describe('property tests', () => {
    const NUM_RUNS = 10_000;

    it('addition is associative', () => {
      fc.assert(
        fc.property(arbMoney(USDC), arbMoney(USDC), arbMoney(USDC), (a, b, c) => {
          // (a + b) + c === a + (b + c)
          const ab = a.add(b);
          const bc = b.add(c);
          if (ab.isOk && bc.isOk) {
            const lhs = ab.value.add(c);
            const rhs = a.add(bc.value);
            if (lhs.isOk && rhs.isOk) {
              return lhs.value.amount === rhs.value.amount;
            }
          }
          return false;
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('addition is commutative', () => {
      fc.assert(
        fc.property(arbMoney(USDC), arbMoney(USDC), (a, b) => {
          const ab = a.add(b);
          const ba = b.add(a);
          if (ab.isOk && ba.isOk) {
            return ab.value.amount === ba.value.amount;
          }
          return false;
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('zero is additive identity', () => {
      fc.assert(
        fc.property(arbMoney(USDC), (a) => {
          const zero = Money.fromMinorUnits(0n, USDC);
          const r = a.add(zero);
          if (r.isOk) {
            return r.value.amount === a.amount;
          }
          return false;
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('(a + b) - b === a', () => {
      fc.assert(
        fc.property(arbMoney(USDC), arbMoney(USDC), (a, b) => {
          const sum = a.add(b);
          if (sum.isOk) {
            const diff = sum.value.subtract(b);
            if (diff.isOk) {
              return diff.value.amount === a.amount;
            }
          }
          return false;
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('parse(format(m)) === m — no precision loss', () => {
      fc.assert(
        fc.property(arbMinorUnits, arbCurrency, (amount, currency) => {
          const m = Money.fromMinorUnits(amount, currency);
          const formatted = m.toDecimalString();
          const parsed = Money.fromDecimalString(formatted, currency);
          if (parsed.isOk) {
            return parsed.value.amount === m.amount;
          }
          return false;
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('allocate: sum(parts) === original EXACTLY', () => {
      const arbRatios = fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 10 });
      fc.assert(
        fc.property(arbMinorUnits, arbCurrency, arbRatios, (amount, currency, ratios) => {
          const m = Money.fromMinorUnits(amount, currency);
          const result = m.allocate(ratios);
          if (result.isOk) {
            const sum = result.value.reduce((s, p) => s + p.amount, 0n);
            return sum === m.amount;
          }
          return false;
        }),
        { numRuns: NUM_RUNS },
      );
    });

    it('negate(negate(a)) === a', () => {
      fc.assert(
        fc.property(arbMoney(USDC), (a) => {
          return a.negate().negate().amount === a.amount;
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Type-level tests
  // -------------------------------------------------------------------------

  describe('type-level safety', () => {
    it('cross-currency add is a compile error', () => {
      const _usdc = Money.fromMinorUnits(100n, USDC);
      const _usdt = Money.fromMinorUnits(100n, USDT);

      // This MUST fail to compile. If it ever starts compiling,
      // the @ts-expect-error directive becomes unnecessary and
      // TypeScript will error on the directive itself, failing the build.
      // @ts-expect-error — cross-currency add must not compile
      _usdc.add(_usdt);
    });

    it('cross-currency subtract is a compile error', () => {
      const _usdc = Money.fromMinorUnits(100n, USDC);
      const _eth = Money.fromMinorUnits(100n, ETH);

      // @ts-expect-error — cross-currency subtract must not compile
      _usdc.subtract(_eth);
    });
  });
});
