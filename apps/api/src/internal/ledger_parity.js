/**
 * Ledger parity endpoint (M3 — ledger in shadow).
 *
 * GET /internal/ledger-parity — measures how closely the shadow ledger tracks
 * the legacy revenue_events_v2 table. READ-ONLY, and used only for measurement:
 * nothing here (or anywhere) reads the ledger to make a decision.
 *
 * Parity is measured on REAL revenue only: is_test_data rows are excluded on the
 * revenue side, and the shadow writer never writes test-data rows to the ledger
 * (invariant #10).
 *
 * Ledger-side exclusion (2026-08-27): the shadow writer skips test-data rows
 * going FORWARD, but rows reclassified to is_test_data=true AFTER their ledger
 * entries were already written stay in the append-only ledger (invariant #5 — no
 * DELETE). The free-tier backfill of 2026-08-27 reclassified ~345,820 revenue
 * rows whose ledger txns already existed. So the ledger side must ALSO exclude
 * test rows — by joining ref_id -> revenue_events_v2.request_id — or parity would
 * compare a test-filtered revenue count against an unfiltered ledger count and
 * report a nonsensical drift. Ledger txns with no matching revenue row are kept
 * (they cannot be test-classified), preserving the previous count semantics for
 * every non-backfilled row.
 */

import { Router } from 'express';

/** Convert a bigint-string of minor units to a decimal string (no float). */
export function minorToDecimal(minorStr, decimals = 6) {
  const negative = minorStr.startsWith('-');
  const abs = (negative ? minorStr.slice(1) : minorStr).padStart(decimals + 1, '0');
  const intPart = abs.slice(0, abs.length - decimals);
  const fracPart = abs.slice(abs.length - decimals);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * Compute the parity report. Pure-ish: only reads. Never mutates.
 * @param {import('pg').Pool} pool
 */
export async function computeParity(pool) {
  const [revAgg, ledgerAgg, oldest] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::bigint AS cnt,
              COALESCE(SUM(amount_usdt::numeric), 0)::text AS sum_usdt
         FROM revenue_events_v2
        WHERE is_test_data IS NOT TRUE`,
    ),
    pool.query(
      // Ledger side excludes revenue rows reclassified as test data. A ledger
      // entry counts unless it maps to a revenue_events_v2 row that is
      // is_test_data = true. LEFT JOIN + `r.is_test_data IS NOT TRUE` keeps
      // entries with no matching revenue row (NULL) and drops only the ones now
      // flagged test — mirroring the revenue-side filter for like-for-like parity.
      `SELECT COUNT(DISTINCT le.txn_id)::bigint AS txn_cnt,
              COALESCE(SUM(le.amount) FILTER (WHERE le.direction = 'credit'), 0)::text AS sum_credits_minor
         FROM ledger_entries le
         LEFT JOIN revenue_events_v2 r ON r.request_id = le.ref_id
        WHERE le.ref_type = 'revenue_event'
          AND r.is_test_data IS NOT TRUE`,
    ),
    pool.query(
      `SELECT r.request_id, r.created_at
         FROM revenue_events_v2 r
        WHERE r.is_test_data IS NOT TRUE
          AND NOT EXISTS (
            SELECT 1 FROM ledger_entries le
             WHERE le.ref_type = 'revenue_event' AND le.ref_id = r.request_id
          )
        ORDER BY r.created_at ASC
        LIMIT 1`,
    ),
  ]);

  const revenueCount = Number(revAgg.rows[0]?.cnt ?? 0);
  const sumRevenueUsdt = String(revAgg.rows[0]?.sum_usdt ?? '0');
  const ledgerTxnCount = Number(ledgerAgg.rows[0]?.txn_cnt ?? 0);
  const sumLedgerCreditsMinor = String(ledgerAgg.rows[0]?.sum_credits_minor ?? '0');
  const sumLedgerCredits = minorToDecimal(sumLedgerCreditsMinor, 6);

  const parityPct =
    revenueCount === 0 ? 100 : Math.round((ledgerTxnCount / revenueCount) * 10000) / 100;
  const drift = revenueCount - ledgerTxnCount;

  const oldestRow = oldest.rows[0];
  // revenue_events_v2.created_at is bigint SECONDS; the response `ts` below is
  // Date.now() MILLISECONDS. Returning the raw seconds under `created_at` mixed
  // epoch units in a single financial response (a consumer diffing the two was
  // off by 1000×). Expose it explicitly as milliseconds to match `ts`.
  const oldestUnmatched = oldestRow
    ? { request_id: oldestRow.request_id, created_at_ms: Number(oldestRow.created_at) * 1000 }
    : null;

  return {
    revenue_events_v2_count: revenueCount,
    ledger_txn_count: ledgerTxnCount,
    parity_pct: parityPct,
    sum_revenue_usdt: sumRevenueUsdt,
    sum_ledger_credits: sumLedgerCredits,
    drift,
    oldest_unmatched: oldestUnmatched,
  };
}

/** Express router mounting GET /ledger-parity (mount under /internal). */
export function createLedgerParityRouter(pool) {
  const router = Router();
  router.get('/ledger-parity', async (_req, res) => {
    try {
      const data = await computeParity(pool);
      res.json({ ok: true, data, ts: Date.now() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? 'parity computation failed' });
    }
  });
  return router;
}
