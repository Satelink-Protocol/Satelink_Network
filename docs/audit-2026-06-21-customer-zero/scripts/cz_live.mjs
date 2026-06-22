/**
 * Post-cutover LIVE validation (CREDIT_CANONICAL=true) through the REAL HTTP
 * gateway. Creates a paid test account, funds it (deposit→credit), fires real
 * RPC requests, observes per-request deduction + usage, proves 402 at depletion,
 * then cleans up. Run:
 *   railway run --service Postgres-iQeW node apps/api/cz_live.mjs
 */
import pg from 'pg';
import { creditAccount, resolveAccount, PRICE_PER_CALL_USDT } from './src/billing/credit_service.mjs';

const API = 'https://rpc.satelink.network';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TS = `${Date.now()}`;
const KEY = `sk_basic_czlive_${TS}`;
const WALLET = `0x00000000000000000000000000000000live${TS.slice(-4)}`;
const FUND = 0.00009; // 3 calls @ 0.00003
const log = (...a) => console.log(...a);
let fail = 0; const check = (n, c, d='') => { log(`  ${c?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`); if(!c) fail++; };

async function rpc() {
  const r = await fetch(`${API}/rpc/polygon`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
  });
  return { status: r.status, source: r.headers.get('x-credit-source'), bal: r.headers.get('x-credit-balance') };
}

async function main() {
  log('=== POST-CUTOVER LIVE VALIDATION (CREDIT_CANONICAL=true) ===\n');

  // Create paid account (canonical store)
  await pool.query(`INSERT INTO api_credits (api_key,tier,daily_limit,credits_usdt,wallet_address,status) VALUES ($1,'basic',10000,0,$2,'active')`, [KEY, WALLET]);
  const balBefore = parseFloat((await resolveAccount(pool,{apiKey:KEY})).credits_usdt);

  // DEPOSIT → CREDITS INCREASE
  await creditAccount(pool, { apiKey: KEY, amountUsdt: FUND, txHash: `0xczlive${TS}` });
  const balFunded = parseFloat((await resolveAccount(pool,{apiKey:KEY})).credits_usdt);
  check('Deposit → credits increase', balFunded === balBefore + FUND, `${balBefore} → ${balFunded}`);

  // RPC REQUESTS until depletion (fund = 3 calls, expect 3×200 then 402)
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await rpc());
  const served = results.filter(r => r.status === 200).length;
  const got402 = results.some(r => r.status === 402);
  log('  request results: ' + results.map(r => `${r.status}${r.source==='api_credits'?'*':''}`).join(' '));
  check('RPC requests served then depleted', served === 3 && got402, `served=${served}, 402seen=${got402}`);
  check('every response from api_credits (X-Credit-Source)', results.every(r => r.source === 'api_credits'));

  // USAGE HISTORY + balance after (HTTP + DB)
  const usageHttp = await (await fetch(`${API}/api/keys/usage`, { headers: { 'X-API-Key': KEY } })).json();
  const usageRows = (await pool.query(`SELECT request_count, usdt_spent FROM api_usage_daily WHERE api_key=$1 AND date=CURRENT_DATE`, [KEY])).rows;
  const balAfter = parseFloat((await resolveAccount(pool,{apiKey:KEY})).credits_usdt);
  const deducted = +(balFunded - balAfter).toFixed(8);
  check('usage count increments (HTTP /usage)', usageHttp.requests_today === served, `requests_today=${usageHttp.requests_today}`);
  check('usage rows created', usageRows.length === 1 && parseInt(usageRows[0].request_count,10) === served);
  check('credits decrease by served×price', Math.abs(deducted - served*PRICE_PER_CALL_USDT) < 1e-9, `deducted=${deducted}`);
  check('402 returned at depletion (balance 0)', got402 && Math.abs(balAfter) < 1e-9);

  // NO credit_balances dependency (test wallet never written there)
  const cb = await pool.query(`SELECT 1 FROM credit_balances WHERE lower(wallet_address)=lower($1)`, [WALLET]).catch(()=>({rows:[]}));
  check('no credit_balances dependency', cb.rows.length === 0);

  log('\n=== EVIDENCE ===');
  log(JSON.stringify({
    balance_before: balFunded,
    balance_after: balAfter,
    requests_served: served,
    usage_rows_created: usageRows.length,
    usage_request_count: usageRows[0] ? parseInt(usageRows[0].request_count,10) : 0,
    deduction_amount_total: deducted,
    deduction_per_request: PRICE_PER_CALL_USDT,
    http_402_at_depletion: got402,
    credit_source: 'api_credits',
  }, null, 2));

  // cleanup
  await pool.query(`DELETE FROM api_usage_daily WHERE api_key=$1`, [KEY]);
  await pool.query(`DELETE FROM api_deposits WHERE api_key=$1`, [KEY]);
  await pool.query(`DELETE FROM api_credits WHERE api_key=$1`, [KEY]);
  log('\ncleanup: test rows deleted');
  log(fail === 0 ? 'LIVE VALIDATION PASSED' : `${fail} CHECK(S) FAILED`);
  await pool.end();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error('live error:', e.message); try { await pool.end(); } catch {} process.exit(2); });
