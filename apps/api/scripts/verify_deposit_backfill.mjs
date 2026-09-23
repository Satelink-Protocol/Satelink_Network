#!/usr/bin/env node
// verify_deposit_backfill.mjs — READ-ONLY reconciliation for the
// fix/deposit-listener-cursor-resume incident (see
// docs/api/DEPOSIT_LISTENER_INCIDENT.md).
//
// Answers the question the DB alone cannot: "did the listener actually miss
// any real on-chain Deposited event?" It re-scans the RevenueVault's full
// Deposited event log directly from chain (chunked, same pattern as the real
// listener) across the given block range, and diffs every tx_hash found
// on-chain against what's already recorded in credit_deposits.
//
// SAFETY: read-only everywhere. No wallet, no private key, no writes to the
// DB or the chain — only `eth_getLogs` (via ethers) and `SELECT` queries. Do
// NOT run this as part of any automated job; it's a one-off founder/dev
// diagnostic. Takes a few minutes depending on --from/--to width and the RPC
// provider's rate limits (chunked at 500 blocks/call to match production).
//
// Usage:
//   POLYGON_RPC_URL=... DATABASE_URL=... node scripts/verify_deposit_backfill.mjs \
//     [--from <block>] [--to <block>] [--vault 0x...] [--chunk 500]
//
// Defaults: --vault reads VAULT_ADDRESS / REVENUE_VAULT_ADDRESS / the deployed
// RevenueVaultV2 address (same fallback the listener uses); --to defaults to
// the current block minus 25 confirmations; --from defaults to the earliest
// block_number already recorded in credit_deposits for this chain, minus
// 50_000 (one full regressed-era "gap" of slack) — or, if credit_deposits is
// empty, refuses to guess and requires an explicit --from.

import { ethers } from 'ethers';
import pg from 'pg';

const REVENUE_VAULT_ABI = ['event Deposited(address indexed from, uint256 amount)'];
const USDT_DECIMALS = 6;

function argValue(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const rpcUrl = process.env.POLYGON_RPC_URL || process.env.RPC_URL;
  const dbUrl = process.env.DATABASE_URL;
  if (!rpcUrl) throw new Error('POLYGON_RPC_URL (or RPC_URL) is required');
  if (!dbUrl) throw new Error('DATABASE_URL is required');

  const vaultAddress =
    argValue('vault') ||
    process.env.VAULT_ADDRESS ||
    process.env.REVENUE_VAULT_ADDRESS ||
    '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';
  const chunk = parseInt(argValue('chunk') || '500', 10);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(vaultAddress, REVENUE_VAULT_ABI, provider);
  const pool = new pg.Pool({ connectionString: dbUrl, max: 1 });

  try {
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);

    const current = await provider.getBlockNumber();
    const toBlock = parseInt(argValue('to') || String(current - 25), 10);

    let fromBlock = argValue('from') ? parseInt(argValue('from'), 10) : undefined;
    if (fromBlock === undefined) {
      const r = await pool.query(
        `SELECT MIN(block_number) AS earliest FROM credit_deposits WHERE chain_id = $1 AND block_number > 0`,
        [chainId]
      );
      const earliest = parseInt(r.rows?.[0]?.earliest, 10);
      if (!earliest) {
        throw new Error(
          'credit_deposits is empty for this chain — pass --from <block> explicitly ' +
          '(e.g. the block the vault was deployed, or the block near commit ab02dd2 merged, 2026-07-04).'
        );
      }
      fromBlock = Math.max(0, earliest - 50_000);
    }

    console.log(`[verify] chain=${chainId} vault=${vaultAddress}`);
    console.log(`[verify] scanning on-chain Deposited events ${fromBlock}..${toBlock} (chunk=${chunk})`);

    const onChainByTx = new Map();
    for (let start = fromBlock; start <= toBlock; start += chunk) {
      const end = Math.min(start + chunk - 1, toBlock);
      const events = await contract.queryFilter('Deposited', start, end);
      for (const ev of events) {
        const [from, amount] = ev.args;
        onChainByTx.set(ev.transactionHash, {
          from: String(from).toLowerCase(),
          amountUsdt: parseFloat(ethers.formatUnits(amount, USDT_DECIMALS)),
          blockNumber: ev.blockNumber,
        });
      }
      if ((start / chunk) % 20 === 0) {
        console.log(`[verify]   ...scanned through block ${end} (${onChainByTx.size} events so far)`);
      }
    }
    console.log(`[verify] on-chain: ${onChainByTx.size} Deposited event(s) in range`);

    const recorded = await pool.query(
      `SELECT tx_hash, block_number, amount_usdt, wallet_address FROM credit_deposits
        WHERE chain_id = $1 AND block_number BETWEEN $2 AND $3`,
      [chainId, fromBlock, toBlock]
    );
    const recordedTx = new Set(recorded.rows.map((r) => r.tx_hash));
    console.log(`[verify] credit_deposits: ${recordedTx.size} recorded row(s) in the same range`);

    const missing = [...onChainByTx.entries()].filter(([tx]) => !recordedTx.has(tx));

    console.log('');
    if (missing.length === 0) {
      console.log('[verify] RESULT: no gap found — every on-chain Deposited event in this range is recorded.');
    } else {
      console.log(`[verify] RESULT: ${missing.length} on-chain deposit(s) are NOT in credit_deposits:`);
      for (const [tx, ev] of missing) {
        console.log(
          `  tx=${tx} block=${ev.blockNumber} from=${ev.from} amount=${ev.amountUsdt} USDT ` +
          `→ https://polygonscan.com/tx/${tx}`
        );
      }
      console.log('');
      console.log('[verify] Next step for each: check whether that wallet has a registered account');
      console.log('[verify] (api_credits.wallet_address) and, if so, whether api_deposits already has');
      console.log('[verify] this tx_hash via a manual claim. If neither, it was genuinely missed — credit');
      console.log('[verify] it via the existing verified path: POST /api/keys/deposit (re-verifies on-chain,');
      console.log('[verify] same idempotency as the listener) rather than crediting by hand.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[verify] FAILED:', err.message);
  process.exit(1);
});
