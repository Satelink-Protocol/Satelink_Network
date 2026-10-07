// Shared helpers for the validation engines (Phase 6 item 5).
import { DISCLAIMER } from '../backtest/engine.mjs';
import { canonicalJson, contentHash, deepFreeze } from '../strategies/canonical.mjs';

export const HYPOTHETICAL = 'HYPOTHETICAL';
export const VALIDATION_DISCLAIMER = `${DISCLAIMER.backtest} Walk-forward and stress figures are further simulations of that hypothetical record.`;

export class ValidationError extends Error {
  constructor(code, message) { super(message); this.name = 'ValidationError'; this.code = code; }
}

/** Distinct bar open times across instruments, ascending. Candles carry openTime as ms or ISO. */
export function barTimes(candles) {
  return [...new Set(candles.map((c) => (typeof c.openTime === 'number' ? c.openTime : Date.parse(c.openTime))))].sort((a, b) => a - b);
}
export const timeOf = (c) => (typeof c.openTime === 'number' ? c.openTime : Date.parse(c.openTime));

export function seal(body) {
  const b = { label: HYPOTHETICAL, disclaimer: VALIDATION_DISCLAIMER, ...body };
  return deepFreeze({ ...b, resultHash: contentHash(canonicalJson(b)) });
}

/** mulberry32 — the same seeded PRNG family the Stage 14 simulator uses for venue rejects. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
