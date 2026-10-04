// Fill-model maths (Stage 14): fees, slippage, tick/lot rounding, participation.
// Fixed-point bigint (strategies/fixed.mjs, 18 dp, half-even); no floats.
import { fx, mul, div, ONE, fxInt } from '../strategies/fixed.mjs';

const BPS = fxInt(10_000);
const HUNDRED = fxInt(100);

/** Largest multiple of `step` ≤ value (value ≥ 0). */
export function floorToStep(value, step) {
  return value <= 0n ? 0n : (value / step) * step;
}
/** Smallest multiple of `step` ≥ value (value ≥ 0). */
export function ceilToStep(value, step) {
  const q = value / step;
  return q * step === value ? value : (q + 1n) * step;
}

/** fee = notional × bps / 10 000 (negative bps = rebate). */
export function feeFor(notional, bps) {
  return div(mul(notional, bps), BPS);
}

/**
 * Market fill price: reference moved against the taker by `slippageBps`, then rounded
 * to the tick, again against the taker (buy up, sell down).
 */
export function slippedPrice(reference, side, slippageBps, tick) {
  const adj = div(mul(reference, slippageBps), BPS);
  return side === 'buy' ? ceilToStep(reference + adj, tick) : floorToStep(reference - adj, tick);
}

/** Limit price `offsetBps` away from the reference on the passive side (buy below, sell above), tick-rounded passively. */
export function limitPriceFor(reference, side, offsetBps, tick) {
  const adj = div(mul(reference, offsetBps), BPS);
  return side === 'buy' ? floorToStep(reference - adj, tick) : ceilToStep(reference + adj, tick);
}

/** Max quantity fillable in one bar: volume × pct / 100, floored to the lot size. */
export function participationCap(volume, pct, lot) {
  return floorToStep(div(mul(volume, pct), HUNDRED), lot);
}

/** Limit fill test and price on a bar: buys fill if low ≤ limit at min(open, limit); sells if high ≥ limit at max(open, limit). */
export function limitFill(bar, side, limit) {
  if (side === 'buy') return bar.low <= limit ? (bar.open < limit ? bar.open : limit) : null;
  return bar.high >= limit ? (bar.open > limit ? bar.open : limit) : null;
}

export const pctOf = (part, whole) => (whole === 0n ? 0n : div(mul(part, HUNDRED), whole));
export { fx, ONE };
