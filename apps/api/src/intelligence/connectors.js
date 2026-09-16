// apps/api/src/intelligence/connectors.js
//
// M3 — Public market-data connectors for derived intelligence.
//
// Design rules:
//  - PUBLIC endpoints only (no keys, no auth). Inputs to DERIVED analytics.
//  - Every fetch is time-boxed and NEVER throws to the caller: on any failure
//    it returns [] (or the documented empty shape). The engine treats a partial
//    or empty fetch as "no fresh data" and serves the last snapshot with an
//    honest `stale` flag — the product never fabricates a number (prompt §35).
//  - `fetchImpl` and `now` are injectable so the whole layer is unit-testable
//    offline and deterministically.
//
// Source ToS note (prompt §15): Binance/Bybit public market data is YELLOW for
// raw redistribution; Satelink serves only DERIVED statistics (see compute.js),
// which is the mitigation. Sources are configurable via env so a licensed feed
// can be swapped in without code changes.

const DEFAULT_TIMEOUT_MS = 6000;

// A small, liquid symbol universe. Kept intentionally short for a fast, cheap
// refresh; override with INTEL_SYMBOLS (comma-separated, e.g. "BTCUSDT,ETHUSDT").
export function symbolUniverse() {
  const raw = process.env.INTEL_SYMBOLS;
  if (raw && raw.trim()) return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
}

async function safeJson(fetchImpl, url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null; // network/timeout/parse — swallowed by design
  } finally {
    clearTimeout(timer);
  }
}

const BINANCE = () => process.env.INTEL_BINANCE_BASE || 'https://fapi.binance.com';
const BYBIT = () => process.env.INTEL_BYBIT_BASE || 'https://api.bybit.com';

/**
 * Funding rates across exchanges → rows for fundingRateHeatmap().
 * Binance: /fapi/v1/premiumIndex (all symbols; lastFundingRate, 8h interval).
 * Bybit:   /v5/market/tickers?category=linear (fundingRate, 8h interval).
 * Returns [{ symbol, exchange, fundingRate, intervalHours }].
 */
export async function fetchFundingRates(fetchImpl, symbols = symbolUniverse()) {
  const want = new Set(symbols);
  const rows = [];

  const bin = await safeJson(fetchImpl, `${BINANCE()}/fapi/v1/premiumIndex`);
  if (Array.isArray(bin)) {
    for (const r of bin) {
      if (!r || !want.has(r.symbol)) continue;
      const fr = Number(r.lastFundingRate);
      if (Number.isFinite(fr)) rows.push({ symbol: r.symbol, exchange: 'binance', fundingRate: fr, intervalHours: 8 });
    }
  }

  const by = await safeJson(fetchImpl, `${BYBIT()}/v5/market/tickers?category=linear`);
  const list = by?.result?.list;
  if (Array.isArray(list)) {
    for (const r of list) {
      if (!r || !want.has(r.symbol)) continue;
      const fr = Number(r.fundingRate);
      if (Number.isFinite(fr)) rows.push({ symbol: r.symbol, exchange: 'bybit', fundingRate: fr, intervalHours: 8 });
    }
  }
  return rows;
}

/**
 * Open interest (USD notional) per symbol → rows for openInterestShifts().
 * Binance: /fapi/v1/openInterest?symbol=X (contracts) × mark price (premiumIndex).
 * Returns [{ symbol, exchange, openInterestUsd }].
 */
export async function fetchOpenInterest(fetchImpl, symbols = symbolUniverse()) {
  const rows = [];
  // One premiumIndex call gives mark prices for all symbols.
  const bin = await safeJson(fetchImpl, `${BINANCE()}/fapi/v1/premiumIndex`);
  const markBySymbol = new Map();
  if (Array.isArray(bin)) for (const r of bin) markBySymbol.set(r.symbol, Number(r.markPrice));

  for (const symbol of symbols) {
    const oi = await safeJson(fetchImpl, `${BINANCE()}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`);
    const contracts = Number(oi?.openInterest);
    const mark = markBySymbol.get(symbol);
    if (Number.isFinite(contracts) && Number.isFinite(mark) && mark > 0) {
      rows.push({ symbol, exchange: 'binance', openInterestUsd: contracts * mark });
    }
  }
  return rows;
}

/**
 * Mark price + funding per symbol → rows for liquidationClusters().
 * Returns [{ symbol, markPrice, fundingRate }].
 */
export async function fetchMarkAndFunding(fetchImpl, symbols = symbolUniverse()) {
  const want = new Set(symbols);
  const rows = [];
  const bin = await safeJson(fetchImpl, `${BINANCE()}/fapi/v1/premiumIndex`);
  if (Array.isArray(bin)) {
    for (const r of bin) {
      if (!r || !want.has(r.symbol)) continue;
      const mark = Number(r.markPrice);
      const fr = Number(r.lastFundingRate);
      if (Number.isFinite(mark) && mark > 0) {
        rows.push({ symbol: r.symbol, markPrice: mark, fundingRate: Number.isFinite(fr) ? fr : 0 });
      }
    }
  }
  return rows;
}

/**
 * Order-book depth per symbol → rows for marketMicrostructure().
 * Binance: /fapi/v1/depth?symbol=X&limit=50.
 * Returns [{ symbol, exchange, bids, asks }].
 */
export async function fetchOrderBooks(fetchImpl, symbols = symbolUniverse(), limit = 50) {
  const rows = [];
  for (const symbol of symbols) {
    const d = await safeJson(fetchImpl, `${BINANCE()}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
    if (d && Array.isArray(d.bids) && Array.isArray(d.asks)) {
      rows.push({ symbol, exchange: 'binance', bids: d.bids, asks: d.asks });
    }
  }
  return rows;
}

export { safeJson, DEFAULT_TIMEOUT_MS };
