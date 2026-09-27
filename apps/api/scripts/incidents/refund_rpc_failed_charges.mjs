// fix/rpc-charge-after-success — refund RPC calls that were charged but not
// served (upstream 5xx / JSON-RPC error / timeout → 502) before the fix.
// DRY RUN by default (report only, READ ONLY transaction); --apply credits the
// refunds. FOUNDER GATE: never run --apply without explicit approval.
// Idempotent: each key's refund is claimed in rpc_failed_charge_refunds (PK)
// in the SAME transaction as the credit — a second run never pays twice.
//   node scripts/incidents/refund_rpc_failed_charges.mjs "<connectionString>" [--apply] [--include-founder]
//
// Detection: a served RPC call writes a revenue_events_v2 row; an unserved
// (502) one does not, but its deduction stayed in api_credits.total_spent.
// api_usage_daily is retention-pruned, so per-day reconstruction (the TI
// script's method) is impossible here; this uses the lifetime per-key gap:
//   gap = total_spent − Σ revenue(rpc_call) − Σ revenue(intelligence)
// Limitations (why this is an UPPER BOUND, and why --apply is gated):
//   · revenue rows lost to past retention jobs inflate the gap;
//   · x402 bundle keys (tier 'x402') book revenue once at settlement, not per
//     call — excluded;
//   · founder wallets (0x5cbda3…, 0x966e1a…) are reported but excluded from
//     --apply unless --include-founder.
// Never prints a key or a connection string.
import pg from 'pg';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const includeFounder = args.includes('--include-founder');
const url = args.find((a) => !a.startsWith('--'));
if (!url) throw new Error('usage: refund_rpc_failed_charges.mjs "<connectionString>" [--apply] [--include-founder]');

const FOUNDER_PREFIXES = ['0x5cbda3', '0x966e1a'];
const pool = new pg.Pool({ connectionString: url });

const CANDIDATES = `
  SELECT a.id, a.api_key, a.tier, lower(coalesce(a.wallet_address, '')) AS wallet,
         COALESCE(a.total_spent, 0)::numeric AS spent,
         COALESCE((SELECT SUM(r.amount_usdt) FROM revenue_events_v2 r
                    WHERE r.client_id = a.api_key AND r.op_type IN ('rpc_call', 'intelligence')), 0)::numeric AS served
    FROM api_credits a
   WHERE COALESCE(a.total_spent, 0) > 0 AND a.tier <> 'x402'`;

const hint = (k) => `${k.slice(0, k.indexOf('_', 3) + 1)}…${k.slice(-4)}`;
const client = await pool.connect();
try {
  await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  if (apply) {
    await client.query(`CREATE TABLE IF NOT EXISTS rpc_failed_charge_refunds (
      api_key TEXT PRIMARY KEY, amount_usdt NUMERIC(18,6) NOT NULL,
      refunded_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  }
  const rows = (await client.query(CANDIDATES)).rows;
  const report = [];
  let total = 0, founderTotal = 0, paid = 0;
  for (const r of rows) {
    const gap = +(Number(r.spent) - Number(r.served)).toFixed(6);
    if (gap <= 0) continue;
    const founder = FOUNDER_PREFIXES.some((p) => r.wallet.startsWith(p));
    report.push({ key_id: r.id, key: hint(r.api_key), tier: r.tier, founder, gap_usdt: gap });
    if (founder) founderTotal += gap; else total += gap;
    if (apply && (!founder || includeFounder)) {
      const claim = await client.query(
        `INSERT INTO rpc_failed_charge_refunds (api_key, amount_usdt) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1`,
        [r.api_key, gap]
      );
      if (claim.rowCount) {
        await client.query(
          `UPDATE api_credits SET credits_usdt = credits_usdt + $1, total_spent = GREATEST(0, COALESCE(total_spent, 0) - $1) WHERE api_key = $2`,
          [gap, r.api_key]
        );
        paid += gap;
      }
    }
  }
  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    upper_bound_external_usdt: +total.toFixed(6),
    upper_bound_founder_usdt: +founderTotal.toFixed(6),
    keys: report,
    refunded_now_usdt: apply ? +paid.toFixed(6) : null,
  }, null, 1));
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  throw e;
} finally {
  client.release();
  await pool.end();
}
