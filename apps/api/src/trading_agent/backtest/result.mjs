// Sealing results and deriving Stage 13 lifecycle evidence (Stage 14).
import { canonicalJson, contentHash, deepFreeze } from '../strategies/canonical.mjs';

/** Attach provenance hashes and a resultHash over the canonical result. */
export function sealResult(core, extras) {
  const body = { ...structuredClone(core), ...extras };
  return deepFreeze({ ...body, resultHash: contentHash(canonicalJson(body)) });
}

/** The parts that must be identical between a backtest and a paper run on the same data. */
export function parityView(result) {
  const { signals, orders, fills, trades, rejects, metrics, openPositions, passed } = result;
  return { signals, orders, fills, trades, rejects, metrics, openPositions, passed };
}

/** Evidence for DRAFT → BACKTESTED (strategies/lifecycle.mjs `backtest` schema). */
export function backtestEvidence(row) {
  return { backtestId: row.id, definitionHash: row.definitionHash, bars: row.bars, passed: row.passed === true };
}

/** Evidence for PAPER → LIVE_SMALL (`paper` schema): whole days covered and closed trades. */
export function paperEvidence(row) {
  const { firstOpenTime, lastCloseTime } = row.result.period;
  const days = firstOpenTime === null ? 0 : Math.floor((lastCloseTime - firstOpenTime) / 86_400_000);
  return { paperRunId: row.id, definitionHash: row.definitionHash, days, trades: row.result.metrics.trades };
}
