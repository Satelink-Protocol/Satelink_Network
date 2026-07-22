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

// Per-day funnel (migration 029). Same fire-and-forget contract as bumpFunnel:
// upsert today's row (UTC), never block or throw on the serving path. Column is
// allow-listed so it is safe to interpolate.
const DAILY_COLUMNS = new Set(['x402_402_served', 'x_payment_retry_received', 'x402_settled']);

export function bumpFunnelDaily(pool, column) {
  if (!pool || !pool.query || !DAILY_COLUMNS.has(column)) return;
  pool
    .query(
      `INSERT INTO x402_funnel_daily (day, ${column}) VALUES (CURRENT_DATE, 1)
         ON CONFLICT (day) DO UPDATE
           SET ${column} = x402_funnel_daily.${column} + 1, updated_at = now()`
    )
    .catch(() => {}); // telemetry must never affect serving
}

export function createFunnelHandler(pool) {
  return async function x402FunnelHandler(_req, res) {
    try {
      const [funnel, totals, daily] = await Promise.all([
        pool.query(`SELECT issued, attempts, settlements FROM x402_funnel WHERE id = 1`),
        pool.query(
          `SELECT COALESCE(SUM(amount_usd), 0) AS paid,
                  COALESCE(SUM(amount_usd) FILTER (WHERE NOT is_test_data), 0) AS external
             FROM payment_sources WHERE source = 'x402'`
        ),
        // Per-day funnel (migration 029). Tolerate its absence (pre-migration) so
        // the handler never 500s just because the daily table isn't applied yet.
        pool
          .query(
            `SELECT day, x402_402_served, x_payment_retry_received, x402_settled
               FROM x402_funnel_daily ORDER BY day DESC LIMIT 7`
          )
          .catch(() => ({ rows: [] })),
      ]);
      const f = funnel.rows[0] || { issued: 0, attempts: 0, settlements: 0 };
      res.json({
        issued: parseInt(f.issued, 10),
        attempts: parseInt(f.attempts, 10),
        settlements: parseInt(f.settlements, 10),
        paid_usd_total: parseFloat(totals.rows[0].paid),
        external_usd_total: parseFloat(totals.rows[0].external),
        daily: daily.rows.map((d) => ({
          day: d.day,
          x402_402_served: parseInt(d.x402_402_served, 10),
          x_payment_retry_received: parseInt(d.x_payment_retry_received, 10),
          x402_settled: parseInt(d.x402_settled, 10),
        })),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'funnel_query_failed', message: err.message });
    }
  };
}
