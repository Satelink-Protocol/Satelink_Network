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
// Source ToS note (prompt §15): Binance/Bybit/OKX/Hyperliquid public
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
/** 200 if any call of a venue succeeded, else the first failure status. */
function bestStatus(list) {
  return list.includes(200) ? 200 : (list.find((x) => x != null) ?? null);
}

function note(status, source, httpStatus, rows) {
  if (Array.isArray(status)) status.push({ source, status: httpStatus, rows });
}

const BINANCE = () => process.env.INTEL_BINANCE_BASE || 'https://fapi.binance.com';
const BYBIT = () => process.env.INTEL_BYBIT_BASE || 'https://api.bybit.com';
const OKX = () => process.env.INTEL_OKX_BASE || 'https://www.okx.com';
const HYPERLIQUID = () => process.env.INTEL_HYPERLIQUID_BASE || 'https://api.hyperliquid.xyz';

// Venue symbol maps. The universe is Binance-style (BTCUSDT); a venue that
// does not list a symbol simply contributes no row for it.
const base = (symbol) => symbol.replace(/USDT$/, '');
const okxInst = (symbol) => `${base(symbol)}-USDT-SWAP`;

// Binance futures and Bybit refuse US IP addresses (HTTP 451 / 403); the API
// runs in a US region, so OKX and Hyperliquid are queried as well and
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
 * from fundingTime → nextFundingTime), Hyperliquid (1h). All are the current
 * period's rate, so the cross-venue divergence compares like with like
 * (Deribit's funding_8h is a trailing average, so it is not used).
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

  n = 0;
  const okx = await Promise.all(symbols.map((symbol) =>
    fetchJson(fetchImpl, `${OKX()}/api/v5/public/funding-rate?instId=${encodeURIComponent(okxInst(symbol))}`).then((o) => ({ symbol, o }))));
  for (const { symbol, o } of okx) {
    const d = o.data?.data?.[0];
    const fr = Number(d?.fundingRate);
    if (!Number.isFinite(fr)) continue;
    const hours = (Number(d.nextFundingTime) - Number(d.fundingTime)) / 3_600_000;
    push({ symbol, exchange: 'okx', fundingRate: fr, intervalHours: hours > 0 && hours <= 24 ? hours : 8 });
    n++;
  }
  note(status, 'okx', bestStatus(okx.map((x) => x.o.status)), n);


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
  const venues = [
    // Binance: contracts × mark price.
    async () => {
      const bin = await fetchJson(fetchImpl, `${BINANCE()}/fapi/v1/premiumIndex`);
      if (!Array.isArray(bin.data)) return { source: 'binance', st: bin.status, rows: [] };
      const mark = new Map(bin.data.map((r) => [r.symbol, Number(r.markPrice)]));
      const oi = await Promise.all(symbols.map((symbol) =>
        safeJson(fetchImpl, `${BINANCE()}/fapi/v1/openInterest?symbol=${encodeURIComponent(symbol)}`).then((d) => ({ symbol, d }))));
      const rows = [];
      for (const { symbol, d } of oi) {
        const contracts = Number(d?.openInterest);
        const m = mark.get(symbol);
        if (Number.isFinite(contracts) && Number.isFinite(m) && m > 0) rows.push({ symbol, exchange: 'binance', openInterestUsd: contracts * m });
      }
      return { source: 'binance', st: bin.status, rows };
    },
    // OKX: oiUsd per instrument.
    async () => {
      const res = await Promise.all(symbols.map((symbol) =>
        fetchJson(fetchImpl, `${OKX()}/api/v5/public/open-interest?instType=SWAP&instId=${encodeURIComponent(okxInst(symbol))}`).then((o) => ({ symbol, o }))));
      const rows = [];
      for (const { symbol, o } of res) {
        const usd = Number(o.data?.data?.[0]?.oiUsd);
        if (Number.isFinite(usd) && usd > 0) rows.push({ symbol, exchange: 'okx', openInterestUsd: usd });
      }
      return { source: 'okx', st: bestStatus(res.map((x) => x.o.status)), rows };
    },
    // Hyperliquid: openInterest (coins) × markPx.
    async () => {
      const hl = await hyperliquidCtxs(fetchImpl);
      const rows = [];
      for (const symbol of symbols) {
        const c = hl.byCoin.get(base(symbol));
        const coins = Number(c?.openInterest);
        const m = Number(c?.markPx);
        if (Number.isFinite(coins) && Number.isFinite(m) && m > 0) rows.push({ symbol, exchange: 'hyperliquid', openInterestUsd: coins * m });
      }
      return { source: 'hyperliquid', st: hl.st, rows };
    },
  ];
  // ONE venue per snapshot: the first with full coverage; otherwise the one
  // with the most symbols (ties → preference order).
  let best = null;
  for (const v of venues) {
    const r = await v();
    note(status, r.source, r.st, r.rows.length);
    if (r.rows.length === symbols.length) return r.rows;
    if (!best || r.rows.length > best.rows.length) best = r;
  }
  return best ? best.rows : [];
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
 * First venue that answers: Binance depth → Hyperliquid l2Book. Both are read
 * to the same 20 levels per side (Hyperliquid's maximum) with sizes in coins,
 * so depth in USD stays comparable when the venue changes.
 * Returns [{ symbol, exchange, bids, asks }].
 */
export const BOOK_LEVELS = 20;
export async function fetchOrderBooks(fetchImpl, symbols = symbolUniverse(), limit = BOOK_LEVELS, status) {
  const bin = await Promise.all(symbols.map((symbol) =>
    fetchJson(fetchImpl, `${BINANCE()}/fapi/v1/depth?symbol=${encodeURIComponent(symbol)}&limit=${limit}`).then((d) => ({ symbol, d }))));
  const rows = [];
  for (const { symbol, d } of bin) {
    if (d.data && Array.isArray(d.data.bids) && Array.isArray(d.data.asks)) {
      rows.push({ symbol, exchange: 'binance', bids: d.data.bids.slice(0, limit), asks: d.data.asks.slice(0, limit) });
    }
  }
  note(status, 'binance', bestStatus(bin.map((x) => x.d.status)), rows.length);
  if (rows.length) return rows;

  const hl = await Promise.all(symbols.map((symbol) =>
    fetchJson(fetchImpl, `${HYPERLIQUID()}/info`, {
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'l2Book', coin: base(symbol) }) },
    }).then((b) => ({ symbol, b }))));
  for (const { symbol, b } of hl) {
    const lv = b.data?.levels;
    if (Array.isArray(lv) && Array.isArray(lv[0]) && Array.isArray(lv[1]) && lv[0].length && lv[1].length) {
      const side = (l) => l.slice(0, limit).filter((x) => x && x.px != null && x.sz != null).map((x) => [x.px, x.sz]);
      rows.push({ symbol, exchange: 'hyperliquid', bids: side(lv[0]), asks: side(lv[1]) });
    }
  }
  note(status, 'hyperliquid', bestStatus(hl.map((x) => x.b.status)), rows.length);
  return rows;
}

export { safeJson, fetchJson, DEFAULT_TIMEOUT_MS };
