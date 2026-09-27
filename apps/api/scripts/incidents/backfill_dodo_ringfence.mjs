// fix/dodo-rpc-boundary — ring-fence Dodo value credited BEFORE the fix.
// DRY RUN by default (READ ONLY transaction); --apply writes. FOUNDER GATE.
//   node scripts/incidents/backfill_dodo_ringfence.mjs "<connectionString>" [--apply]
//
// For every key credited by Dodo (payment_sources.source = 'dodo'), sets
//   dodo_funded_usdt = LEAST(credits_usdt, Σ Dodo credited − Σ Dodo refunded/frozen)
// i.e. the Dodo value still sitting in the balance, capped by the balance
// (spent value cannot be ring-fenced). Only ever RAISES the fence (GREATEST
// with the current value), so a re-run is a no-op. Never prints a key.
import pg from 'pg';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const url = args.find((a) => !a.startsWith('--'));
if (!url) throw new Error('usage: backfill_dodo_ringfence.mjs "<connectionString>" [--apply]');
const pool = new pg.Pool({ connectionString: url });

const CANDIDATES = `
  SELECT a.id, a.api_key,
         COALESCE(a.credits_usdt, 0)::numeric AS credits,
         COALESCE((to_jsonb(a) ->> 'dodo_funded_usdt')::numeric, 0) AS fence,
         (SELECT COALESCE(SUM(p.amount_usd), 0) FROM payment_sources p
           WHERE p.source = 'dodo' AND p.credited_api_key = a.api_key)::numeric AS dodo_in,
         COALESCE((SELECT SUM(l.amount_usd - l.shortfall_usd) FROM dodo_refund_dispute_log l
           WHERE l.api_key = a.api_key), 0)::numeric AS dodo_out,
         EXISTS (SELECT 1 FROM payment_sources p WHERE p.credited_api_key = a.api_key AND p.source = 'dodo' AND p.is_test_data) AS any_test
    FROM api_credits a
   WHERE EXISTS (SELECT 1 FROM payment_sources p WHERE p.source = 'dodo' AND p.credited_api_key = a.api_key)`;

const hint = (k) => `${k.slice(0, k.indexOf('_', 3) + 1)}…${k.slice(-4)}`;
const client = await pool.connect();
try {
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  const rows = (await client.query(CANDIDATES)).rows;
  const report = [];
  for (const r of rows) {
    const remaining = Math.max(0, Number(r.dodo_in) - Number(r.dodo_out));
    const target = +Math.min(Number(r.credits), remaining).toFixed(6);
    const current = Number(r.fence);
    report.push({ key_id: r.id, key: hint(r.api_key), credits_usdt: Number(r.credits), dodo_credited: Number(r.dodo_in), dodo_reversed: Number(r.dodo_out), fence_now: current, fence_target: target, test_data_present: r.any_test });
    if (apply && target > current) {
      await client.query(
        `UPDATE api_credits SET dodo_funded_usdt = GREATEST(dodo_funded_usdt, $1) WHERE api_key = $2`,
        [target, r.api_key]
      );
    }
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', keys: report }, null, 1));
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
