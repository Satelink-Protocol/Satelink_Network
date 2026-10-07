// Regime engine (Phase 6 item 4). Pure: bars + data confidence + versioned config → regime.
//   primary:    uncertain | abnormal | trending | ranging   (precedence in that order)
//   volatility: high_vol | low_vol | normal
//   labels:     [primary, volatility unless normal] — the six regime labels of the locked definition
import { REGIME_CONFIG } from './config.mjs';
import { ema, atr, volatility } from './features.mjs';
import { fx, toDecimal, sub, div, mul, abs } from '../strategies/fixed.mjs';

export const Regime = Object.freeze({ UNCERTAIN: 'uncertain', ABNORMAL: 'abnormal', TRENDING: 'trending', RANGING: 'ranging', HIGH_VOL: 'high_vol', LOW_VOL: 'low_vol' });

/**
 * @param bars fixed-point bars (oldest first, see features.barsFromCandles)
 * @param {{ dataConfidence?: number }} ctx  0–100 from data_confidence.mjs
 */
export function classifyRegime(bars, { dataConfidence = 100 } = {}, cfg = REGIME_CONFIG) {
  const base = { configVersion: cfg.version, bars: bars.length };
  if (bars.length < cfg.minBars) return Object.freeze({ ...base, primary: Regime.UNCERTAIN, volatility: 'normal', direction: null, labels: [Regime.UNCERTAIN], reasons: [`insufficient history (${bars.length} < ${cfg.minBars})`], metrics: {} });
  if (dataConfidence < cfg.minDataConfidence) return Object.freeze({ ...base, primary: Regime.UNCERTAIN, volatility: 'normal', direction: null, labels: [Regime.UNCERTAIN], reasons: [`data confidence ${dataConfidence} < ${cfg.minDataConfidence}`], metrics: {} });

  const last = bars.at(-1); const prev = bars.at(-2);
  const fast = ema(bars.map((b) => b.close), cfg.emaFast).at(-1);
  const slow = ema(bars.map((b) => b.close), cfg.emaSlow).at(-1);
  const atrNow = atr(bars, cfg.atrPeriod).at(-1);
  const vol = volatility(bars, cfg.volPeriod).at(-1);
  const trendStrength = abs(div(sub(fast, slow), last.close));
  const rangeOverAtr = atrNow === 0n ? 0n : div(sub(last.high, last.low), atrNow);
  const gap = prev.close === 0n ? 0n : abs(div(sub(last.open, prev.close), prev.close));
  const metrics = { emaFast: toDecimal(fast), emaSlow: toDecimal(slow), atr: toDecimal(atrNow), volatility: toDecimal(vol), trendStrength: toDecimal(trendStrength), rangeOverAtr: toDecimal(rangeOverAtr), gap: toDecimal(gap) };

  const volState = vol >= fx(cfg.highVolThreshold) ? Regime.HIGH_VOL : vol <= fx(cfg.lowVolThreshold) ? Regime.LOW_VOL : 'normal';
  const reasons = [];
  let primary;
  if (rangeOverAtr >= fx(cfg.abnormalRangeAtr)) { primary = Regime.ABNORMAL; reasons.push(`bar range ${toDecimal(rangeOverAtr)} × ATR ≥ ${cfg.abnormalRangeAtr}`); }
  else if (gap >= fx(cfg.abnormalGap)) { primary = Regime.ABNORMAL; reasons.push(`gap ${toDecimal(gap)} ≥ ${cfg.abnormalGap}`); }
  else if (trendStrength >= fx(cfg.trendThreshold)) { primary = Regime.TRENDING; reasons.push(`trend strength ${toDecimal(trendStrength)} ≥ ${cfg.trendThreshold}`); }
  else { primary = Regime.RANGING; reasons.push(`trend strength ${toDecimal(trendStrength)} < ${cfg.trendThreshold}`); }
  const direction = primary === Regime.TRENDING ? (fast > slow ? 'up' : 'down') : null;
  const labels = volState === 'normal' ? [primary] : [primary, volState];
  return Object.freeze({ ...base, primary, volatility: volState, direction, labels, reasons, metrics: Object.freeze(metrics) });
}
