// Deterministic indicators over fixed-point bars (Stage 13).
//
// Each function takes bars [{ open, high, low, close } as fixed-point bigint]
// (oldest first) and returns an array of the same length whose entries are a
// bigint, or null before the indicator has enough history. Only + − × ÷ with
// half-even rounding: no floats, no exp/log, so results are identical everywhere.
import { ONE, add, sub, mul, div, divInt, abs, max, min, fxInt } from './fixed.mjs';

const HUNDRED = fxInt(100);

/** Bars of history needed before the indicator's first value. */
export function warmupOf(spec) {
  return spec.type === 'rsi' ? spec.period + 1 : spec.period;
}

export function computeIndicator(spec, bars) {
  switch (spec.type) {
    case 'sma': return sma(bars.map((b) => b[spec.source]), spec.period);
    case 'ema': return ema(bars.map((b) => b[spec.source]), spec.period);
    case 'rsi': return rsi(bars.map((b) => b[spec.source]), spec.period);
    case 'atr': return atr(bars, spec.period);
    case 'highest': return windowed(bars.map((b) => b[spec.source]), spec.period, max);
    case 'lowest': return windowed(bars.map((b) => b[spec.source]), spec.period, min);
    default: throw new Error(`unknown indicator ${spec.type}`); // unreachable: schema-checked
  }
}

export function sma(xs, p) {
  const out = new Array(xs.length).fill(null);
  let sum = 0n;
  for (let i = 0; i < xs.length; i += 1) {
    sum = add(sum, xs[i]);
    if (i >= p) sum = sub(sum, xs[i - p]);
    if (i >= p - 1) out[i] = divInt(sum, p);
  }
  return out;
}

/** EMA seeded with the SMA of the first p values; alpha = 2 / (p + 1). */
export function ema(xs, p) {
  const out = new Array(xs.length).fill(null);
  if (xs.length < p) return out;
  const alpha = div(fxInt(2), fxInt(p + 1));
  let prev = divInt(xs.slice(0, p).reduce(add, 0n), p);
  out[p - 1] = prev;
  for (let i = p; i < xs.length; i += 1) {
    prev = add(prev, mul(sub(xs[i], prev), alpha));
    out[i] = prev;
  }
  return out;
}

/** Wilder RSI: first value at index p (needs p price changes). */
export function rsi(xs, p) {
  const out = new Array(xs.length).fill(null);
  if (xs.length < p + 1) return out;
  let gain = 0n;
  let loss = 0n;
  for (let i = 1; i <= p; i += 1) {
    const d = sub(xs[i], xs[i - 1]);
    if (d > 0n) gain = add(gain, d); else loss = add(loss, -d);
  }
  gain = divInt(gain, p);
  loss = divInt(loss, p);
  out[p] = rsiFrom(gain, loss);
  for (let i = p + 1; i < xs.length; i += 1) {
    const d = sub(xs[i], xs[i - 1]);
    gain = divInt(add(mul(gain, fxInt(p - 1)), d > 0n ? d : 0n), p);
    loss = divInt(add(mul(loss, fxInt(p - 1)), d < 0n ? -d : 0n), p);
    out[i] = rsiFrom(gain, loss);
  }
  return out;
}

function rsiFrom(gain, loss) {
  if (loss === 0n) return gain === 0n ? fxInt(50) : HUNDRED;
  const rs = div(gain, loss);
  return sub(HUNDRED, div(HUNDRED, add(ONE, rs)));
}

/** Wilder ATR: TR[0] = high − low; seed = mean of the first p TRs (index p − 1). */
export function atr(bars, p) {
  const out = new Array(bars.length).fill(null);
  if (bars.length < p) return out;
  const tr = bars.map((b, i) => (i === 0
    ? sub(b.high, b.low)
    : max(sub(b.high, b.low), max(abs(sub(b.high, bars[i - 1].close)), abs(sub(b.low, bars[i - 1].close))))));
  let prev = divInt(tr.slice(0, p).reduce(add, 0n), p);
  out[p - 1] = prev;
  for (let i = p; i < bars.length; i += 1) {
    prev = divInt(add(mul(prev, fxInt(p - 1)), tr[i]), p);
    out[i] = prev;
  }
  return out;
}

function windowed(xs, p, pick) {
  const out = new Array(xs.length).fill(null);
  for (let i = p - 1; i < xs.length; i += 1) {
    let m = xs[i - p + 1];
    for (let j = i - p + 2; j <= i; j += 1) m = pick(m, xs[j]);
    out[i] = m;
  }
  return out;
}
