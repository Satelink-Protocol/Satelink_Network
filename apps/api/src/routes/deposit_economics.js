// apps/api/src/routes/deposit_economics.js
//
// P0 deposit-page backend. Path-param credit balance/history + on-chain vault balance.
// Contract matches apps/web/src/lib/deposit-api.ts:
//   GET /v1/credits/balance/:wallet  → CreditBalance  { wallet, creditsUsdt, lastDepositAt, pendingDeposits }
//   GET /v1/credits/history/:wallet  → DepositRecord[] [{ txHash, amountUsdt, status, createdAt }]
//   GET /v1/vault/balance            → { address, balanceUsdt }
//
// Schema verified against production Postgres via psql (2026-06-20):
//   credit_balances(wallet_address, balance_usdt, total_deposited, total_spent,
//                   last_deposit_tx, last_deposit_at, created_at, updated_at)
//   credit_deposits(wallet_address, amount_usdt, tx_hash, block_number, chain_id, confirmed_at)
// credit_deposits has no status column — every row is a confirmed on-chain deposit, so
// status is reported as CONFIRMED and createdAt maps to confirmed_at.
//
// Uses the pg pool (async pool.query), matching createCreditsRouter in ./credits.js.

import { Router } from 'express';
import { ethers } from 'ethers';

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const METERING_RATE_USDT = 0.00003; // confirmed production rate: $0.00003 / RPC call

export function createDepositEconomicsRouter(pool, logger = console) {
  const router = Router();

  // GET /balance/:wallet → CreditBalance
  router.get('/balance/:wallet', async (req, res) => {
    const wallet = (req.params.wallet || '').toLowerCase();
    if (!WALLET_RE.test(wallet)) {
      return res.status(400).json({ error: 'invalid wallet address' });
    }
    try {
      const result = await pool.query(
        `SELECT wallet_address, balance_usdt, total_spent, last_deposit_at
           FROM credit_balances
          WHERE lower(wallet_address) = $1`,
        [wallet]
      );
      const rows = result.rows || result;

      if (rows.length === 0) {
        // No account row yet = zero balance, not an error.
        return res.status(200).json({
          wallet,
          creditsUsdt: 0,
          consumedUsdt: 0,
          estimatedRemainingCalls: 0,
          lastDepositAt: null,
          pendingDeposits: 0,
        });
      }

      const row = rows[0];
      const creditsUsdt = parseFloat(row.balance_usdt) || 0;
      return res.status(200).json({
        wallet: row.wallet_address,
        creditsUsdt,
        // total_spent is the authoritative per-wallet consumption (credit_gate.js deducts
        // into it on each billed call) — billing_events does not exist in this schema.
        consumedUsdt: parseFloat(row.total_spent) || 0,
        estimatedRemainingCalls: Math.floor(creditsUsdt / METERING_RATE_USDT),
        lastDepositAt: row.last_deposit_at,
        // No pending-deposit state exists in the schema (deposits are written only once
        // confirmed on-chain), so this is always 0 rather than a fabricated count.
        pendingDeposits: 0,
      });
    } catch (err) {
      logger.error('[DepositEconomics] balance error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  // GET /history/:wallet?page=&limit= → paginated { deposits, page, limit, total, hasMore }
  router.get('/history/:wallet', async (req, res) => {
    const wallet = (req.params.wallet || '').toLowerCase();
    if (!WALLET_RE.test(wallet)) {
      return res.status(400).json({ error: 'invalid wallet address' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;
    try {
      const result = await pool.query(
        `SELECT tx_hash, amount_usdt, confirmed_at, COUNT(*) OVER() AS total_count
           FROM credit_deposits
          WHERE lower(wallet_address) = $1
          ORDER BY confirmed_at DESC
          LIMIT $2 OFFSET $3`,
        [wallet, limit, offset]
      );
      const rows = result.rows || result;
      const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      return res.status(200).json({
        deposits: rows.map((r) => ({
          txHash: r.tx_hash,
          amountUsdt: parseFloat(r.amount_usdt) || 0,
          status: 'CONFIRMED', // credit_deposits only stores confirmed on-chain deposits
          createdAt: r.confirmed_at,
        })),
        page,
        limit,
        total,
        hasMore: offset + rows.length < total,
      });
    } catch (err) {
      logger.error('[DepositEconomics] history error:', err.message);
      return res.status(500).json({ error: 'internal_error' });
    }
  });

  return router;
}

// GET /vault/balance → live on-chain USDT balance of the RevenueVault (no DB).
// Reads through the configured Polygon RPC; addresses come from env (no hardcoding).
export function createVaultRouter(logger = console) {
  const router = Router();
  const RPC_URL =
    process.env.POLYGON_RPC_URL || 'https://rpc.satelink.network/rpc/polygon';
  const VAULT =
    process.env.REVENUE_VAULT_ADDRESS ||
    '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3';
  const USDT =
    process.env.POLYGON_USDT_ADDRESS ||
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
  const USDT_DECIMALS = 6;
  const ERC20_BALANCEOF_ABI = ['function balanceOf(address) view returns (uint256)'];

  router.get('/balance', async (req, res) => {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const usdt = new ethers.Contract(USDT, ERC20_BALANCEOF_ABI, provider);
      const raw = await usdt.balanceOf(VAULT);
      const balanceUsdt = Number(ethers.formatUnits(raw, USDT_DECIMALS));
      return res.status(200).json({ address: VAULT, balanceUsdt });
    } catch (err) {
      logger.error('[VaultBalance] chain read failed:', err.message);
      // Frontend falls back to the Polygonscan link on failure — a 502 here is fine.
      return res.status(502).json({ error: 'chain_read_failed' });
    }
  });

  return router;
}
