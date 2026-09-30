// Instruments and symbols (Stage 10).
//
// Canonical instrument ids are venue-independent:
//   crypto spot → "BASE-QUOTE"          e.g. "BTC-USDT"
//   equity      → "EXCHANGE:SYMBOL"     e.g. "NSE:RELIANCE", "NASDAQ:AAPL"
// Venue symbols ("BTCUSDT", "BTC/USD", "NSE_EQ|INE002A01018") are looked up in an
// InstrumentRegistry built from each venue's instrument master; they are never
// parsed heuristically for trading decisions.
import { AssetClass, Venue } from './types.mjs';
import { parseDecimal, isPositive } from './decimal.mjs';

const CRYPTO_RE = /^[A-Z0-9]{2,15}-[A-Z0-9]{2,15}$/;
const EQUITY_RE = /^[A-Z]{2,10}:[A-Z0-9&._-]{1,30}$/;

export function canonicalCrypto(base, quote) {
  const id = `${String(base).trim().toUpperCase()}-${String(quote).trim().toUpperCase()}`;
  if (!CRYPTO_RE.test(id)) throw new RangeError(`invalid crypto instrument: ${id}`);
  return id;
}

export function canonicalEquity(exchange, symbol) {
  const id = `${String(exchange).trim().toUpperCase()}:${String(symbol).trim().toUpperCase()}`;
  if (!EQUITY_RE.test(id)) throw new RangeError(`invalid equity instrument: ${id}`);
  return id;
}

export function assetClassOf(canonical) {
  if (CRYPTO_RE.test(canonical)) return AssetClass.CRYPTO_SPOT;
  if (EQUITY_RE.test(canonical)) return AssetClass.EQUITY;
  throw new RangeError(`not a canonical instrument id: ${canonical}`);
}

/** Venue display form of a crypto pair (only for building registry entries; lookups use the registry). */
export function venueCryptoSymbol(venue, base, quote) {
  const b = base.toUpperCase();
  const q = quote.toUpperCase();
  if (venue === Venue.BINANCE) return `${b}${q}`;
  if (venue === Venue.ALPACA) return `${b}/${q}`;
  if (venue === Venue.MOCK) return `${b}-${q}`;
  throw new RangeError(`venue ${venue} has no crypto symbol convention`);
}

/**
 * Validate and freeze an instrument spec.
 * All sizes are decimal strings; quoteDecimals is the minor-unit precision of the quote currency.
 */
export function defineInstrument(spec) {
  const required = ['canonical', 'venue', 'venueSymbol', 'quoteCurrency', 'quoteDecimals', 'tickSize', 'lotSize', 'minQuantity', 'minNotional'];
  for (const k of required) if (spec[k] == null || spec[k] === '') throw new TypeError(`instrument spec missing ${k}`);
  assetClassOf(spec.canonical);
  for (const k of ['tickSize', 'lotSize']) if (!isPositive(spec[k])) throw new RangeError(`${k} must be > 0`);
  for (const k of ['minQuantity', 'minNotional']) parseDecimal(spec[k]);
  if (!Number.isInteger(spec.quoteDecimals) || spec.quoteDecimals < 0 || spec.quoteDecimals > 18) throw new RangeError('quoteDecimals must be 0..18');
  if (!Object.values(Venue).includes(spec.venue)) throw new RangeError(`unknown venue ${spec.venue}`);
  return Object.freeze({ ...spec, assetClass: assetClassOf(spec.canonical) });
}

export class InstrumentRegistry {
  #byCanonical = new Map();
  #byVenueSymbol = new Map();

  constructor(specs = []) { for (const s of specs) this.register(s); }

  register(spec) {
    const s = defineInstrument(spec);
    const key = `${s.venue}\u0000${s.venueSymbol}`;
    if (this.#byVenueSymbol.has(key)) throw new RangeError(`duplicate venue symbol ${s.venue}:${s.venueSymbol}`);
    const ck = `${s.venue}\u0000${s.canonical}`;
    if (this.#byCanonical.has(ck)) throw new RangeError(`duplicate instrument ${s.venue}:${s.canonical}`);
    this.#byCanonical.set(ck, s);
    this.#byVenueSymbol.set(key, s);
    return s;
  }

  /** @returns the spec or null */
  byCanonical(venue, canonical) { return this.#byCanonical.get(`${venue}\u0000${canonical}`) ?? null; }

  /** @returns the spec or null */
  byVenueSymbol(venue, venueSymbol) { return this.#byVenueSymbol.get(`${venue}\u0000${venueSymbol}`) ?? null; }
}
