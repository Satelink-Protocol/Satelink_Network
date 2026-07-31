/**
 * Currency — closed registry of supported currencies.
 *
 * Each currency is a frozen singleton with a code, decimal places, and a
 * precomputed minor-unit multiplier. The registry is deliberately closed:
 * unknown currencies fail explicitly via Result, never silently.
 *
 * Equality is on code AND decimals — this protects against hypothetical future
 * token migrations where the same ticker could have different decimal places.
 *
 * The generic parameter `Code` brands each singleton at the type level so that
 * `Money<typeof USDC>` and `Money<typeof USDT>` are distinct TypeScript types.
 * Cross-currency operations become compile errors when the currencies are
 * statically known.
 */

import type { Result } from './result.js';
import { ok, err } from './result.js';

// ---------------------------------------------------------------------------
// Currency type — branded by code string literal
// ---------------------------------------------------------------------------

export class Currency<Code extends string = string> {
  /** The ISO or ticker code (e.g. 'USDC'). */
  readonly code: Code;
  /** Number of decimal places in the minor unit (e.g. 6 for USDC). */
  readonly decimals: number;
  /** 10n ** decimals — precomputed for conversion efficiency. */
  readonly minorMultiplier: bigint;

  private constructor(code: Code, decimals: number) {
    this.code = code;
    this.decimals = decimals;
    this.minorMultiplier = 10n ** BigInt(decimals);
    Object.freeze(this);
  }

  /** Equality on code AND decimals. */
  equals(other: Currency): boolean {
    return this.code === (other.code as string) && this.decimals === other.decimals;
  }

  toString(): string {
    return `${this.code}/${this.decimals}`;
  }

  // -------------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------------

  static readonly USDC: Currency<'USDC'> = new Currency('USDC', 6);
  static readonly USDT: Currency<'USDT'> = new Currency('USDT', 6);
  static readonly ETH: Currency<'ETH'> = new Currency('ETH', 18);
  static readonly POL: Currency<'POL'> = new Currency('POL', 18);

  /** All registered currencies, frozen. */
  static readonly ALL: readonly Currency[] = Object.freeze([
    Currency.USDC,
    Currency.USDT,
    Currency.ETH,
    Currency.POL,
  ]);

  private static readonly BY_CODE: ReadonlyMap<string, Currency> = new Map(
    Currency.ALL.map((c) => [c.code, c]),
  );

  /**
   * Look up a currency by code.
   *
   * Returns Err for unknown codes — construction of arbitrary currencies is
   * not supported.
   *
   * The return type is `Currency` (unbranded) because the code is a runtime
   * string. Use the static constants (USDC, USDT, etc.) for compile-time safety.
   */
  static of(code: string): Result<Currency, UnknownCurrencyError> {
    const found = Currency.BY_CODE.get(code);
    if (found !== undefined) {
      return ok(found);
    }
    return err(new UnknownCurrencyError(code));
  }
}

// -------------------------------------------------------------------------
// Errors
// -------------------------------------------------------------------------

export class UnknownCurrencyError {
  readonly tag = 'UnknownCurrencyError' as const;
  constructor(readonly code: string) {}

  toString(): string {
    return `UnknownCurrencyError: "${this.code}" is not a supported currency`;
  }
}

// -------------------------------------------------------------------------
// Convenience re-exports (avoid verbose Currency.USDC everywhere)
// -------------------------------------------------------------------------

export const USDC = Currency.USDC;
export const USDT = Currency.USDT;
export const ETH = Currency.ETH;
export const POL = Currency.POL;
