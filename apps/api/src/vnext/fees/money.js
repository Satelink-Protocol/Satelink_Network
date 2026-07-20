// Money primitives for the Fee Engine.
//
// ALL money is integer minor units held as BigInt. No JS float ever touches a
// monetary value — this eliminates precision loss, rounding drift, and overflow
// by construction. Amounts are accepted as bigint | integer-Number | digit
// string; anything else (float, negative, non-integer, unsafe Number) is
// rejected loudly rather than silently corrupting a fee.

export class FeeError extends Error {
  constructor(code, message, info) {
    super(message);
    this.name = 'FeeError';
    this.code = code;
    this.info = info || {};
  }
}

/** Parse a non-negative integer minor-unit amount to BigInt, or throw. */
export function toMinor(v, field = 'amount') {
  if (typeof v === 'bigint') {
    if (v < 0n) throw new FeeError('NEGATIVE', `${field} must be >= 0`);
    return v;
  }
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new FeeError('PRECISION', `${field} must be integer minor units, got float ${v}`);
    if (!Number.isSafeInteger(v)) throw new FeeError('PRECISION', `${field} exceeds safe integer range; pass a string`);
    if (v < 0) throw new FeeError('NEGATIVE', `${field} must be >= 0`);
    return BigInt(v);
  }
  if (typeof v === 'string') {
    if (!/^\d+$/.test(v)) throw new FeeError('PRECISION', `${field} must be a non-negative integer string, got '${v}'`);
    return BigInt(v);
  }
  throw new FeeError('TYPE', `${field} must be string | integer number | bigint`);
}

/** floor(base * bps / 10000) in exact integer math. base, bps must be >= 0. */
export function bpsOf(base, bps) {
  if (base < 0n) throw new FeeError('NEGATIVE', 'base must be >= 0');
  return (base * bps) / 10_000n; // BigInt division truncates toward zero; ROUND_DOWN
}

/** Validate a bps value is within [0, maxBps]. */
export function assertBps(bps, maxBps = 10_000n) {
  if (typeof bps !== 'bigint') throw new FeeError('TYPE', 'bps must be a bigint');
  if (bps < 0n) throw new FeeError('BPS_RANGE', 'bps must be >= 0');
  if (bps > maxBps) throw new FeeError('BPS_RANGE', `bps ${bps} exceeds max ${maxBps}`);
  return bps;
}

/** Convert a percentage (<=2 decimals) to bps with exact integer math. */
export function parsePercentToBps(p) {
  const s = String(p);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new FeeError('PRECISION', `percentage must be >= 0 with <= 2 decimals, got '${s}'`);
  const [i, f = ''] = s.split('.');
  return BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
}

/** Non-negative subtraction (spread floor at 0 — a fee is never negative). */
export function positiveSpread(buyer, supplier) {
  const d = buyer - supplier;
  return d > 0n ? d : 0n;
}
