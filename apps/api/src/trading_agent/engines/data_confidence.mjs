// Data-confidence engine (Phase 6 item 4). Pure: candles + quotes from one or more sources + now →
// a 0–100 integer score and its parts. Reuses the Stage 11 staleness policy for freshness.
//   freshness    newest item's staleness (venue timestamp, not receipt time)
//   completeness missing bars in the expected interval grid (gaps), duplicates
//   agreement    max deviation between sources' last prices (bps)
import { DATA_CONFIDENCE_CONFIG } from './config.mjs';
import { defineStalenessPolicy, computeStaleness } from '../market_data/staleness.mjs';
import { INTERVAL_MS } from '../market_data/types.mjs';
import { fx, fxInt, toDecimal, sub, div, mul, abs, divInt } from '../strategies/fixed.mjs';

const BPS = fxInt(10_000);

/**
 * @param {{ candles: object[], quotes?: object[], now: Date }} input
 *   candles: normalized candles (Stage 11) for one instrument/interval, oldest first
 *   quotes:  normalized quotes for the same instrument from DIFFERENT sources (optional)
 */
export function assessDataConfidence({ candles, quotes = [], now }, cfg = DATA_CONFIDENCE_CONFIG) {
  const issues = [];
  if (!candles?.length) return Object.freeze({ configVersion: cfg.version, score: 0, parts: { freshness: 0, completeness: 0, agreement: 0 }, issues: ['no candles'], gaps: 0, duplicates: 0, maxSourceDeviationBps: null });
  const policy = defineStalenessPolicy({ maxAgeMs: cfg.maxAgeMs });
  const newest = quotes.length ? [candles.at(-1), ...quotes] : [candles.at(-1)];
  const stale = newest.map((it) => computeStaleness(it, policy, now)).filter((s) => s.stale);
  const freshness = stale.length === 0 ? 1 : 0;
  if (stale.length) issues.push(`stale: ${stale.map((s) => s.reason).join(', ')}`);

  const step = INTERVAL_MS[candles[0].interval];
  const times = candles.map((c) => new Date(c.openTime).getTime());
  let gaps = 0; let duplicates = 0;
  for (let i = 1; i < times.length; i += 1) {
    const d = times[i] - times[i - 1];
    if (d === 0) duplicates += 1;
    else if (d > step) gaps += Math.round(d / step) - 1;
    else if (d < 0 || d % step !== 0) issues.push(`misaligned bar at ${candles[i].openTime}`);
  }
  const expected = candles.length + gaps;
  const gapRatio = div(fxInt(gaps), fxInt(expected));
  const completenessFx = duplicates > 0 || gapRatio > fx(cfg.maxGapRatio) ? 0n : sub(fxInt(1), div(gapRatio, fx(cfg.maxGapRatio)));
  if (gaps) issues.push(`${gaps} missing bar(s)`);
  if (duplicates) issues.push(`${duplicates} duplicate bar(s)`);

  let maxDev = null; let agreementFx = fxInt(1);
  const prices = [fx(candles.at(-1).close), ...quotes.map((q) => divInt(fx(q.bid) + fx(q.ask), 2))];
  if (prices.length > 1) {
    const ref = prices[0];
    maxDev = prices.slice(1).reduce((m, p) => { const dv = mul(div(abs(sub(p, ref)), ref), BPS); return dv > m ? dv : m; }, 0n);
    const limit = fx(cfg.maxSourceDeviationBps);
    agreementFx = maxDev >= limit ? 0n : sub(fxInt(1), div(maxDev, limit));
    if (maxDev > limit) issues.push(`sources disagree by ${toDecimal(maxDev)} bps`);
  }
  const w = cfg.weights;
  const scoreFx = mul(fxInt(w.freshness), fxInt(freshness)) + mul(fxInt(w.completeness), completenessFx) + mul(fxInt(w.agreement), agreementFx);
  const score = Number(scoreFx / 10n ** 18n); // floor to an integer 0–100
  return Object.freeze({
    configVersion: cfg.version, score,
    parts: Object.freeze({ freshness: freshness * w.freshness, completeness: Number(mul(fxInt(w.completeness), completenessFx) / 10n ** 18n), agreement: Number(mul(fxInt(w.agreement), agreementFx) / 10n ** 18n) }),
    issues: Object.freeze(issues), gaps, duplicates, maxSourceDeviationBps: maxDev == null ? null : toDecimal(maxDev),
  });
}
