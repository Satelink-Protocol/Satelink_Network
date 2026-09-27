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
// Source ToS note (prompt §15): Binance/Bybit/OKX/Deribit/Hyperliquid public
// market data is YELLOW for raw redistribution; Satelink serves only DERIVED
// statistics (see compute.js), which is the mitigation. Sources are configurable via env so a licensed feed
// can be swapped in without code changes.

const DEFAULT_TIMEOUT_MS = 6000;

// A small, liquid symbol universe. Kept intentionally short for a fast, cheap
// refresh; override with INTEL_SYMBOLS (comma-separated, e.g. "BTCUSDT,ETHUSDT").
export function symbolUniverse() {
  const raw = process.env.INTEL_SYMBOLS;
  if (raw && raw.trim()) return raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
}

async function fetchJson(fetchImpl, url, { timeoutMs = DEFAULT_TIMEOUT_MS, init = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal, headers: { accept: 'application/json', ...(init.headers || {}) } });
    if (!res || !res.ok) return { data: null, status: res ? res.status ?? 'error' : 'error' };
    return { data: await res.json(), status: res.status ?? 200 };
  } catch (e) {
    return { data: null, status: e?.name === 'AbortError' ? 'timeout' : 'network' }; // swallowed by design
  } finally {
    clearTimeout(timer);
  }
}

async function safeJson(fetchImpl, url, opts) {
  return (await fetchJson(fetchImpl, url, opts)).data;
}

// Per-source outcome of one refresh, for the refresh log and the snapshot
// payload ("which venues this number came from"). `status` is an optional
// array the caller passes in; entries: { source, status, rows }.
function note(status, source, httpStatus, rows) {
  if (Array.isArray(status)) status.push({ source, status: httpStatus, rows });
}

const BINANCE = () => process.env.INTEL_BINANCE_BASE || 'https://fapi.binance.com';
const BYBIT = () => process.env.INTEL_BYBIT_BASE || 'https://api.bybit.com';
const OKX = () => process.env.INTEL_OKX_BASE || 'https://www.okx.com';
const DERIBIT = () => process.env.INTEL_DERIBIT_BASE || 'https://www.deribit.com';
const HYPERLIQUID = () => process.env.INTEL_HYPERLIQUID_BASE || 'https://api.hyperliquid.xyz';

// Venue symbol maps. The universe is Binance-style (BTCUSDT); a venue that
// does not list a symbol simply contributes no row for it.
const base = (symbol) => symbol.replace(/USDT$/, '');
const okxInst = (symbol) => `${base(symbol)}-USDT-SWAP`;
const DERIBIT_PERPS = { BTCUSDT: 'BTC-PERPETUAL', ETHUSDT: 'ETH-PERPETUAL' }; // inverse perps, deepest books

// Binance futures and Bybit refuse US IP addresses (HTTP 451 / 403); the API
// runs in a US region, so OKX, Deribit and Hyperliquid are queried as well and
// every metric uses whichever venues answer. Order = preference.
async function hyperliquidCtxs(fetchImpl) {
  const { data, status: st } = await fetchJson(fetchImpl, `${HYPERLIQUID()}/info`, {
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) },
  });
  const byCoin = new Map();
  if (Array.isArray(data) && Array.isArray(data[0]?.universe) && Array.isArray(data[1])) {
    data[0].universe.forEach((u, i) => { if (u?.name && data[1][i]) byCoin.set(u.name, data[1][i]); });
  }
  return { byCoin, st };
}

/**
 * Funding rates across exchanges → rows for fundingRateHeatmap().
 * Binance premiumIndex (8h), Bybit tickers (8h), OKX funding-rate (interval
 * from fundingTime → nextFundingTime), Deribit funding_8h, Hyperliquid (1h).
 * Returns [{ symbol, exchange, fundingRate, intervalHours }].
 */
