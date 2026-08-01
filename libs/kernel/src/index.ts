/**
 * @satelink/kernel
 *
 * Pure shared value objects for the Satelink domain layer.
 *
 * INVARIANT: this package imports nothing external. Not another lib, not an npm
 * package, not a node builtin. It is the root of the dependency graph and
 * everything else depends on it. Enforced by the `kernel-imports-nothing`
 * rule in .dependency-cruiser.cjs.
 */

// ---------------------------------------------------------------------------
// Brand — typed identifier helper
// ---------------------------------------------------------------------------

/**
 * Branded identifier helper.
 *
 * Included in M0 because the dependency-cruiser rules reference identifier
 * flow between aggregates, and a compiling example makes the rules verifiable
 * rather than theoretical.
 *
 * @example
 *   type PrincipalId = Brand<string, 'PrincipalId'>;
 *   const id = 'prn_123' as PrincipalId;
 *   const wrong: PrincipalId = 'acc_456' as AccountId; // compile error
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

// ---------------------------------------------------------------------------
// M1 — Money value objects
// ---------------------------------------------------------------------------

export { ok, err } from './result.js';
export type { Ok, Err, Result } from './result.js';

export { Currency, UnknownCurrencyError, USDC, USDT, ETH, POL } from './currency.js';

export {
  Money,
  CurrencyMismatchError,
  InvalidMoneyFormatError,
  InvalidAllocateRatiosError,
} from './money.js';
