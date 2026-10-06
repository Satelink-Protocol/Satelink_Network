// Candle preparation shared by backtest and paper (Stage 14).
// Accepts the engine shape ({instrument, openTime: ms, open, high, low, close, volume})
// or the Stage 11 normalised candle ({openTime: ISO, closed, …}) and returns the engine shape.
import { SimError } from './errors.mjs';
import { canonicalJson, contentHash } from '../strategies/canonical.mjs';

export function toEngineCandle(c) {
  if (!c || typeof c !== 'object') throw new SimError('DATA_INVALID', 'candle must be an object');
  const openTime = typeof c.openTime === 'string' ? Date.parse(c.openTime) : c.openTime;
  if (!Number.isSafeInteger(openTime)) throw new SimError('DATA_INVALID', `invalid openTime ${c.openTime}`);
  return { instrument: c.instrument, openTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? '0' };
}

export const byTimeThenInstrument = (a, b) => (a.openTime - b.openTime) || (a.instrument < b.instrument ? -1 : a.instrument > b.instrument ? 1 : 0);

/**
 * Historical data for a backtest: closed candles only, no duplicates, only universe
 * instruments, sorted (openTime, instrument). Returns { candles, dataHash }.
 */
export function prepareHistory(raw, instruments) {
  if (!Array.isArray(raw) || raw.length === 0) throw new SimError('DATA_INVALID', 'no candles');
  const allowed = new Set(instruments);
  const seen = new Set();
  const out = raw.map((c) => {
    if (c?.closed === false) throw new SimError('DATA_INVALID', `unclosed candle ${c.instrument}@${c.openTime} in historical data`);
    const e = toEngineCandle(c);
    if (!allowed.has(e.instrument)) throw new SimError('DATA_INVALID', `candle for ${e.instrument} is outside the strategy universe`);
    const k = `${e.instrument}@${e.openTime}`;
    if (seen.has(k)) throw new SimError('DATA_INVALID', `duplicate candle ${k}`);
    seen.add(k);
    return e;
  }).sort(byTimeThenInstrument);
  return { candles: out, dataHash: contentHash(canonicalJson(out)) };
}
