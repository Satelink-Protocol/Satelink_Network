// Feature / indicator engine (Phase 6 item 4) — extends the Stage 13 indicators with VWAP, returns
// and volatility, over the same fixed-point bars (bigint at 1e18, half-even), so backtest, paper and
// live compute bit-identical values. Stage 13 types are delegated unchanged to computeIndicator.
import { computeIndicator, sma, ema, rsi, atr } from '../strategies/indicators.mjs';
import { fx, fxInt, ONE, add, sub, mul, div, divInt, toDecimal } from '../strategies/fixed.mjs';

export const STAGE13_TYPES = Object.freeze(['sma', 'ema', 'rsi', 'atr', 'highest', 'lowest']);
export const FEATURE_TYPES = Object.freeze([...STAGE13_TYPES, 'vwap', 'returns', 'volatility']);

/** Normalized candles (decimal strings, oldest first) → fixed-point bars. */
export function barsFromCandles(candles) {
  return candles.map((c) => Object.freeze({ open: fx(c.open), high: fx(c.high), low: fx(c.low), close: fx(c.close), volume: fx(c.volume ?? '0'), openTime: c.openTime }));
}

/** Integer square root (floor) of a non-negative bigint — Newton, deterministic. */
export function isqrt(n) {
  if (n < 0n) throw new Error('isqrt of negative');
  if (n < 2n) return n;
  let x = n; let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
/** sqrt of a fixed-point value, result fixed-point (floor). */
export const sqrtFx = (x) => isqrt(x * ONE);

/** Simple returns r[i] = (c[i] − c[i−1]) / c[i−1]; r[0] = null. */
export function returns(bars) {
  return bars.map((b, i) => (i === 0 || bars[i - 1].close === 0n ? null : div(sub(b.close, bars[i - 1].close), bars[i - 1].close)));
}

/** Rolling population stdev of simple returns over p returns. */
export function volatility(bars, p) {
  const r = returns(bars);
  const out = new Array(bars.length).fill(null);
  for (let i = p; i < bars.length; i += 1) {
    const w = r.slice(i - p + 1, i + 1);
    const mean = divInt(w.reduce(add, 0n), p);
    const variance = divInt(w.map((x) => mul(sub(x, mean), sub(x, mean))).reduce(add, 0n), p);
    out[i] = sqrtFx(variance);
  }
  return out;
}

/** Rolling VWAP of the typical price (h+l+c)/3 over p bars; null when volume is 0. */
export function vwap(bars, p) {
  const out = new Array(bars.length).fill(null);
  for (let i = p - 1; i < bars.length; i += 1) {
    let pv = 0n; let v = 0n;
    for (let j = i - p + 1; j <= i; j += 1) {
      const tp = divInt(add(add(bars[j].high, bars[j].low), bars[j].close), 3);
      pv = add(pv, mul(tp, bars[j].volume)); v = add(v, bars[j].volume);
    }
    out[i] = v === 0n ? null : div(pv, v);
  }
  return out;
}

/** One feature series. spec: { type, period?, source? } (Stage 13 types keep their DSL semantics). */
export function computeFeature(spec, bars) {
  if (STAGE13_TYPES.includes(spec.type)) return computeIndicator({ source: 'close', ...spec }, bars);
  switch (spec.type) {
    case 'vwap': return vwap(bars, spec.period);
    case 'returns': return returns(bars);
    case 'volatility': return volatility(bars, spec.period);
    default: throw new Error(`unknown feature ${spec.type}`);
  }
}

/** Latest value of each named feature as decimal strings (null while warming up). */
export function featureSnapshot(bars, specs) {
  const out = {};
  for (const [name, spec] of Object.entries(specs)) {
    const series = computeFeature(spec, bars);
    const last = series.at(-1);
    out[name] = last == null ? null : toDecimal(last);
  }
  return Object.freeze(out);
}

export { sma, ema, rsi, atr, fx, fxInt, toDecimal };
