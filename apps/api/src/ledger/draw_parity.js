/**
 * Draw parity endpoint (M6 — Draw + Settlement in shadow).
 *
 * GET /internal/draw-parity — measures how closely the shadow draws track
 * the legacy payment_sources table (x402 payments). READ-ONLY.
 *
 * Parity is measured on REAL revenue only: is_test_data rows are excluded.
 */

import { Router } from 'express';

export function minorToDecimal(minorStr, decimals = 6) {
  const negative = minorStr.startsWith('-');
  const abs = (negative ? minorStr.slice(1) : minorStr).padStart(decimals + 1, '0');
  const intPart = abs.slice(0, abs.length - decimals);
  const fracPart = abs.slice(abs.length - decimals);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * Compute the draw parity report. Pure-ish: only reads. Never mutates.
 * @param {import('pg').Pool} pool
 */
export async function computeDrawParity(pool) {
  const [payAgg, drawAgg, oldest] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::bigint AS cnt,
              COALESCE(SUM(amount_usd::numeric), 0)::text AS sum_usd
         FROM payment_sources
        WHERE source = 'x402' AND is_test_data IS NOT TRUE`,
    ),
    pool.query(
      `SELECT COUNT(*)::bigint AS draw_cnt,
              COALESCE(SUM(amount), 0)::text AS sum_amount_minor
         FROM draws
        WHERE idempotency_key LIKE 'idem_x402_draw_%'`,
    ),
    pool.query(
      `SELECT p.tx_hash, p.created_at
         FROM payment_sources p
        WHERE p.source = 'x402' AND p.is_test_data IS NOT TRUE
          AND NOT EXISTS (
            SELECT 1 FROM draws d
             WHERE d.idempotency_key = 'idem_x402_draw_' || p.tx_hash
          )
        ORDER BY p.created_at ASC
        LIMIT 1`,
    ),
  ]);

  const paymentCount = Number(payAgg.rows[0]?.cnt ?? 0);
  const sumPaymentUsd = String(payAgg.rows[0]?.sum_usd ?? '0');
  const drawCount = Number(drawAgg.rows[0]?.draw_cnt ?? 0);
  const sumDrawMinor = String(drawAgg.rows[0]?.sum_amount_minor ?? '0');
  const sumDraws = minorToDecimal(sumDrawMinor, 6);

  const parityPct =
    paymentCount === 0 ? 100 : Math.round((drawCount / paymentCount) * 10000) / 100;
  const drift = paymentCount - drawCount;

  const oldestRow = oldest.rows[0];
  const oldestUnmatched = oldestRow
    ? { tx_hash: oldestRow.tx_hash, created_at: oldestRow.created_at }
    : null;

  return {
    payment_sources_count: paymentCount,
    draws_count: drawCount,
    parity_pct: parityPct,
    sum_payment_usd: sumPaymentUsd,
    sum_draws_usd: sumDraws,
    drift,
    oldest_unmatched: oldestUnmatched,
  };
}

/** Express router mounting GET /draw-parity (mount under /internal). */
export function createDrawParityRouter(pool) {
  const router = Router();
  router.get('/draw-parity', async (_req, res) => {
    try {
      const data = await computeDrawParity(pool);
      res.json({ ok: true, data, ts: Date.now() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message ?? 'draw parity computation failed' });
    }
  });
  return router;
}