export async function fetchFundingRates(fetchImpl, symbols = symbolUniverse(), status) {
  const want = new Set(symbols);
  const rows = [];
  const push = (r) => rows.push(r);

  const bin = await fetchJson(fetchImpl, `${BINANCE()}/fapi/v1/premiumIndex`);
  let n = 0;
  if (Array.isArray(bin.data)) {
    for (const r of bin.data) {
      if (!r || !want.has(r.symbol)) continue;
      const fr = Number(r.lastFundingRate);
      if (Number.isFinite(fr)) { push({ symbol: r.symbol, exchange: 'binance', fundingRate: fr, intervalHours: 8 }); n++; }
    }
  }
  note(status, 'binance', bin.status, n);

  const by = await fetchJson(fetchImpl, `${BYBIT()}/v5/market/tickers?category=linear`);
  n = 0;
  if (Array.isArray(by.data?.result?.list)) {
    for (const r of by.data.result.list) {
      if (!r || !want.has(r.symbol)) continue;
      const fr = Number(r.fundingRate);
      if (Number.isFinite(fr)) { push({ symbol: r.symbol, exchange: 'bybit', fundingRate: fr, intervalHours: 8 }); n++; }
    }
  }
  note(status, 'bybit', by.status, n);

  n = 0; let okxSt = null;
  for (const symbol of symbols) {
    const o = await fetchJson(fetchImpl, `${OKX()}/api/v5/public/funding-rate?instId=${encodeURIComponent(okxInst(symbol))}`);
    okxSt = okxSt === 200 ? 200 : o.status;
    const d = o.data?.data?.[0];
    const fr = Number(d?.fundingRate);
    if (!Number.isFinite(fr)) continue;
    const hours = (Number(d.nextFundingTime) - Number(d.fundingTime)) / 3_600_000;
    push({ symbol, exchange: 'okx', fundingRate: fr, intervalHours: hours > 0 && hours <= 24 ? hours : 8 });
    n++;
  }
  note(status, 'okx', okxSt, n);

  n = 0; let derSt = null;
  for (const symbol of symbols) {
    const inst = DERIBIT_PERPS[symbol];
    if (!inst) continue;
    const d = await fetchJson(fetchImpl, `${DERIBIT()}/api/v2/public/ticker?instrument_name=${inst}`);
    derSt = derSt === 200 ? 200 : d.status;
    const fr = Number(d.data?.result?.funding_8h);
    if (Number.isFinite(fr)) { push({ symbol, exchange: 'deribit', fundingRate: fr, intervalHours: 8 }); n++; }
  }
  note(status, 'deribit', derSt, n);

  const hl = await hyperliquidCtxs(fetchImpl);
  n = 0;
  for (const symbol of symbols) {
    const fr = Number(hl.byCoin.get(base(symbol))?.funding);
    if (Number.isFinite(fr)) { push({ symbol, exchange: 'hyperliquid', fundingRate: fr, intervalHours: 1 }); n++; }
  }
  note(status, 'hyperliquid', hl.st, n);
  return rows;
}

/**
 * Open interest (USD notional) per symbol → rows for openInterestShifts().
 * ONE venue per refresh (first that answers: Binance → OKX → Hyperliquid), so
 * a change is never an artefact of venues appearing or disappearing; the
 * engine only compares against a prior snapshot from the same venue.
 * Returns [{ symbol, exchange, openInterestUsd }].
 */
export async function fetchOpenInterest(fetchImpl, symbols = symbolUniverse(), status) {
  // Binance: contracts × mark price.
  const bin = await fetchJson(fetchImpl, `${BINANCE()}/fapi/v1/premiumIndex`);
  if (Array.isArray(bin.data)) {
    const mark = new Map(bin.data.map((r) => [r.symbol, Number(r.markPrice)]));
    const rows = [];
    for (const symbol of symbols) {
      const oi = await safeJson(fetchImpl, `${BINANCE()}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`);
      const contracts = Number(oi?.openInterest);
      const m = mark.get(symbol);
      if (Number.isFinite(contracts) && Number.isFinite(m) && m > 0) rows.push({ symbol, exchange: 'binance', openInterestUsd: contracts * m });
    }
    note(status, 'binance', bin.status, rows.length);
    if (rows.length) return rows;
  } else note(status, 'binance', bin.status, 0);

  // OKX: oiUsd per instrument.
  const okxRows = [];
  let okxSt = null;
  for (const symbol of symbols) {
    const o = await fetchJson(fetchImpl, `${OKX()}/api/v5/public/open-interest?instType=SWAP&instId=${encodeURIComponent(okxInst(symbol))}`);
    okxSt = okxSt === 200 ? 200 : o.status;
    const usd = Number(o.data?.data?.[0]?.oiUsd);
    if (Number.isFinite(usd) && usd > 0) okxRows.push({ symbol, exchange: 'okx', openInterestUsd: usd });
  }
  note(status, 'okx', okxSt, okxRows.length);
  if (okxRows.length) return okxRows;

  // Hyperliquid: openInterest (coins) × markPx.
  const hl = await hyperliquidCtxs(fetchImpl);
  const hlRows = [];
  for (const symbol of symbols) {
    const c = hl.byCoin.get(base(symbol));
    const coins = Number(c?.openInterest);
    const m = Number(c?.markPx);
    if (Number.isFinite(coins) && Number.isFinite(m) && m > 0) hlRows.push({ symbol, exchange: 'hyperliquid', openInterestUsd: coins * m });
  }
  note(status, 'hyperliquid', hl.st, hlRows.length);
  return hlRows;
}

