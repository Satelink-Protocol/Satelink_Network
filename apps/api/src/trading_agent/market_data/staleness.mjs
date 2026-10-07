// Staleness (Stage 11). Deterministic: `now` is always injected.
//
// Age is measured from the VENUE timestamp (quote.sourceTimestamp; candle
// closeTime when closed, updatedAt while open), never from local receipt time,
// so a quote that sat in a queue or cache is not mistaken for fresh data.
// A timestamp too far in the future (clock skew / bad feed) is also stale.
import { MarketDataError } from './types.mjs';

export const StalenessReason = Object.freeze({
  FRESH: 'fresh',
  STALE_AGE: 'stale_age',
  FUTURE_TIMESTAMP: 'future_timestamp',
  NOT_CLOSED_TOO_LONG: 'open_candle_not_updated',
});

/**
 * @param {object} policy { maxAgeMs: number, maxFutureSkewMs?: number }
 */
export function defineStalenessPolicy({ maxAgeMs, maxFutureSkewMs = 1_000 }) {
  if (!Number.isInteger(maxAgeMs) || maxAgeMs <= 0) throw new MarketDataError('CONFIG', 'maxAgeMs must be a positive integer');
  if (!Number.isInteger(maxFutureSkewMs) || maxFutureSkewMs < 0) throw new MarketDataError('CONFIG', 'maxFutureSkewMs must be >= 0');
  return Object.freeze({ maxAgeMs, maxFutureSkewMs });
}

function referenceTime(item) {
  if (item.kind === 'quote') return item.sourceTimestamp;
  if (item.kind === 'candle') return item.closed ? item.closeTime : item.updatedAt;
  throw new MarketDataError('INVALID_DATA', `unknown market-data kind ${item.kind}`);
}

/**
 * @returns frozen { ageMs, stale, reason, maxAgeMs, referenceTime, evaluatedAt }
 * Boundary: ageMs === maxAgeMs is still fresh; ageMs > maxAgeMs is stale.
 */
export function computeStaleness(item, policy, now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new MarketDataError('CONFIG', 'now must be a valid Date');
  const ref = referenceTime(item);
  const ageMs = now.getTime() - new Date(ref).getTime();
  let reason = StalenessReason.FRESH;
  if (ageMs < -policy.maxFutureSkewMs) reason = StalenessReason.FUTURE_TIMESTAMP;
  else if (ageMs > policy.maxAgeMs) reason = item.kind === 'candle' && !item.closed ? StalenessReason.NOT_CLOSED_TOO_LONG : StalenessReason.STALE_AGE;
  return Object.freeze({
    ageMs,
    stale: reason !== StalenessReason.FRESH,
    reason,
    maxAgeMs: policy.maxAgeMs,
    referenceTime: ref,
    evaluatedAt: now.toISOString(),
  });
}

/** Attach staleness metadata to a normalized item. */
export function withStaleness(item, policy, now) {
  return Object.freeze({ data: item, freshness: computeStaleness(item, policy, now) });
}

/**
 * Cache TTL that is guaranteed to be strictly below the staleness threshold, so
 * a cache can never hold an entry past the point it would be judged stale.
 */
export function cacheTtlFor(policy, requestedTtlMs = Math.floor(policy.maxAgeMs / 2)) {
  if (!Number.isInteger(requestedTtlMs) || requestedTtlMs <= 0) throw new MarketDataError('CONFIG', 'cache TTL must be a positive integer');
  if (requestedTtlMs >= policy.maxAgeMs) {
    throw new MarketDataError('CONFIG', `cache TTL ${requestedTtlMs}ms must be < staleness threshold ${policy.maxAgeMs}ms`);
  }
  return requestedTtlMs;
}
