/**
 * Phase 4 DRY-RUN — read-only reconciliation of credit_balances vs api_credits.
 * Computes what a backfill WOULD do. Writes nothing. Run via:
 *   railway run --service Postgres-iQeW node apps/api/cz_dryrun.mjs
 */
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const q = async (sql, p = []) => { try { return (await pool.query(sql, p)).rows; } catch (e) { return { error: e.message }; } };
const num = (v) => parseFloat(v || 0);

async function main() {
  console.log('=== Phase 4 DRY-RUN — credit_balances → api_credits reconciliation ===\n');

  // Totals
  const cbTot = await q(`SELECT COUNT(*) n, COALESCE(SUM(balance_usdt),0) sum_bal, COALESCE(SUM(balance_usdt) FILTER (WHERE balance_usdt>0),0) sum_funded, COUNT(*) FILTER (WHERE balance_usdt>0) n_funded FROM credit_balances`);
  const acTot = await q(`SELECT COUNT(*) n, COALESCE(SUM(credits_usdt),0) sum_bal, COUNT(*) FILTER (WHERE wallet_address IS NOT NULL AND wallet_address<>'') n_with_wallet FROM api_credits`);
  console.log('credit_balances:', JSON.stringify(cbTot[0] || cbTot));
  console.log('api_credits    :', JSON.stringify(acTot[0] || acTot));

  if (cbTot.error || acTot.error) {
    console.log('\nSCHEMA NOTE:', cbTot.error || acTot.error);
  }

  // Funded wallets in credit_balances and whether they already have an api_credits account
  const matched = await q(`
    SELECT COUNT(*) n, COALESCE(SUM(cb.balance_usdt),0) sum_bal
    FROM credit_balances cb
    JOIN api_credits ac ON lower(ac.wallet_address) = lower(cb.wallet_address)
    WHERE cb.balance_usdt > 0`);
  const orphan = await q(`
    SELECT COUNT(*) n, COALESCE(SUM(cb.balance_usdt),0) sum_bal
    FROM credit_balances cb
    LEFT JOIN api_credits ac ON lower(ac.wallet_address) = lower(cb.wallet_address)
    WHERE cb.balance_usdt > 0 AND ac.api_key IS NULL`);
  const dupWallet = await q(`
    SELECT COUNT(*) n FROM (
      SELECT lower(wallet_address) w FROM api_credits
      WHERE wallet_address IS NOT NULL AND wallet_address<>''
      GROUP BY lower(wallet_address) HAVING COUNT(*) > 1
    ) d`);

  console.log('\n--- migration projection (funded credit_balances rows) ---');
  console.log('accounts_migrated (wallet already has api_credits acct):', JSON.stringify(matched[0] || matched));
  console.log('orphan_balances   (funded wallet, NO api_credits acct → would mint):', JSON.stringify(orphan[0] || orphan));
  console.log('duplicate_wallets (api_credits wallet bound to >1 key):', JSON.stringify(dupWallet[0] || dupWallet));

  // Reconciliation delta: total funded credit_balances that must land in api_credits
  const cbFunded = num((cbTot[0] || {}).sum_funded);
  const willMigrate = num((matched[0] || {}).sum_bal) + num((orphan[0] || {}).sum_bal);
  const delta = +(cbFunded - willMigrate).toFixed(6);
  console.log('\n--- reconciliation ---');
  console.log('funded credit_balances total :', cbFunded);
  console.log('would migrate (matched+orphan):', willMigrate);
  console.log('DELTA (unaccounted)          :', delta);

  // Money-path risk for flipping CREDIT_CANONICAL BEFORE backfill:
  const fundedWalletsNoAcct = num((orphan[0] || {}).n);
  console.log('\n--- flag-flip safety (Phase 2/3) ---');
  console.log('funded wallets with NO api_credits account:', fundedWalletsNoAcct);
  console.log(fundedWalletsNoAcct > 0
    ? '⚠️  RISK: enabling CREDIT_CANONICAL before backfill would 401 these wallet callers. Backfill FIRST.'
    : '✅ No funded orphan wallets — enabling the flag will not strand existing wallet-funded callers.');

  console.log('\nDRY-RUN ONLY — no rows written.');
  await pool.end();
}
main().catch(async (e) => { console.error('dryrun error:', e.message); try { await pool.end(); } catch {} process.exit(2); });
