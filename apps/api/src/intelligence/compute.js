// apps/api/src/intelligence/compute.js
//
// M3 — Derived trading intelligence: PURE computation core.
//
// Every function here is a pure function of its inputs (no I/O, no clock, no
// randomness) so the derived numbers Satelink SELLS are deterministic,
// reproducible, and unit-testable without a network or a database.
//
// LEGAL / LICENSING (see docs, audit/03_MONEY_GAPS.md, prompt §15):
//   Inputs are PUBLIC exchange market data (funding rates, open interest, order
//   book depth). Satelink does NOT redistribute raw feeds — it serves the
//   DERIVED analytics computed below (divergences, z-scores, aggregate shifts,
//   imbalance ratios). Serving a derived statistic, not the underlying quote,
//   is the defensible path. Raw-feed licensing per source is tracked as YELLOW
//   in the readiness report; the derived-serving is the mitigation.
//
// Each metric documents: inputs, calculation, and limitations, inline.

const HOURS_PER_YEAR = 24 * 365;

function isFiniteNum(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function round(x, dp = 6) {
  if (!isFiniteNum(x)) return null;
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

function mean(xs) {
  const v = xs.filter(isFiniteNum);
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function stddev(xs) {
  const v = xs.filter(isFiniteNum);
  if (v.length < 2) return null;
  const m = mean(v);
  const varr = v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1);
  return Math.sqrt(varr);
}

/**
 * Annualize a single per-interval funding rate.
 * Perp funding is charged every `intervalHours` (usually 8h). A rate of r per
 * interval compounds to approximately r * (HOURS_PER_YEAR / intervalHours)
 * simple-annualized (the market convention; not compounded, matching how desks
 * quote "funding APR").
 */
export function annualizeFunding(ratePerInterval, intervalHours = 8) {
  if (!isFiniteNum(ratePerInterval) || !isFiniteNum(intervalHours) || intervalHours <= 0) {
    return null;
  }
  return ratePerInterval * (HOURS_PER_YEAR / intervalHours);
}

/**
 * FUNDING-RATE HEATMAP + CROSS-EXCHANGE DIVERGENCE
 *
 * Input: rows = [{ symbol, exchange, fundingRate, intervalHours }]
 *   fundingRate = the most recent per-interval funding rate (decimal, e.g.
 *   0.0001 = 1bp). intervalHours defaults to 8.
 *
 * Output per symbol:
 *   - perExchange:   annualized funding APR at each exchange
 *   - meanApr:       cross-exchange mean annualized funding
 *   - divergenceApr: max(APR) - min(APR) across exchanges (the arbitrage edge,
 *                    gross of fees/borrow — a signal, not advice; see below)
 *   - long/short:    which exchange to be long vs short to harvest the spread
 *
 * Limitation: divergence is GROSS. Realized carry needs exchange fees, borrow,
 * and slippage which Satelink does not model here — the number is a screening
 * signal, explicitly NOT a personalized trade recommendation (prompt §14/§38).
 */
export function fundingRateHeatmap(rows) {
  const bySymbol = new Map();
  for (const r of rows || []) {
    if (!r || typeof r.symbol !== 'string' || !isFiniteNum(r.fundingRate)) continue;
    const apr = annualizeFunding(r.fundingRate, r.intervalHours ?? 8);
    if (apr === null) continue;
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol).push({ exchange: r.exchange || 'unknown', apr, fundingRate: r.fundingRate });
  }

  const symbols = [];
  for (const [symbol, entries] of bySymbol) {
    const aprs = entries.map((e) => e.apr);
    const maxE = entries.reduce((a, b) => (b.apr > a.apr ? b : a));
    const minE = entries.reduce((a, b) => (b.apr < a.apr ? b : a));
    symbols.push({
      symbol,
      per_exchange: entries
        .map((e) => ({ exchange: e.exchange, funding_apr: round(e.apr, 6), funding_rate: round(e.fundingRate, 8) }))
        .sort((a, b) => b.funding_apr - a.funding_apr),
      mean_apr: round(mean(aprs), 6),
      divergence_apr: entries.length >= 2 ? round(maxE.apr - minE.apr, 6) : 0,
      // To harvest positive divergence: SHORT the perp paying the higher
      // (more positive) funding, LONG the one paying the lower/negative.
      short_exchange: entries.length >= 2 ? maxE.exchange : null,
      long_exchange: entries.length >= 2 ? minE.exchange : null,
      exchanges: entries.length,
    });
  }
  // Hottest divergences first — the commercially interesting rows.
  symbols.sort((a, b) => (b.divergence_apr || 0) - (a.divergence_apr || 0));
  return {
    metric: 'funding-rate-heatmap',
    symbols,
    universe: symbols.length,
  };
}

/**
 * OPEN-INTEREST SHIFTS
 *
 * Input:
 *   current  = [{ symbol, exchange, openInterestUsd }]
 *   previous = [{ symbol, exchange, openInterestUsd }]  (a prior snapshot)
 * Output per symbol: aggregate OI now vs prior, absolute and percent change.
 *
 * Limitation: change is only as granular as the snapshot cadence (refresh
 * interval). `previous` empty → change is null (honest "no baseline yet"),
 * never a fabricated 0.
 */
export function openInterestShifts(current, previous) {
  const agg = (rows) => {
    const m = new Map();
    for (const r of rows || []) {
      if (!r || typeof r.symbol !== 'string' || !isFiniteNum(r.openInterestUsd)) continue;
      m.set(r.symbol, (m.get(r.symbol) || 0) + r.openInterestUsd);
    }
    return m;
  };
  const now = agg(current);
  const then = agg(previous);
  const symbols = [];
  for (const [symbol, oiNow] of now) {
    const oiThen = then.has(symbol) ? then.get(symbol) : null;
    const deltaUsd = oiThen === null ? null : oiNow - oiThen;
    const pct = oiThen && oiThen > 0 ? (oiNow - oiThen) / oiThen : null;
    symbols.push({
      symbol,
      open_interest_usd: round(oiNow, 2),
      prior_open_interest_usd: oiThen === null ? null : round(oiThen, 2),
      change_usd: deltaUsd === null ? null : round(deltaUsd, 2),
      change_pct: pct === null ? null : round(pct, 6),
    });
  }
  symbols.sort((a, b) => Math.abs(b.change_pct || 0) - Math.abs(a.change_pct || 0));
  return {
    metric: 'open-interest-shifts',
    symbols,
    has_baseline: then.size > 0,
    universe: symbols.length,
  };
}

/**
 * LIQUIDATION-CLUSTERS  (explicitly a MODEL PROXY, not exchange liquidation data)
 *
 * Public REST no longer exposes reliable aggregate liquidation order streams
 * (Binance retired the all-market forceOrders endpoint). Rather than fabricate,
 * this derives a liquidation-PRESSURE proxy from public inputs and labels it as
 * a model, per prompt §14 (document limitations) and §35 (never fake).
 *
 * Model: for a mark price P and a set of representative leverage bands L, a long
 * opened at P is liquidated near P*(1 - 1/L) and a short near P*(1 + 1/L). We
 * report these price bands as clusters, weighted by |funding| as a crowding
 * proxy (heavier one-sided funding ⇒ more crowded directional leverage ⇒ more
 * liquidation fuel on the opposite side). This is a heuristic screen, NOT a
 * measurement of resting liquidation orders.
 *
 * Input: [{ symbol, markPrice, fundingRate }], levels default [10,25,50,100].
 */
export function liquidationClusters(rows, levels = [10, 25, 50, 100]) {
  const symbols = [];
  for (const r of rows || []) {
    if (!r || typeof r.symbol !== 'string' || !isFiniteNum(r.markPrice) || r.markPrice <= 0) continue;
    const fund = isFiniteNum(r.fundingRate) ? r.fundingRate : 0;
    // Positive funding ⇒ longs pay shorts ⇒ crowded longs ⇒ downside liq fuel.
    const longCrowding = Math.max(0, fund);
    const shortCrowding = Math.max(0, -fund);
    const clusters = [];
    for (const L of levels) {
      if (!isFiniteNum(L) || L <= 1) continue;
      clusters.push({
        side: 'long_liquidation',
        leverage: L,
        price: round(r.markPrice * (1 - 1 / L), 2),
        crowding_weight: round(longCrowding, 8),
      });
      clusters.push({
        side: 'short_liquidation',
        leverage: L,
        price: round(r.markPrice * (1 + 1 / L), 2),
        crowding_weight: round(shortCrowding, 8),
      });
    }
    symbols.push({ symbol: r.symbol, mark_price: round(r.markPrice, 2), clusters });
  }
  return {
    metric: 'liquidation-clusters',
    model: 'leverage-band-proxy',
    disclaimer:
      'Derived model proxy from public mark price + funding, NOT measured exchange liquidation orders.',
    symbols,
    universe: symbols.length,
  };
}

/**
 * MARKET-MICROSTRUCTURE
 *
 * Input: [{ symbol, exchange, bids, asks }] where bids/asks are
 *   [[price, size], ...] from a public order-book depth snapshot.
 * Output per symbol: mid, spread (abs + bps), top-of-book and depth imbalance.
 *
 * Depth imbalance = (bidDepth - askDepth) / (bidDepth + askDepth) over the
 * provided levels; range [-1, 1], + means bid-heavy. A structural signal.
 */
export function marketMicrostructure(rows) {
  const symbols = [];
  for (const r of rows || []) {
    if (!r || typeof r.symbol !== 'string' || !Array.isArray(r.bids) || !Array.isArray(r.asks)) continue;
    const bids = r.bids.map((b) => [Number(b[0]), Number(b[1])]).filter((b) => isFiniteNum(b[0]) && isFiniteNum(b[1]));
    const asks = r.asks.map((a) => [Number(a[0]), Number(a[1])]).filter((a) => isFiniteNum(a[0]) && isFiniteNum(a[1]));
    if (bids.length === 0 || asks.length === 0) continue;
    const bestBid = Math.max(...bids.map((b) => b[0]));
    const bestAsk = Math.min(...asks.map((a) => a[0]));
    if (!(bestAsk > 0) || !(bestBid > 0) || bestAsk < bestBid) continue;
    const mid = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const bidDepth = bids.reduce((s, b) => s + b[0] * b[1], 0);
    const askDepth = asks.reduce((s, a) => s + a[0] * a[1], 0);
    const totalDepth = bidDepth + askDepth;
    symbols.push({
      symbol: r.symbol,
      exchange: r.exchange || 'unknown',
      mid: round(mid, 4),
      best_bid: round(bestBid, 4),
      best_ask: round(bestAsk, 4),
      spread: round(spread, 6),
      spread_bps: round((spread / mid) * 10000, 3),
      bid_depth_usd: round(bidDepth, 2),
      ask_depth_usd: round(askDepth, 2),
      depth_imbalance: totalDepth > 0 ? round((bidDepth - askDepth) / totalDepth, 6) : null,
    });
  }
  symbols.sort((a, b) => (a.spread_bps ?? Infinity) - (b.spread_bps ?? Infinity));
  return {
    metric: 'market-microstructure',
    symbols,
    universe: symbols.length,
  };
}

/** Registry of the derived metrics this product serves. */
export const METRICS = {
  'funding-rate-heatmap': {
    price_usdt: 0.01,
    kind: 'derived',
    description: 'Annualized funding APR per symbol/exchange with cross-exchange divergence.',
  },
  'open-interest-shifts': {
    price_usdt: 0.01,
    kind: 'derived',
    description: 'Aggregate open-interest change vs the prior snapshot, per symbol.',
  },
  'liquidation-clusters': {
    price_usdt: 0.01,
    kind: 'derived-model',
    description: 'Leverage-band liquidation-pressure proxy (model, not measured orders).',
  },
  'market-microstructure': {
    price_usdt: 0.01,
    kind: 'derived',
    description: 'Spread, top-of-book, and depth imbalance from public order books.',
  },
};

export { round, mean, stddev };
