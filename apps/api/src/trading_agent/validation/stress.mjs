// Stress / Monte Carlo validation (Phase 6 item 5) on the Stage 14 simulator.
//   bootstrap  — resample the closed trades' P&L WITH replacement (seeded) → distribution of final
//                equity and max drawdown; probability of loss and of ruin
//   cost shock — re-run the backtest with fees × k and slippage × k
//   gaps       — re-run with a multiplicative price gap applied from the middle bar onwards
import { runBacktest } from '../backtest/run.mjs';
import { fx, toDecimal, add, sub, mul, div, fxInt } from '../strategies/fixed.mjs';
import { STRESS_CONFIG } from './config.mjs';
import { ValidationError, barTimes, timeOf, seal, mulberry32 } from './common.mjs';

const pct = (n, d) => (d === 0n ? 0n : mul(div(n, d), fxInt(100)));
function quantile(sorted, q) { // nearest-rank on a sorted bigint array; q in [0,1] as a JS number with ≤ 2 decimals
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/** Seeded trade-order bootstrap over closed-trade P&Ls (decimal strings). */
export function bootstrapTrades({ trades, initialCash, iterations, seed, ruinDrawdownPct }) {
  const pnls = trades.map((t) => fx(t.pnl));
  if (pnls.length === 0) throw new ValidationError('NO_TRADES', 'bootstrap needs at least one closed trade');
  const initial = fx(initialCash); const ruin = fx(ruinDrawdownPct);
  const rnd = mulberry32(seed);
  const finals = []; const dds = []; let losses = 0; let ruins = 0;
  for (let k = 0; k < iterations; k += 1) {
    let eq = initial; let peak = initial; let maxDd = 0n;
    for (let j = 0; j < pnls.length; j += 1) {
      eq = add(eq, pnls[Math.floor(rnd() * pnls.length)]);
      if (eq > peak) peak = eq;
      const dd = pct(sub(peak, eq), peak);
      if (dd > maxDd) maxDd = dd;
    }
    finals.push(eq); dds.push(maxDd);
    if (eq < initial) losses += 1;
    if (maxDd >= ruin) ruins += 1;
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  finals.sort(cmp); dds.sort(cmp);
  const q = (arr) => ({ p5: toDecimal(quantile(arr, 0.05)), p50: toDecimal(quantile(arr, 0.5)), p95: toDecimal(quantile(arr, 0.95)) });
  return {
    iterations, seed, tradesPerPath: pnls.length,
    finalEquity: q(finals), maxDrawdownPct: q(dds),
    probabilityOfLossPct: toDecimal(div(fxInt(losses * 100), fxInt(iterations))),
    probabilityOfRuinPct: toDecimal(div(fxInt(ruins * 100), fxInt(iterations))),
  };
}

/** Candles with every OHLC price multiplied by (1 + gap) from bar index `at` onwards. */
export function applyGap(candles, at, gap) {
  const times = barTimes(candles);
  const t0 = times[at];
  const f = add(fxInt(1), fx(gap));
  const scale = (v) => toDecimal(mul(fx(v), f));
  return candles.map((c) => (timeOf(c) >= t0 ? { ...c, open: scale(c.open), high: scale(c.high), low: scale(c.low), close: scale(c.close) } : c));
}

const brief = (r) => ({ netPnl: r.metrics.netPnl, returnPct: r.metrics.returnPct, maxDrawdownPct: r.metrics.maxDrawdownPct, trades: r.metrics.trades, feesPaid: r.metrics.feesPaid, slippageCost: r.metrics.slippageCost });
const times = (s, k) => toDecimal(mul(fx(s), fx(k)));

export function stressTest({ parsed, params, candles }, cfg = STRESS_CONFIG) {
  const baseline = runBacktest({ parsed, params, candles });
  const fees = params.fees ?? {};
  const feeShocks = cfg.feeMultipliers.map((k) => ({ multiplier: k, ...brief(runBacktest({ parsed, params: { ...params, fees: { takerBps: times(fees.takerBps ?? '10', k), makerBps: times(fees.makerBps ?? '10', k) } }, candles })) }));
  const slippageShocks = cfg.slippageMultipliers.map((k) => ({ multiplier: k, ...brief(runBacktest({ parsed, params: { ...params, slippageBps: times(params.slippageBps ?? '5', k) }, candles })) }));
  const mid = Math.floor(barTimes(candles).length / 2);
  const gapScenarios = cfg.gaps.map((g) => ({ gap: g, atBar: mid, ...brief(runBacktest({ parsed, params, candles: applyGap(candles, mid, g) })) }));
  const bootstrap = baseline.trades.length
    ? bootstrapTrades({ trades: baseline.trades, initialCash: params.initialCash, iterations: cfg.iterations, seed: cfg.seed, ruinDrawdownPct: cfg.ruinDrawdownPct })
    : null;
  return seal({
    kind: 'stress', configVersion: cfg.version, definitionHash: parsed.hash, baselineResultHash: baseline.resultHash,
    baseline: brief(baseline), bootstrap, feeShocks, slippageShocks, gapScenarios,
  });
}
