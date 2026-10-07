// Exact decimal helpers for broker quantities, prices, fees and money (Stage 10).
//
// No dependency and no JS floats: values are decimal STRINGS (e.g. "0.00012345")
// or bigint minor units. Passing a JS number throws, because a float has already
// lost precision by the time it reaches us. Mirrors the Financial-OS convention
// (NUMERIC minor units + decimals; libs/kernel Money is bigint).

const DECIMAL_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

export const Rounding = Object.freeze({ FLOOR: 'floor', CEIL: 'ceil', HALF_UP: 'half_up', HALF_EVEN: 'half_even', EXACT: 'exact' });

/** Parse a canonical decimal string into { units: bigint, scale: number } where value = units / 10^scale. */
export function parseDecimal(value) {
  if (typeof value !== 'string') {
    throw new TypeError(`decimal must be a string, got ${typeof value}${typeof value === 'number' ? ' (JS numbers are not accepted)' : ''}`);
  }
  if (!DECIMAL_RE.test(value)) throw new RangeError(`invalid decimal string: "${value}"`);
  const negative = value.startsWith('-');
  const abs = negative ? value.slice(1) : value;
  const [intPart, frac = ''] = abs.split('.');
  let units = BigInt(intPart + frac);
  if (negative) units = -units;
  return { units, scale: frac.length };
}

/** Canonical string for units / 10^scale (no trailing zeros, no exponent). */
export function formatDecimal(units, scale) {
  if (typeof units !== 'bigint') throw new TypeError('units must be a bigint');
  const negative = units < 0n;
  let digits = (negative ? -units : units).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    const intPart = digits.slice(0, -scale);
    const frac = digits.slice(-scale).replace(/0+$/, '');
    digits = frac ? `${intPart}.${frac}` : intPart;
  }
  return (negative && digits !== '0' ? '-' : '') + digits;
}

/** Divide a bigint by a positive bigint with the given rounding mode. */
export function divRound(n, d, mode = Rounding.HALF_EVEN) {
  if (d <= 0n) throw new RangeError('divisor must be positive');
  const q = n / d; // truncated toward zero
  const r = n % d; // same sign as n
  if (r === 0n) return q;
  if (mode === Rounding.EXACT) throw new RangeError('value is not exactly representable at the requested precision');
  const sign = r < 0n ? -1n : 1n;
  const floor = sign < 0n ? q - 1n : q;
  const ceil = floor + 1n;
  if (mode === Rounding.FLOOR) return floor;
  if (mode === Rounding.CEIL) return ceil;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice < d) return q;               // below half: the truncated value is nearest
  if (twice > d) return q + sign;        // above half: step away from zero
  if (mode === Rounding.HALF_UP) return q + sign; // exactly half: away from zero
  if (mode === Rounding.HALF_EVEN) return floor % 2n === 0n ? floor : ceil;
  throw new RangeError(`unknown rounding mode: ${mode}`);
}

/** Rescale a decimal string to exactly `decimals` places → bigint minor units. */
export function toMinor(value, decimals, mode = Rounding.EXACT) {
  assertDecimals(decimals);
  const { units, scale } = parseDecimal(value);
  if (scale <= decimals) return units * 10n ** BigInt(decimals - scale);
  return divRound(units, 10n ** BigInt(scale - decimals), mode);
}

/** bigint minor units → canonical decimal string. */
export function fromMinor(minor, decimals) {
  assertDecimals(decimals);
  return formatDecimal(minor, decimals);
}

export function compareDecimal(a, b) {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const s = Math.max(x.scale, y.scale);
  const xu = x.units * 10n ** BigInt(s - x.scale);
  const yu = y.units * 10n ** BigInt(s - y.scale);
  return xu < yu ? -1 : xu > yu ? 1 : 0;
}

export function addDecimal(a, b) {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  const s = Math.max(x.scale, y.scale);
  return formatDecimal(x.units * 10n ** BigInt(s - x.scale) + y.units * 10n ** BigInt(s - y.scale), s);
}

export function isPositive(a) { return compareDecimal(a, '0') > 0; }

/** Exact product a*b as a decimal string. */
export function mulDecimal(a, b) {
  const x = parseDecimal(a);
  const y = parseDecimal(b);
  return formatDecimal(x.units * y.units, x.scale + y.scale);
}

/** True when `value` is an integer multiple of `step` (e.g. lot size / tick size). */
export function isMultipleOf(value, step) {
  const v = parseDecimal(value);
  const s = parseDecimal(step);
  if (s.units <= 0n) throw new RangeError('step must be positive');
  const scale = Math.max(v.scale, s.scale);
  const vu = v.units * 10n ** BigInt(scale - v.scale);
  const su = s.units * 10n ** BigInt(scale - s.scale);
  return vu % su === 0n;
}

/** Round `value` DOWN to a multiple of `step` (never increases exposure). */
export function floorToStep(value, step) {
  const v = parseDecimal(value);
  const s = parseDecimal(step);
  if (s.units <= 0n) throw new RangeError('step must be positive');
  const scale = Math.max(v.scale, s.scale);
  const vu = v.units * 10n ** BigInt(scale - v.scale);
  const su = s.units * 10n ** BigInt(scale - s.scale);
  return formatDecimal(divRound(vu, su, Rounding.FLOOR) * su, scale);
}

function assertDecimals(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new RangeError(`decimals must be an integer 0..18, got ${decimals}`);
}
