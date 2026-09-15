// apps/api/src/intelligence/engine.js
//
// M3 — Derived trading intelligence engine: orchestration + snapshot cache.
//
//   refresh path:  fetch public data → compute derived metric → upsert snapshot
//   serve  path:   read latest snapshot → honest {available, stale, as_of, data}
//
// The serving routes NEVER fetch live upstream in the request path (keeps the
// paid call fast and cheap and immune to upstream flakiness). They read the
// snapshot cache; a background refresh keeps it warm. If a refresh got no fresh
// data the previous good snapshot is served with `stale:true`; if there is no
// snapshot at all the route returns available:false — never a fabricated value.
//
// `pool`, `fetchImpl`, and `now` are injected so this is fully unit-testable.

import {
  fundingRateHeatmap,
  openInterestShifts,
  liquidationClusters,
  marketMicrostructure,
  METRICS,
} from './compute.js';
import {
  fetchFundingRates,
  fetchOpenInterest,
  fetchMarkAndFunding,
  fetchOrderBooks,
} from './connectors.js';

// How old a snapshot may be before the serving route flags it `stale`.
export const FRESHNESS_WINDOW_SEC = Number(process.env.INTEL_FRESHNESS_SEC || 300);
// Default background refresh cadence.
export const REFRESH_INTERVAL_MS = Number(process.env.INTEL_REFRESH_MS || 120000);

export const METRIC_NAMES = Object.keys(METRICS);

export async function ensureIntelTables(pool) {
  if (!pool || !pool.query) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intelligence_snapshots (
      id          BIGSERIAL PRIMARY KEY,
      metric      TEXT NOT NULL,
      payload     JSONB NOT NULL,
      source_rows INTEGER NOT NULL DEFAULT 0,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_intel_snapshots_metric_time
      ON intelligence_snapshots (metric, captured_at DESC);
  `);
}

/** Latest stored snapshot row for a metric, or null. */
async function latestSnapshot(pool, metric) {
  const r = await pool.query(
    `SELECT payload, source_rows, captured_at
       FROM intelligence_snapshots
      WHERE metric = $1
      ORDER BY captured_at DESC, id DESC
      LIMIT 1`,
    [metric]
  );
  return r.rows[0] || null;
}

async function insertSnapshot(pool, metric, payload, sourceRows) {
  await pool.query(
    `INSERT INTO intelligence_snapshots (metric, payload, source_rows)
       VALUES ($1, $2, $3)`,
    [metric, JSON.stringify(payload), sourceRows | 0]
  );
}

/**
 * Compute one metric from freshly fetched public data and persist a snapshot.
 * Returns { metric, source_rows, stored } — stored=false when the fetch yielded
 * nothing (we do NOT overwrite a good snapshot with an empty one).
 */
export async function refreshMetric(pool, metric, { fetchImpl = globalThis.fetch } = {}) {
  if (!METRICS[metric]) throw new Error(`unknown metric: ${metric}`);
  if (!pool || !pool.query) return { metric, source_rows: 0, stored: false, reason: 'no_pool' };
  await ensureIntelTables(pool);

  let payload;
  let sourceRows = 0;

  if (metric === 'funding-rate-heatmap') {
    const rows = await fetchFundingRates(fetchImpl);
    sourceRows = rows.length;
    payload = fundingRateHeatmap(rows);
  } else if (metric === 'open-interest-shifts') {
    const current = await fetchOpenInterest(fetchImpl);
    sourceRows = current.length;
    // Prior baseline = the last snapshot's per-symbol absolute OI.
    const prev = await latestSnapshot(pool, metric);
    const previous = (prev?.payload?.symbols || [])
      .filter((s) => Number.isFinite(s.open_interest_usd))
      .map((s) => ({ symbol: s.symbol, openInterestUsd: s.open_interest_usd }));
    payload = openInterestShifts(current, previous);
  } else if (metric === 'liquidation-clusters') {
    const rows = await fetchMarkAndFunding(fetchImpl);
    sourceRows = rows.length;
    payload = liquidationClusters(rows);
  } else if (metric === 'market-microstructure') {
    const rows = await fetchOrderBooks(fetchImpl);
    sourceRows = rows.length;
    payload = marketMicrostructure(rows);
  }

  if (sourceRows === 0) {
    // Upstream gave us nothing — keep the last good snapshot, don't clobber it.
    return { metric, source_rows: 0, stored: false, reason: 'no_upstream_data' };
  }

  await insertSnapshot(pool, metric, payload, sourceRows);
  return { metric, source_rows: sourceRows, stored: true };
}

/** Refresh every metric; never throws (per-metric errors are captured). */
export async function refreshAll(pool, opts = {}) {
  const results = [];
  for (const metric of METRIC_NAMES) {
    try {
      results.push(await refreshMetric(pool, metric, opts));
    } catch (e) {
      results.push({ metric, source_rows: 0, stored: false, reason: `error:${e.message}` });
    }
  }
  return results;
}

/**
 * Read a metric for serving. Returns an honest envelope:
 *   { available:false, metric }                              — no snapshot yet
 *   { available:true, stale, as_of, age_sec, source_rows, data } — a snapshot
 * `stale` is true when the snapshot is older than FRESHNESS_WINDOW_SEC.
 */
export async function readMetric(pool, metric, { now = () => Date.now() } = {}) {
  if (!METRICS[metric]) return { available: false, metric, error: 'unknown_metric' };
  if (!pool || !pool.query) return { available: false, metric, error: 'no_pool' };
  await ensureIntelTables(pool);
  const snap = await latestSnapshot(pool, metric);
  if (!snap) return { available: false, metric };
  const capturedMs = new Date(snap.captured_at).getTime();
  const ageSec = Math.max(0, Math.floor((now() - capturedMs) / 1000));
  return {
    available: true,
    metric,
    as_of: new Date(capturedMs).toISOString(),
    age_sec: ageSec,
    stale: ageSec > FRESHNESS_WINDOW_SEC,
    source_rows: snap.source_rows,
    data: snap.payload,
  };
}

let _timer = null;
/**
 * Start the background refresh loop (idempotent). Fire-and-forget; never throws
 * into the event loop. Skips entirely when INTEL_REFRESH_ENABLED !== 'true'.
 */
export function startIntelRefresh(pool, { fetchImpl = globalThis.fetch, logger = console } = {}) {
  if (process.env.INTEL_REFRESH_ENABLED !== 'true') return null;
  if (_timer) return _timer;
  const tick = async () => {
    try {
      const res = await refreshAll(pool, { fetchImpl });
      const stored = res.filter((r) => r.stored).length;
      logger.log?.(`[Intel] refresh: ${stored}/${res.length} metrics updated`);
    } catch (e) {
      logger.error?.(`[Intel] refresh error: ${e.message}`);
    }
  };
  tick();
  _timer = setInterval(tick, REFRESH_INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  return _timer;
}

export function stopIntelRefresh() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
