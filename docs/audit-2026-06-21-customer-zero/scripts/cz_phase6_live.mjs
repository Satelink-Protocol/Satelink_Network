/**
 * Phase 6 LIVE verification (CREDIT_CANONICAL=true). Proves: free traffic → 0
 * revenue events; paid traffic → events == deduction; Σrevenue == collected
 * credits. Cleans up. Run:
 *   railway run --service Postgres-iQeW node apps/api/cz_phase6_live.mjs
 */
import pg from 'pg';
import { creditAccount, resolveAccount, PRICE_PER_CALL_USDT } from './src/billing/credit_service.mjs';

const API = 'https://rpc.satelink.network';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TS = `${Date.now()}`;
const FREE_KEY = `sk_free_p6free_${TS}`;
const PAID_KEY = `sk_basic_p6paid_${TS}`;
let fail = 0; const log = (...a)=>console.log(...a);
const check = (n,c,d='') => { log(`  ${c?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!c) fail++; };

async function rpc(key) {
  const r = await fetch(`${API}/rpc/polygon`, { method:'POST', headers:{'Content-Type':'application/json',...(key?{'X-API-Key':key}:{})}, body: JSON.stringify({jsonrpc:'2.0',method:'eth_blockNumber',params:[],id:1}) });
  return r.status;
}
const revCount = async (key) => parseInt((await pool.query(`SELECT COUNT(*) n, COALESCE(SUM(amount_usdt),0) s FROM revenue_events_v2 WHERE client_id=$1`, [key])).rows[0].n, 10);
const revSum   = async (key) => parseFloat((await pool.query(`SELECT COALESCE(SUM(amount_usdt),0) s FROM revenue_events_v2 WHERE client_id=$1`, [key])).rows[0].s);

async function main() {
  log('=== PHASE 6 LIVE VERIFICATION (free → 0 events, paid → events == deduction) ===\n');

  // FREE TIER
  await pool.query(`INSERT INTO api_credits (api_key,tier,daily_limit,credits_usdt,status) VALUES ($1,'free',500,0,'active')`, [FREE_KEY]);
  const freeStatuses = [];
  for (let i=0;i<3;i++) freeStatuses.push(await rpc(FREE_KEY));
  const freeRev = await revCount(FREE_KEY);
  const freeUsage = parseInt((await pool.query(`SELECT request_count FROM api_usage_daily WHERE api_key=$1 AND date=CURRENT_DATE`, [FREE_KEY])).rows[0]?.request_count,10)||0;
  log(`  free request statuses: ${freeStatuses.join(' ')}`);
  check('free traffic creates 0 revenue events', freeRev === 0, `rows=${freeRev}`);
  check('free traffic still metered (usage recorded)', freeUsage === 3, `usage=${freeUsage}`);

  // PAID TIER
  await pool.query(`INSERT INTO api_credits (api_key,tier,daily_limit,credits_usdt,status) VALUES ($1,'basic',10000,0,'active')`, [PAID_KEY]);
  await creditAccount(pool, { apiKey: PAID_KEY, amountUsdt: 0.00009, txHash:`0xp6${TS}` }); // 3 calls
  const balFunded = parseFloat((await resolveAccount(pool,{apiKey:PAID_KEY})).credits_usdt);
  const paidStatuses = [];
  for (let i=0;i<5;i++) paidStatuses.push(await rpc(PAID_KEY));
  const served = paidStatuses.filter(s=>s===200).length;
  const got402 = paidStatuses.includes(402);
  const paidRev = await revCount(PAID_KEY);
  const paidRevSum = await revSum(PAID_KEY);
  const balAfter = parseFloat((await resolveAccount(pool,{apiKey:PAID_KEY})).credits_usdt);
  const deducted = +(balFunded - balAfter).toFixed(8);
  log(`  paid request statuses: ${paidStatuses.join(' ')}`);
  check('paid traffic creates revenue events', paidRev > 0 && paidRev === served, `events=${paidRev}, served=${served}`);
  check('exhausted account → 402 (no event for 402s)', got402 && paidRev === served, `402seen=${got402}`);
  check('Σ revenue == collected credits (deducted)', Math.abs(paidRevSum - deducted) < 1e-9, `Σrev=${paidRevSum}, deducted=${deducted}`);
  check('revenue amount == actual deducted (not list price)', Math.abs(paidRevSum - served*PRICE_PER_CALL_USDT) < 1e-9, `Σrev=${paidRevSum}`);

  log('\n=== EVIDENCE ===');
  log(JSON.stringify({
    free: { requests: freeStatuses.length, statuses: freeStatuses, revenue_events: freeRev, usage_rows: freeUsage },
    paid: { requests: paidStatuses.length, statuses: paidStatuses, served, revenue_events: paidRev, revenue_sum: paidRevSum, balance_before: balFunded, balance_after: balAfter, deducted },
    settlement_identity_holds: Math.abs(paidRevSum - deducted) < 1e-9,
  }, null, 2));

  // cleanup
  for (const k of [FREE_KEY, PAID_KEY]) {
    await pool.query(`DELETE FROM revenue_events_v2 WHERE client_id=$1`, [k]);
    await pool.query(`DELETE FROM api_usage_daily WHERE api_key=$1`, [k]);
    await pool.query(`DELETE FROM api_deposits WHERE api_key=$1`, [k]);
    await pool.query(`DELETE FROM api_credits WHERE api_key=$1`, [k]);
  }
  log('\ncleanup: test rows deleted');
  log(fail===0 ? 'PHASE 6 LIVE VERIFICATION PASSED' : `${fail} CHECK(S) FAILED`);
  await pool.end();
  process.exit(fail===0?0:1);
}
main().catch(async e => { console.error('verify error:', e.message); try{await pool.end();}catch{} process.exit(2); });
