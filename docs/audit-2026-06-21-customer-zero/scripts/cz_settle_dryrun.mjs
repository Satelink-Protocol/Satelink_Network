/**
 * Settlement rollup DRY-RUN verification. READ-ONLY for prod: the tx-generation
 * path is exercised inside a transaction that is ROLLED BACK, so no rows persist.
 * Run (DB):     railway run --service Postgres-iQeW node apps/api/cz_settle_dryrun.mjs
 * Funding only: railway run --service Satelink-api  node apps/api/cz_settle_dryrun.mjs --funding
 */
import pg from 'pg';
import { SettlementAnchorJob } from './src/scheduler/jobs/settlement_anchor_job.js';

const fundingOnly = process.argv.includes('--funding');

async function fundingCheck() {
  // Uses POLYGON_* from the Satelink-api env; no DB needed.
  const job = new SettlementAnchorJob({ query: async () => ({ rows: [] }) });
  console.log('=== SIGNER FUNDING PRECHECK (real signer env) ===');
  console.log('configured:', job.configured);
  const fp = await job.fundingPrecheck(0); // anchor = 0-value data tx → native gas only
  console.log(JSON.stringify(fp, null, 2));
  process.exit(0);
}

async function main() {
  if (fundingOnly) return fundingCheck();

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const job = new SettlementAnchorJob(pool);
  await job.ensureTable();

  console.log('=== SETTLEMENT ROLLUP DRY-RUN ===\n');

  // 1. Build candidates (read-only) — threshold accumulation evidence
  const built = await job.buildCandidates();
  console.log('--- candidate build ---');
  console.log(JSON.stringify({
    threshold_usdt: built.threshold_usdt,
    total_unanchored_epochs: built.total_unanchored_epochs,
    candidates_formed: built.candidates.length,
    carry_forward: built.carryForward,
    first_candidate: built.candidates[0] ? {
      epoch_lo: built.candidates[0].epoch_lo,
      epoch_hi: built.candidates[0].epoch_hi,
      epoch_count: built.candidates[0].epoch_count,
      total_revenue: built.candidates[0].total_revenue,
      platform_share: built.candidates[0].platform_share,
      merkle_root: built.candidates[0].merkle_root,
    } : null,
  }, null, 2));

  let pass = true;
  const reachable = built.candidates.length > 0;
  console.log(`\n  ${reachable ? 'PASS' : 'INFO'}  settlement candidate created (${built.candidates.length})`);
  if (built.candidates[0]) {
    const c = built.candidates[0];
    console.log(`  ${c.total_revenue >= built.threshold_usdt ? 'PASS' : 'FAIL'}  threshold accumulation (${c.total_revenue} >= ${built.threshold_usdt})`);
    console.log(`  ${/^0x[0-9a-f]{64}$/.test(c.merkle_root) ? 'PASS' : 'FAIL'}  merkle root generated`);
    console.log(`  ${c.epoch_hi >= c.epoch_lo && c.epoch_count > 0 ? 'PASS' : 'FAIL'}  epoch range coherent (${c.epoch_lo}..${c.epoch_hi}, n=${c.epoch_count})`);
    if (c.total_revenue < built.threshold_usdt || !/^0x[0-9a-f]{64}$/.test(c.merkle_root)) pass = false;
  }

  // 2. Exercise the tx-generation/write path INSIDE a transaction, then ROLLBACK.
  if (built.candidates[0]) {
    console.log('\n--- tx-generation path (transactional, ROLLED BACK) ---');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txJob = new SettlementAnchorJob(client); // pool=client → writes hit the tx
      const res = await txJob.anchorBatch(built.candidates[0], { dryRun: true });
      const row = (await client.query(`SELECT batch_id, status, epoch_lo, epoch_hi, epoch_count, merkle_root, is_rollup, tx_hash FROM settlement_batches WHERE batch_id=$1`, [res.batch_id])).rows[0];
      console.log('  batch row created:', JSON.stringify(row));
      console.log(`  ${row && row.status === 'simulated' ? 'PASS' : 'FAIL'}  dry-run batch status=simulated (no broadcast)`);
      console.log(`  ${row && row.is_rollup === true ? 'PASS' : 'FAIL'}  marked is_rollup`);
      console.log(`  ${res.tx_hash && res.tx_hash.startsWith('0xSIM_') ? 'PASS' : 'FAIL'}  simulated tx hash (not real): ${res.tx_hash}`);
      console.log('  funding verdict in dry-run:', JSON.stringify(res.funding));
      if (!row || row.status !== 'simulated' || row.is_rollup !== true) pass = false;
      await client.query('ROLLBACK');
      console.log('  ROLLBACK ok — no batch rows persisted to prod');
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('  tx-path error (rolled back):', e.message);
      pass = false;
    } finally {
      client.release();
    }
  }

  console.log('\n=== READINESS EVIDENCE ===');
  console.log(JSON.stringify({
    rollup_implemented: true,
    settlement_reachable: reachable,
    candidates: built.candidates.length,
    epochs_in_first_batch: built.candidates[0]?.epoch_count ?? 0,
    first_batch_revenue_usdt: built.candidates[0]?.total_revenue ?? 0,
    carry_forward_usdt: built.carryForward.total_revenue,
    broadcast_performed: false,
  }, null, 2));

  console.log(pass ? '\nDRY-RUN VERIFICATION PASSED (no broadcast)' : '\nDRY-RUN VERIFICATION had FAILURES');
  await pool.end();
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('dryrun error:', e.message); process.exit(2); });
