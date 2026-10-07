// Portfolio fit + correlation engine (Phase 6 item 7). Pure, fixed-point (Stage 13 library).
//
//   exposure      gross exposure before / after the candidate, as % of equity (Stage 18 valuePosition)
//   concentration the candidate instrument's share of equity after the trade; HHI of exposures after
//   correlation   Pearson correlation of the candidate's returns with each held position's returns,
//                 side-adjusted (a short flips the sign) and exposure-weighted
//   overlap       other active strategies of the same principal already trading the candidate instrument
// → a 0–100 portfolio_fit score (scorecard dimension) and a concentration verdict (scorecard hard gate).
import { valuePosition } from './pnl.mjs';
import { fx, fxInt, toDecimal, add, sub, mul, div, divInt, abs } from '../strategies/fixed.mjs';
import { isqrt } from '../engines/features.mjs';

export const PORTFOLIO_FIT_CONFIG = Object.freeze({
  version: 'portfolio-fit/1.0',
  maxInstrumentPct: '35',      // hard gate: one instrument > 35% of equity after the trade
  maxGrossExposurePct: '100',  // hard gate: gross exposure > 100% of equity after the trade
  softInstrumentPct: '20',     // score penalty starts above 20%
  correlationPenaltyFrom: '0.5', // weighted correlation above 0.5 starts costing points
  minOverlapReturns: 20,       // fewer aligned returns → correlation unknown (no credit, no penalty)
  penalties: Object.freeze({ concentration: 40, correlation: 35, overlap: 15, gross: 10 }), // max points lost each
});

const HUNDRED = fxInt(100);
const ONE = fxInt(1);
const clamp01 = (v) => (v < 0n ? 0n : v > ONE ? ONE : v);
const pts = (frac, max) => Number(mul(clamp01(frac), fxInt(max)) / 10n ** 18n);

/** Pearson correlation of two equal-length decimal-string series (fixed-point, in [-1, 1]); null if undefined. */
export function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const a = xs.slice(-n).map(fx); const b = ys.slice(-n).map(fx);
  const ma = divInt(a.reduce(add, 0n), n); const mb = divInt(b.reduce(add, 0n), n);
  let sab = 0n; let saa = 0n; let sbb = 0n;
  for (let i = 0; i < n; i += 1) {
    const da = sub(a[i], ma); const db = sub(b[i], mb);
    sab = add(sab, mul(da, db)); saa = add(saa, mul(da, da)); sbb = add(sbb, mul(db, db));
  }
  if (saa === 0n || sbb === 0n) return null;
  const denom = isqrt(mul(saa, sbb) * 10n ** 18n); // sqrt in fixed-point
  const r = div(sab, denom);
  return r > ONE ? ONE : r < -ONE ? -ONE : r;
}

/**
 * @param {{
 *   equity: string, quoteDecimals?: number,
 *   positions: { instrument, quantity, avgEntryPrice, mark, strategyId? }[],
 *   candidate: { instrument, side: 'buy'|'sell', notional: string, strategyId? },
 *   returns?: { [instrument]: string[] },      // aligned per-bar returns, oldest first
 *   activeStrategies?: { strategyId, instruments: string[] }[],
 * }} input
 */
export function assessPortfolioFit(input, cfg = PORTFOLIO_FIT_CONFIG) {
  const equity = fx(input.equity);
  if (equity <= 0n) throw Object.assign(new Error('equity must be > 0'), { code: 'INVALID' });
  const qd = input.quoteDecimals ?? 2;
  const cand = input.candidate;
  const candNotional = fx(cand.notional);
  const signedCand = cand.side === 'sell' ? -candNotional : candNotional;

  const exposures = new Map();
  for (const p of input.positions ?? []) {
    const v = valuePosition(p, p.mark, { quoteDecimals: qd });
    exposures.set(p.instrument, add(exposures.get(p.instrument) ?? 0n, fx(v.netExposure)));
  }
  const grossBefore = [...exposures.values()].reduce((s, v) => add(s, abs(v)), 0n);
  const after = new Map(exposures);
  after.set(cand.instrument, add(after.get(cand.instrument) ?? 0n, signedCand));
  const grossAfter = [...after.values()].reduce((s, v) => add(s, abs(v)), 0n);
  const instrAfter = abs(after.get(cand.instrument));
  const instrumentPct = mul(div(instrAfter, equity), HUNDRED);
  const grossPct = mul(div(grossAfter, equity), HUNDRED);
  const hhi = grossAfter === 0n ? 0n : [...after.values()].reduce((s, v) => { const w = div(abs(v), grossAfter); return add(s, mul(w, w)); }, 0n);

  // correlation with each OTHER held instrument, side-adjusted, exposure-weighted
  const candRet = input.returns?.[cand.instrument] ?? [];
  let wsum = 0n; let wcorr = 0n; const pairs = [];
  for (const [instr, exp] of exposures) {
    if (instr === cand.instrument || exp === 0n) continue;
    const r = input.returns?.[instr];
    if (!r || Math.min(r.length, candRet.length) < cfg.minOverlapReturns) { pairs.push({ instrument: instr, correlation: null }); continue; }
    let c = correlation(candRet, r);
    if (c == null) { pairs.push({ instrument: instr, correlation: null }); continue; }
    if ((cand.side === 'sell') !== (exp < 0n)) c = -c; // a hedge (opposite sides) flips the sign
    pairs.push({ instrument: instr, correlation: toDecimal(c) });
    wsum = add(wsum, abs(exp)); wcorr = add(wcorr, mul(c, abs(exp)));
  }
  const weightedCorr = wsum === 0n ? null : div(wcorr, wsum);

  const overlapping = (input.activeStrategies ?? []).filter((s) => s.strategyId !== cand.strategyId && s.instruments.includes(cand.instrument)).map((s) => s.strategyId);

  const flags = [];
  if (instrumentPct > fx(cfg.maxInstrumentPct)) flags.push('instrument_concentration');
  if (grossPct > fx(cfg.maxGrossExposurePct)) flags.push('gross_exposure');
  const p = cfg.penalties;
  const lost = {
    concentration: pts(div(sub(instrumentPct, fx(cfg.softInstrumentPct)), sub(fx(cfg.maxInstrumentPct), fx(cfg.softInstrumentPct))), p.concentration),
    correlation: weightedCorr == null ? 0 : pts(div(sub(weightedCorr, fx(cfg.correlationPenaltyFrom)), sub(ONE, fx(cfg.correlationPenaltyFrom))), p.correlation),
    overlap: Math.min(p.overlap, overlapping.length * Math.ceil(p.overlap / 2)),
    gross: pts(div(grossPct, fx(cfg.maxGrossExposurePct)), p.gross),
  };
  const score = Math.max(0, 100 - lost.concentration - lost.correlation - lost.overlap - lost.gross);
  return Object.freeze({
    configVersion: cfg.version, score,
    concentration: Object.freeze({ verdict: flags.length ? 'fail' : 'pass', flags: Object.freeze(flags), instrumentPct: toDecimal(instrumentPct), grossExposurePct: toDecimal(grossPct), hhi: toDecimal(hhi) }),
    exposure: Object.freeze({ grossBefore: toDecimal(grossBefore), grossAfter: toDecimal(grossAfter) }),
    correlation: Object.freeze({ weighted: weightedCorr == null ? null : toDecimal(weightedCorr), pairs: Object.freeze(pairs) }),
    overlap: Object.freeze({ strategies: Object.freeze(overlapping) }),
    penalties: Object.freeze(lost),
  });
}
