/**
 * Phase 4 COMMIT — migrate funded orphan wallets from credit_balances into
 * api_credits (canonical). Transactional, tagged, reversible. Keeps
 * credit_balances INTACT (no deletes). Run:
 *   railway run --service Postgres-iQeW node apps/api/cz_backfill.mjs
 *
 * For each credit_balances wallet with balance>0 and NO api_credits account:
 *   - mint sk_live_* key bound to the wallet (tier basic so pay-per-call deducts)
 *   - credit api_credits.credits_usdt = wallet balance
 *   - write a TAGGED api_deposits row (tx_hash = 'migration_<wallet>') → rollback handle
 */
import pg from 'pg';
import crypto from 'crypto';
import { creditAccount, resolveAccount } from './src/billing/credit_service.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const MIGRATE_TIER = 'basic';
const MIGRATE_LIMIT = 10000;

async function main() {
  console.log('=== Phase 4 COMMIT — credit_balances → api_credits backfill ===\n');
  const client = await pool.connect();
  const report = { migrated: [], skipped: 0, errors: [] };
  try {
    await client.query('BEGIN');

    // Funded orphan wallets (balance>0, no api_credits account). FOR UPDATE locks
    // the source rows for the duration so a concurrent deposit can't race us.
    const orphans = (await client.query(`
      SELECT cb.wallet_address, cb.balance_usdt
      FROM credit_balances cb
      LEFT JOIN api_credits ac ON lower(ac.wallet_address) = lower(cb.wallet_address)
      WHERE cb.balance_usdt > 0 AND ac.api_key IS NULL
      FOR UPDATE OF cb
    `)).rows;

    console.log(`funded orphan wallets to migrate: ${orphans.length}`);

    for (const row of orphans) {
      const wallet = row.wallet_address;
      const oldBalance = parseFloat(row.balance_usdt);
      const apiKey = `sk_live_${crypto.randomBytes(24).toString('hex')}`;

      // Mint the bound account (0 balance), then credit via the canonical service
      // so the deposit ledger gets a tagged, idempotent row.
      await client.query(
        `INSERT INTO api_credits (api_key, tier, daily_limit, credits_usdt, wallet_address, status)
         VALUES ($1, $2, $3, 0, $4, 'active')`,
        [apiKey, MIGRATE_TIER, MIGRATE_LIMIT, wallet]
      );
      const res = await creditAccount(client, {
        apiKey, amountUsdt: oldBalance,
        txHash: `migration_${wallet.toLowerCase()}`,
        fromAddress: wallet, tier: MIGRATE_TIER, dailyLimit: MIGRATE_LIMIT,
      });
      if (!res.ok) { report.errors.push({ wallet, error: res.code }); throw new Error(`creditAccount failed for ${wallet}: ${res.code}`); }

      report.migrated.push({
        wallet,
        minted_key: apiKey.slice(0, 16) + '…',
        old_credit_balances_usdt: oldBalance,
        new_api_credits_usdt: res.balance,
        tier: MIGRATE_TIER, daily_limit: MIGRATE_LIMIT,
        tag: `migration_${wallet.toLowerCase()}`,
      });
    }

    await client.query('COMMIT');
    console.log('COMMIT ok — credit_balances left INTACT (no deletes)\n');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('ROLLBACK —', e.message);
    report.errors.push({ fatal: e.message });
  } finally {
    client.release();
  }

  console.log('=== MIGRATION REPORT ===');
  console.log(JSON.stringify(report, null, 2));

  // ---- PHASE 4 VALIDATION (read-only) ----
  console.log('\n=== PHASE 4 VALIDATION ===');
  let pass = true;
  for (const m of report.migrated) {
    const acct = await resolveAccount(pool, { wallet: m.wallet });
    const okResolve = !!acct && acct.api_key && acct.wallet_address &&
      acct.wallet_address.toLowerCase() === m.wallet.toLowerCase();
    const okBalance = acct && Math.abs(parseFloat(acct.credits_usdt) - m.old_credit_balances_usdt) < 1e-9;
    console.log(`  ${okResolve ? 'PASS' : 'FAIL'}  funded wallet resolves correctly (${m.wallet})`);
    console.log(`  ${okBalance ? 'PASS' : 'FAIL'}  api_credits balance == migrated balance (${m.old_credit_balances_usdt} == ${acct?.credits_usdt})`);
    if (!okResolve || !okBalance) pass = false;
  }
  const orphansLeft = (await pool.query(`
    SELECT COUNT(*) n FROM credit_balances cb
    LEFT JOIN api_credits ac ON lower(ac.wallet_address)=lower(cb.wallet_address)
    WHERE cb.balance_usdt > 0 AND ac.api_key IS NULL`)).rows[0].n;
  console.log(`  ${orphansLeft == 0 ? 'PASS' : 'FAIL'}  no orphan balances remain (orphans=${orphansLeft})`);
  const dupFunded = (await pool.query(`
    SELECT COUNT(*) n FROM (
      SELECT lower(wallet_address) w FROM api_credits
      WHERE credits_usdt > 0 AND wallet_address IS NOT NULL AND wallet_address<>''
      GROUP BY lower(wallet_address) HAVING COUNT(*) > 1
    ) d`)).rows[0].n;
  console.log(`  ${dupFunded == 0 ? 'PASS' : 'FAIL'}  no duplicate funded balances remain (dups=${dupFunded})`);
  if (orphansLeft != 0 || dupFunded != 0) pass = false;

  console.log(pass ? '\nVALIDATION PASSED' : '\nVALIDATION FAILED');
  await pool.end();
  process.exit(pass && report.errors.length === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error('backfill error:', e.message); try { await pool.end(); } catch {} process.exit(2); });