/**
 * Mark price + funding per symbol → rows for liquidationClusters().
 * First venue that answers: Binance → Hyperliquid (funding normalised to the
 * 8h rate the model expects).
 * Returns [{ symbol, markPrice, fundingRate, exchange }].
 */
export async function fetchMarkAndFunding(fetchImpl, symbols = symbolUniverse(), status) {
  const want = new Set(symbols);
  const rows = [];
  const bin = await fetchJson(fetchImpl, `${BINANCE()}/fapi/v1/premiumIndex`);
  if (Array.isArray(bin.data)) {
    for (const r of bin.data) {
      if (!r || !want.has(r.symbol)) continue;
      const mark = Number(r.markPrice);
      const fr = Number(r.lastFundingRate);
      if (Number.isFinite(mark) && mark > 0) rows.push({ symbol: r.symbol, exchange: 'binance', markPrice: mark, fundingRate: Number.isFinite(fr) ? fr : 0 });
    }
  }
  note(status, 'binance', bin.status, rows.length);
  if (rows.length) return rows;

  const hl = await hyperliquidCtxs(fetchImpl);
  for (const symbol of symbols) {
    const c = hl.byCoin.get(base(symbol));
    const mark = Number(c?.markPx);
    const fr1h = Number(c?.funding);
    if (Number.isFinite(mark) && mark > 0) rows.push({ symbol, exchange: 'hyperliquid', markPrice: mark, fundingRate: Number.isFinite(fr1h) ? fr1h * 8 : 0 });
  }
  note(status, 'hyperliquid', hl.st, rows.length);
  return rows;
}

/**
 * Order-book depth per symbol → rows for marketMicrostructure().
 * First venue that answers: Binance depth → Hyperliquid l2Book (sizes in coins,
 * same unit as Binance, so depth in USD stays comparable).
 * Returns [{ symbol, exchange, bids, asks }].
 */
export async function fetchOrderBooks(fetchImpl, symbols = symbolUniverse(), limit = 50, status) {
  const rows = [];
  let binSt = null;
  for (const symbol of symbols) {
    const d = await fetchJson(fetchImpl, `${BINANCE()}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`);
    binSt = binSt === 200 ? 200 : d.status;
    if (d.data && Array.isArray(d.data.bids) && Array.isArray(d.data.asks)) {
      rows.push({ symbol, exchange: 'binance', bids: d.data.bids, asks: d.data.asks });
    }
  }
  note(status, 'binance', binSt, rows.length);
  if (rows.length) return rows;

  let hlSt = null;
  for (const symbol of symbols) {
    const b = await fetchJson(fetchImpl, `${HYPERLIQUID()}/info`, {
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'l2Book', coin: base(symbol) }) },
    });
    hlSt = hlSt === 200 ? 200 : b.status;
    const lv = b.data?.levels;
    if (Array.isArray(lv) && Array.isArray(lv[0]) && Array.isArray(lv[1]) && lv[0].length && lv[1].length) {
      rows.push({ symbol, exchange: 'hyperliquid', bids: lv[0].map((x) => [x.px, x.sz]), asks: lv[1].map((x) => [x.px, x.sz]) });
    }
  }
  note(status, 'hyperliquid', hlSt, rows.length);
  return rows;
}

export { safeJson, fetchJson, DEFAULT_TIMEOUT_MS };
