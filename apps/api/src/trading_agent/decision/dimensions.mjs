// Scorecard dimensions (Phase 6 item 6). Pure: inputs → integer 0–100 per dimension, or null when
// the input is missing (a missing dimension scores 0 in the total and lowers confidence — it never
// silently counts as neutral). Arithmetic on decimal strings via the Stage 13 fixed-point library.
import { fx, fxInt, toDecimal, div, mul, sub, add } from '../strategies/fixed.mjs';

const ONE_HUNDRED = fxInt(100);
/** fixed-point → integer 0–100, clamped, floor. */
const clampInt = (v) => { const n = v < 0n ? 0n : v > ONE_HUNDRED ? ONE_HUNDRED : v; return Number(n / 10n ** 18n); };
/** linear map of x from [lo, hi] onto [0, 100]. */
const lin = (x, lo, hi) => clampInt(div(mul(sub(x, fx(lo)), ONE_HUNDRED), sub(fx(hi), fx(lo))));

export const DIMENSIONS = Object.freeze(['strategy_edge', 'backtest_quality', 'out_of_sample', 'risk_quality', 'reward_risk', 'regime_fit', 'portfolio_fit', 'execution_quality', 'robustness', 'data_confidence']);

export function scoreDimensions(i, cfg) {
  const bt = i.backtest?.metrics;
  const wf = i.walkForward?.summary;
  const st = i.stress;
  const d = {};
  // strategy edge: backtest return −10% → 0 … +20% → 100, scaled by win rate ≥ 40%
  d.strategy_edge = bt ? Math.round(lin(fx(bt.returnPct), '-10', '20') * Math.min(1, Number(bt.winRatePct) / 40)) : null;
  // backtest quality: sample size, minus data gaps / stale bars / truncation
  d.backtest_quality = bt ? Math.max(0, Math.min(100, Math.round((Math.min(bt.trades, cfg.minTrades) / cfg.minTrades) * 100)) - 10 * (bt.dataGaps > 0) - 10 * (bt.staleBars > 0) - 30 * (i.backtest.truncated === true)) : null;
  // out of sample: walk-forward efficiency 0 → 0 … 1 → 100, averaged with profitable OOS windows %
  d.out_of_sample = wf ? (wf.efficiency == null ? 0 : Math.round((lin(fx(wf.efficiency), '0', '1') + lin(fx(wf.profitableOosPct), '0', '100')) / 2)) : null;
  // risk quality: max drawdown 40% → 0 … 0% → 100 (worse of backtest and stress p95)
  const ddWorst = bt ? (st?.bootstrap ? (fx(st.bootstrap.maxDrawdownPct.p95) > fx(bt.maxDrawdownPct) ? st.bootstrap.maxDrawdownPct.p95 : bt.maxDrawdownPct) : bt.maxDrawdownPct) : null;
  d.risk_quality = ddWorst == null ? null : lin(sub(fxInt(40), fx(ddWorst)), '0', '40');
  // reward / risk: return% ÷ maxDD% from 0 → 0 … 3 → 100
  d.reward_risk = bt ? (fx(bt.maxDrawdownPct) === 0n ? (fx(bt.returnPct) > 0n ? 100 : 0) : lin(div(fx(bt.returnPct), fx(bt.maxDrawdownPct)), '0', '3')) : null;
  // regime fit: abnormal 0, uncertain 20; preferred regimes declared by the strategy → 100 / 30; else 50
  if (!i.regime) d.regime_fit = null;
  else if (i.regime.primary === 'abnormal') d.regime_fit = 0;
  else if (i.regime.primary === 'uncertain') d.regime_fit = 20;
  else if (Array.isArray(i.strategy?.preferredRegimes)) d.regime_fit = i.regime.labels.some((l) => i.strategy.preferredRegimes.includes(l)) ? 100 : 30;
  else d.regime_fit = 50;
  // portfolio fit: the item-7 engine's score
  d.portfolio_fit = Number.isInteger(i.portfolioFit?.score) ? Math.max(0, Math.min(100, i.portfolioFit.score)) : null;
  // execution quality: estimated slippage vs the modelled slippage the backtest assumed
  if (i.liquidity?.fill?.slippageBps != null && i.modelledSlippageBps != null) {
    const excess = sub(fx(i.liquidity.fill.slippageBps), fx(i.modelledSlippageBps));
    d.execution_quality = lin(sub(fx(cfg.maxModelledVsRealisedSlippageBps), excess), '0', cfg.maxModelledVsRealisedSlippageBps);
  } else d.execution_quality = null;
  // robustness: 2× fees still profitable (40) + bootstrap P(loss) (40) + worst gap scenario not < −20% (20)
  if (st) {
    const fee2 = st.feeShocks?.[0]; const pl = st.bootstrap ? fx(st.bootstrap.probabilityOfLossPct) : ONE_HUNDRED;
    const worstGap = (st.gapScenarios ?? []).reduce((m, g) => (fx(g.returnPct) < m ? fx(g.returnPct) : m), fxInt(0));
    d.robustness = (fee2 && fx(fee2.netPnl) > 0n ? 40 : 0) + Math.round(lin(sub(ONE_HUNDRED, pl), '0', '100') * 0.4) + (worstGap >= fx('-20') ? 20 : 0);
  } else d.robustness = null;
  d.data_confidence = Number.isInteger(i.dataConfidence?.score) ? i.dataConfidence.score : null;
  return Object.freeze(d);
}

/** Weighted total, integer 0–100. Missing dimensions contribute 0. */
export function totalScore(dims, cfg) {
  let s = 0;
  for (const k of DIMENSIONS) s += (dims[k] ?? 0) * cfg.weights[k];
  return Math.floor(s / 100);
}

/**
 * Confidence (0–100), separate from the score: how much evidence stands behind it.
 *   40 × sample size (trades / minTrades) + 35 × IS/OOS agreement + 25 × data confidence − 5 per missing dimension
 */
export function confidenceOf(i, dims, cfg) {
  const trades = i.backtest?.metrics?.trades ?? 0;
  const sample = Math.min(1, trades / cfg.minTrades);
  const wf = i.walkForward?.summary;
  let agreement = 0;
  if (wf && wf.efficiency != null) {
    const sameSign = (fx(wf.inSamplePnl) > 0n) === (fx(wf.outOfSamplePnl) > 0n);
    agreement = sameSign ? Math.min(1, Math.max(0, Number(wf.efficiency))) : 0;
  }
  const data = (dims.data_confidence ?? 0) / 100;
  const missing = DIMENSIONS.filter((k) => dims[k] == null).length;
  return Math.max(0, Math.min(100, Math.floor(40 * sample + 35 * agreement + 25 * data) - 5 * missing));
}

export { toDecimal, add };
