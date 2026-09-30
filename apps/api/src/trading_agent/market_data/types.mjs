// Normalized market-data types (Stage 11). Prices/sizes are exact decimal strings.
import { compareDecimal, parseDecimal } from '../brokers/decimal.mjs';
import { Venue } from '../brokers/types.mjs';

export const Dataset = Object.freeze({ QUOTES: 'quotes', CANDLES: 'candles', ORDER_BOOK: 'order_book', TRADES: 'trades' });

/** Why data is requested; drives entitlement checks. */
export const Purpose = Object.freeze({
  INTERNAL_USE: 'internal_use',     // risk checks, strategy computation (never shown raw)
  DISPLAY: 'display',               // shown to the entitled user
  REDISTRIBUTION: 'redistribution', // served raw to anyone else (API, partners): needs its own grant
});

export const CandleInterval = Object.freeze({ M1: '1m', M5: '5m', M15: '15m', H1: '1h', H4: '4h', D1: '1d' });
export const INTERVAL_MS = Object.freeze({ '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 });

export class MarketDataError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'MarketDataError';
    this.code = code; // ENTITLEMENT_DENIED | INVALID_DATA | NOT_IMPLEMENTED | UPSTREAM_UNAVAILABLE | CONFIG
  }
}

const iso = (v, name) => {
  const d = new Date(v);
  if (v == null || Number.isNaN(d.getTime())) throw new MarketDataError('INVALID_DATA', `${name} must be a valid timestamp`);
  return d.toISOString();
};
const dec = (v, name, { positive = true } = {}) => {
  try { parseDecimal(v); } catch { throw new MarketDataError('INVALID_DATA', `${name} must be a decimal string`); }
  if (positive && compareDecimal(v, '0') <= 0) throw new MarketDataError('INVALID_DATA', `${name} must be > 0`);
  if (!positive && compareDecimal(v, '0') < 0) throw new MarketDataError('INVALID_DATA', `${name} must be >= 0`);
  return v;
};
const venueOf = (v) => {
  if (!Object.values(Venue).includes(v)) throw new MarketDataError('INVALID_DATA', `unknown venue ${v}`);
  return v;
};

/**
 * @param raw { venue, instrument, bid, ask, last?, bidSize?, askSize?, sourceTimestamp, receivedAt }
 *   sourceTimestamp = venue event time (staleness is measured from this); receivedAt = local receipt (diagnostic).
 */
export function normalizeQuote(raw) {
  if (!raw || typeof raw.instrument !== 'string' || !raw.instrument) throw new MarketDataError('INVALID_DATA', 'instrument required');
  const q = {
    kind: 'quote',
    venue: venueOf(raw.venue),
    instrument: raw.instrument,
    bid: dec(raw.bid, 'bid'),
    ask: dec(raw.ask, 'ask'),
    last: raw.last == null ? null : dec(raw.last, 'last'),
    bidSize: raw.bidSize == null ? null : dec(raw.bidSize, 'bidSize', { positive: false }),
    askSize: raw.askSize == null ? null : dec(raw.askSize, 'askSize', { positive: false }),
    sourceTimestamp: iso(raw.sourceTimestamp, 'sourceTimestamp'),
    receivedAt: iso(raw.receivedAt, 'receivedAt'),
  };
  if (compareDecimal(q.bid, q.ask) > 0) throw new MarketDataError('INVALID_DATA', `crossed quote: bid ${q.bid} > ask ${q.ask}`);
  return Object.freeze(q);
}

/** @param raw { venue, instrument, interval, openTime, open, high, low, close, volume, closed, updatedAt } */
export function normalizeCandle(raw) {
  if (!raw || typeof raw.instrument !== 'string' || !raw.instrument) throw new MarketDataError('INVALID_DATA', 'instrument required');
  if (!Object.values(CandleInterval).includes(raw.interval)) throw new MarketDataError('INVALID_DATA', `invalid interval ${raw.interval}`);
  const openTime = iso(raw.openTime, 'openTime');
  const c = {
    kind: 'candle',
    venue: venueOf(raw.venue),
    instrument: raw.instrument,
    interval: raw.interval,
    openTime,
    closeTime: new Date(new Date(openTime).getTime() + INTERVAL_MS[raw.interval]).toISOString(),
    open: dec(raw.open, 'open'),
    high: dec(raw.high, 'high'),
    low: dec(raw.low, 'low'),
    close: dec(raw.close, 'close'),
    volume: dec(raw.volume, 'volume', { positive: false }),
    closed: raw.closed === true,
    updatedAt: iso(raw.updatedAt, 'updatedAt'),
  };
  for (const k of ['open', 'close', 'low']) if (compareDecimal(c[k], c.high) > 0) throw new MarketDataError('INVALID_DATA', `${k} above high`);
  for (const k of ['open', 'close', 'high']) if (compareDecimal(c[k], c.low) < 0) throw new MarketDataError('INVALID_DATA', `${k} below low`);
  return Object.freeze(c);
}
