// Walk-forward validation (Phase 6 item 5) on the Stage 14 simulator. The strategy version is FIXED
// (no re-optimisation): each window runs the same definition and params in-sample and out-of-sample,
// so the result measures how well in-sample behaviour carries over to unseen data.
//   rolling:  IS = [s, s+IS)            OOS = [s+IS, s+IS+OOS)       s += step
//   anchored: IS = [0, s+IS)            OOS = same
// An OOS run includes `warmupBars` of history before the window so indicators are warm, but only
// trades ENTERED inside the window count.
import { runBacktest } from '../backtest/run.mjs';
import { fx, toDecimal, add, div, fxInt } from '../strategies/fixed.mjs';
import { WALK_FORWARD_CONFIG } from './config.mjs';
import { ValidationError, barTimes, timeOf, seal } from './common.mjs';

const entryMs = (t) => (typeof t.entryTime === 'number' ? t.entryTime : Date.parse(t.entryTime));
const sumPnl = (trades) => trades.reduce((s, t) => add(s, fx(t.pnl)), 0n);

export function walkForward({ parsed, params, candles }, cfg = WALK_FORWARD_CONFIG) {
  const times = barTimes(candles);
  const { inSampleBars: IS, outOfSampleBars: OOS, stepBars: STEP, warmupBars: WARM } = cfg;
  const slice = (from, to) => { const lo = times[from]; const hi = times[to - 1]; return candles.filter((c) => timeOf(c) >= lo && timeOf(c) <= hi); };
  const windows = [];
  for (let s = 0; s + IS + OOS <= times.length; s += STEP) {
    const isFrom = cfg.anchored ? 0 : s;
    const isTo = s + IS; const oosTo = isTo + OOS;
    const isRes = runBacktest({ parsed, params, candles: slice(isFrom, isTo) });
    const oosRes = runBacktest({ parsed, params, candles: slice(Math.max(0, isTo - WARM), oosTo) });
    const oosStartMs = times[isTo];
    const oosStart = new Date(oosStartMs).toISOString();
    const oosTrades = oosRes.trades.filter((t) => entryMs(t) >= oosStartMs); // trade times are epoch ms (Stage 14)
    const isPnl = sumPnl(isRes.trades); const oosPnl = sumPnl(oosTrades);
    windows.push({
      index: windows.length,
      inSample: { from: new Date(times[isFrom]).toISOString(), bars: isTo - isFrom, trades: isRes.trades.length, pnl: toDecimal(isPnl), maxDrawdownPct: isRes.metrics.maxDrawdownPct },
      outOfSample: { from: oosStart, bars: OOS, trades: oosTrades.length, pnl: toDecimal(oosPnl), wins: oosTrades.filter((t) => fx(t.pnl) > 0n).length },
    });
  }
  if (windows.length < cfg.minWindows) throw new ValidationError('INSUFFICIENT_HISTORY', `walk-forward needs ≥ ${cfg.minWindows} windows (${IS}+${OOS} bars, step ${STEP}); got ${windows.length} from ${times.length} bars`);

  const isPnl = windows.reduce((s, w) => add(s, fx(w.inSample.pnl)), 0n);
  const oosPnl = windows.reduce((s, w) => add(s, fx(w.outOfSample.pnl)), 0n);
  const isBars = windows.reduce((s, w) => s + w.inSample.bars, 0);
  const oosBars = windows.length * OOS;
  // efficiency = OOS P&L per bar ÷ IS P&L per bar (null when IS made no money: undefined, not "good")
  const isPerBar = div(isPnl, fxInt(isBars));
  const efficiency = isPerBar > 0n ? div(div(oosPnl, fxInt(oosBars)), isPerBar) : null;
  const profitable = windows.filter((w) => fx(w.outOfSample.pnl) > 0n).length;
  return seal({
    kind: 'walk_forward', configVersion: cfg.version, definitionHash: parsed.hash, anchored: cfg.anchored,
    summary: {
      windows: windows.length, inSamplePnl: toDecimal(isPnl), outOfSamplePnl: toDecimal(oosPnl),
      outOfSampleTrades: windows.reduce((s, w) => s + w.outOfSample.trades, 0),
      profitableOosWindows: profitable, profitableOosPct: toDecimal(div(fxInt(profitable * 100), fxInt(windows.length))),
      efficiency: efficiency == null ? null : toDecimal(efficiency),
    },
    windows,
  });
}
