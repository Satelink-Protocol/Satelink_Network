// fix/ti-charge-after-success — refund Trading Intelligence calls that were
// charged but returned 503 (warming_up / read_failed) before the fix.
// DRY RUN by default (report only); --apply credits the refunds.
// Idempotent: each (key, day) refund is claimed in ti_503_refunds (PK) in the
// SAME transaction as the credit — a second run never pays twice.
//   railway run --service Satelink-api -- node scripts/incidents/refund_ti_503_charges.mjs [--apply]
//
// Detection: TI never wrote a revenue row for an unserved call, so a charged
// 503 is spend with no revenue behind it. Per key per day:
//   ti_calls = floor((usdt_spent − Σ rpc revenue that day) / 0.01)
// on days with no served (revenue-recorded) TI call. Limitation: only days
// still present in api_usage_daily can be reconstructed. Never prints a key.
import pg from 'pg';

const apply = process.argv.includes('--apply');
const TI_PRICE = 0.01;
const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (!url) throw new Error('DATABASE_URL not set');
const pool = new pg.Pool({ connectionString: url });

const CANDIDATES = `
  WITH rpc AS (
    SELECT client_id, to_timestamp(created_at)::date d, SUM(amount_usdt) usdt
      FROM revenue_events_v2 WHERE op_type = 'rpc_call' GROUP BY 1, 2
  ), ti AS (
    SELECT client_id, to_timestamp(created_at)::date d, COUNT(*) n
      FROM revenue_events_v2 WHERE op_type = 'intelligence' GROUP BY 1, 2
  )
  SELECT u.api_key, u.date,
         FLOOR(((u.usdt_spent - COALESCE(r.usdt, 0)) / ${TI_PRICE})::numeric + 1e-9)::int AS ti_calls
    FROM api_usage_daily u
    LEFT JOIN rpc r ON r.client_id = u.api_key AND r.d = u.date
    LEFT JOIN ti  t ON t.client_id = u.api_key AND t.d = u.date
   WHERE COALESCE(t.n, 0) = 0
     AND u.usdt_spent - COALESCE(r.usdt, 0) >= ${TI_PRICE} - 1e-9`;

const hint = (k) => `${k.slice(0, k.indexOf('_', 3) + 1)}…${k.slice(-4)}`;
const client = await pool.connect();
try {
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  if (apply) {
    await client.query(`CREATE TABLE IF NOT EXISTS ti_503_refunds (
      api_key TEXT NOT NULL, day DATE NOT NULL, ti_calls INTEGER NOT NULL, amount_usdt NUMERIC(18,6) NOT NULL,
      refunded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (api_key, day))`);
  }
  const rows = (await client.query(CANDIDATES)).rows.filter((r) => r.ti_calls > 0);
  const perKey = new Map();
  let total = 0, calls = 0, paid = 0;
  for (const r of rows) {
    const amount = +(r.ti_calls * TI_PRICE).toFixed(6);
    total += amount; calls += r.ti_calls;
    perKey.set(hint(r.api_key), +((perKey.get(hint(r.api_key)) || 0) + amount).toFixed(6));
    if (apply) {
      const claim = await client.query(
        `INSERT INTO ti_503_refunds (api_key, day, ti_calls, amount_usdt) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING 1`,
        [r.api_key, r.date, r.ti_calls, amount]
      );
      if (claim.rowCount) {
        await client.query(
          `UPDATE api_credits SET credits_usdt = credits_usdt + $1, total_spent = GREATEST(0, COALESCE(total_spent, 0) - $1) WHERE api_key = $2`,
          [amount, r.api_key]
        );
        paid += amount;
      }
    }
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', charged_503_calls: calls, total_usdt: +total.toFixed(6), keys: perKey.size, per_key_usdt: Object.fromEntries(perKey), refunded_now_usdt: apply ? +paid.toFixed(6) : null }));
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
