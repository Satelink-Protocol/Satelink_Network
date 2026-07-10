// apps/api/src/payments/x402/funnel.js
// Conversion telemetry for the x402 rail — three counters in a single-row
// table (migration 028), incremented fire-and-forget so the hot path never
// blocks on telemetry. Exposed via GET /internal/x402-funnel (admin token).

const COLUMNS = new Set(['issued', 'attempts', 'settlements']);

export function bumpFunnel(pool, column) {
  if (!pool || !pool.query || !COLUMNS.has(column)) return;
  pool
    .query(`UPDATE x402_funnel SET ${column} = ${column} + 1, updated_at = now() WHERE id = 1`)
    .catch(() => {}); // telemetry must never affect serving
}

export function createFunnelHandler(pool) {
  return async function x402FunnelHandler(_req, res) {
    try {
      const [funnel, totals] = await Promise.all([
        pool.query(`SELECT issued, attempts, settlements FROM x402_funnel WHERE id = 1`),
        pool.query(
          `SELECT COALESCE(SUM(amount_usd), 0) AS paid,
                  COALESCE(SUM(amount_usd) FILTER (WHERE NOT is_test_data), 0) AS external
             FROM payment_sources WHERE source = 'x402'`
        ),
      ]);
      const f = funnel.rows[0] || { issued: 0, attempts: 0, settlements: 0 };
      res.json({
        issued: parseInt(f.issued, 10),
        attempts: parseInt(f.attempts, 10),
        settlements: parseInt(f.settlements, 10),
        paid_usd_total: parseFloat(totals.rows[0].paid),
        external_usd_total: parseFloat(totals.rows[0].external),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'funnel_query_failed', message: err.message });
    }
  };
}
