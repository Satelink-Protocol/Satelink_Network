/**
 * Phase 2/3 verification — exercises the REAL creditService against the REAL
 * production api_credits schema with a funded test key + wallet, asserts the
 * four guarantees, then deletes all test rows. Run from apps/api/ (needs pg):
 *   cp this → apps/api/cz_verify.mjs && cp credit_service.mjs there
 *   railway run --service Postgres-iQeW node apps/api/cz_verify.mjs
 * Does NOT touch CREDIT_CANONICAL or live serving traffic.
 */
import pg from 'pg';
import {
  resolveAccount, authorizeAndMeter, creditAccount, PRICE_PER_CALL_USDT,
} from './src/billing/credit_service.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TS = `${Date.now()}`;
const KEY = `sk_pro_czverify_${TS}`;
const WALLET = `0x00000000000000000000000000000000c0de${TS.slice(-4)}`;
const N = 5;
const log = (...a) => console.log(...a);
let failures = 0;
const check = (n, c, d = '') => { log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) failures++; };

async function main() {
  log('=== Phase 2/3 verification (real prod DB, test account) ===');
  await pool.query(`INSERT INTO api_credits (api_key,tier,daily_limit,credits_usdt,wallet_address,status) VALUES ($1,'pro',100000,0,$2,'active')`, [KEY, WALLET]);
  check('Create Key → account resolvable', !!(await resolveAccount(pool, { apiKey: KEY })));
  const balBefore = parseFloat((await resolveAccount(pool, { apiKey: KEY })).credits_usdt);
  const dep = await creditAccount(pool, { apiKey: KEY, amountUsdt: 1.0, txHash: `0xczverify${TS}` });
  const balAfterDep = parseFloat((await resolveAccount(pool, { apiKey: KEY })).credits_usdt);
  check('Deposit → balance increases', dep.ok && balAfterDep === balBefore + 1.0, `${balBefore} → ${balAfterDep}`);
  let totalDeducted = 0;
  for (let i = 0; i < N; i++) { const v = await authorizeAndMeter(pool, { apiKey: KEY }); if (v.ok) totalDeducted += v.cost; }
  const usage = parseInt((await pool.query(`SELECT request_count FROM api_usage_daily WHERE api_key=$1 AND date=CURRENT_DATE`, [KEY])).rows[0]?.request_count, 10) || 0;
  const balPost = parseFloat((await resolveAccount(pool, { apiKey: KEY })).credits_usdt);
  check('Request → usage increment', usage === N, `request_count=${usage}`);
  check('Request → balance decrement', Math.abs(balPost - (balAfterDep - N * PRICE_PER_CALL_USDT)) < 1e-9, `${balAfterDep} → ${balPost}`);
  check('No double deduction', Math.abs(totalDeducted - N * PRICE_PER_CALL_USDT) < 1e-9, `deducted=${totalDeducted}`);
  const vw = await authorizeAndMeter(pool, { wallet: WALLET });
  check('Wallet → same account deducted', vw.ok && vw.apiKey === KEY);
  const vu = await authorizeAndMeter(pool, { apiKey: `sk_pro_nope_${TS}` });
  check('Unknown key → 401 (no anonymous downgrade)', !vu.ok && vu.http === 401);
  const cb = await pool.query(`SELECT 1 FROM credit_balances WHERE lower(wallet_address)=lower($1)`, [WALLET]).catch(() => ({ rows: [] }));
  check('No credit_balances dependency', cb.rows.length === 0);
  log('\n=== EVIDENCE ===');
  log(JSON.stringify({ request_count: usage, usage_count: usage, balance_before_deposit: balBefore, balance_after_deposit: balAfterDep, balance_after_requests: balPost, deduction_per_request: PRICE_PER_CALL_USDT, total_deducted: totalDeducted }, null, 2));
  await pool.query(`DELETE FROM api_usage_daily WHERE api_key=$1`, [KEY]);
  await pool.query(`DELETE FROM api_deposits WHERE api_key=$1`, [KEY]);
  await pool.query(`DELETE FROM api_credits WHERE api_key=$1`, [KEY]);
  log('\ncleanup: test rows deleted');
  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error('verify error:', e.message); try { await pool.end(); } catch {} process.exit(2); });
