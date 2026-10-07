// Fixed-point decimal arithmetic for the strategy evaluator (Stage 13).
//
// Values are bigint units at a fixed SCALE of 18 decimal places. No JS floats:
// inputs are canonical decimal strings, every division rounds half-even, so the
// same inputs give bit-identical results on every machine and every run.
import { StrategyError } from './errors.mjs';

export const SCALE = 18;
export const ONE = 10n ** BigInt(SCALE);
const DECIMAL_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** Decimal string → fixed-point bigint. Rejects numbers, exponents and > SCALE fractional digits. */
export function fx(value) {
  if (typeof value !== 'string' || !DECIMAL_RE.test(value)) {
    throw new StrategyError('INPUT_INVALID', `expected a decimal string, got ${typeof value === 'string' ? `"${value}"` : typeof value}`);
  }
  const negative = value.startsWith('-');
  const [i, f = ''] = (negative ? value.slice(1) : value).split('.');
  if (f.length > SCALE) throw new StrategyError('INPUT_INVALID', `more than ${SCALE} fractional digits: "${value}"`);
  const units = BigInt(i) * ONE + BigInt(f.padEnd(SCALE, '0') || '0');
  return negative ? -units : units;
}

export const fxInt = (n) => BigInt(n) * ONE;

/** Fixed-point bigint → canonical decimal string (no trailing zeros). */
export function toDecimal(units) {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const i = abs / ONE;
  const f = (abs % ONE).toString().padStart(SCALE, '0').replace(/0+$/, '');
  const s = f ? `${i}.${f}` : `${i}`;
  return negative && s !== '0' ? `-${s}` : s;
}

/** Round-half-even integer division of bigints (d ≠ 0). */
export function divHalfEven(n, d) {
  if (d === 0n) throw new StrategyError('INPUT_INVALID', 'division by zero');
  if (d < 0n) { n = -n; d = -d; }
  let q = n / d;
  let r = n % d;
  if (r < 0n) { q -= 1n; r += d; } // floor division
  const twice = 2n * r;
  if (twice > d || (twice === d && (q & 1n) === 1n)) q += 1n;
  return q;
}

export const add = (a, b) => a + b;
export const sub = (a, b) => a - b;
export const mul = (a, b) => divHalfEven(a * b, ONE);
export const div = (a, b) => divHalfEven(a * ONE, b);
export const divInt = (a, n) => divHalfEven(a, BigInt(n));
export const abs = (a) => (a < 0n ? -a : a);
export const max = (a, b) => (a > b ? a : b);
export const min = (a, b) => (a < b ? a : b);
