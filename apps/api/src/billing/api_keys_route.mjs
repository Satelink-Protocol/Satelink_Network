/**
 * Simple API Key Management
 * POST /api/keys — Create free tier key (no auth required)
 * GET /api/keys/:key/usage — Check usage
 * POST /api/keys/:key/deposit — Verify USDT deposit and upgrade tier
 */

import { Router } from 'express';
import { ethers } from 'ethers';
import {
  createApiKeyWithCredits,
  getKeyUsageSummary,
  ensureCreditTables,
  TIERS
} from './credit_system.mjs';
import { discord } from '../services/discord_notify.mjs';

const TREASURY = process.env.REVENUE_VAULT_ADDRESS || '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3';
const USDT_POLYGON = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const POLYGON_RPC = 'https://polygon.drpc.org';

const TIER_PRICES = {
  basic: 9,
  pro: 49,
  enterprise: 199,
};

const TIER_LIMITS = {
  free: 500,
  basic: 10000,
  pro: 100000,
  enterprise: 1000000,
};

export function createSimpleApiKeysRouter(pool) {
  const router = Router();

  ensureCreditTables(pool);

  router.post('/', async (req, res) => {
    const { tier = 'free', wallet_address } = req.body || {};

    if (!TIERS[tier]) {
      return res.status(400).json({
        ok: false,
        error: `Invalid tier: ${tier}`,
        valid_tiers: Object.keys(TIERS)
      });
    }

    if (tier !== 'free') {
      return res.status(400).json({
        ok: false,
        error: 'Only free tier available via self-service. Contact us for paid tiers.',
        upgrade_url: 'https://app.satelink.network/satelink/os/plans'
      });
    }

    try {
      const result = await createApiKeyWithCredits(pool, tier, wallet_address || null);

      return res.json({
        ok: true,
        api_key: result.api_key,
        tier: result.tier,
        daily_limit: result.daily_limit,
        usage: `Add header: X-API-Key: ${result.api_key}`,
        example: `curl -X POST https://rpc.satelink.network/rpc/polygon -H "X-API-Key: ${result.api_key}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
        docs: 'https://docs.satelink.network'
      });
    } catch (err) {
      console.error('[ApiKeys] Create failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Failed to create API key' });
    }
  });

  router.get('/:key/usage', async (req, res) => {
    const { key } = req.params;

    if (!key || (!key.startsWith('sk_free') && !key.startsWith('sk_basic') && !key.startsWith('sk_pro') && !key.startsWith('sk_ent') && !key.startsWith('sk_live'))) {
      return res.status(400).json({ ok: false, error: 'Invalid API key format' });
    }

    try {
      const usage = await getKeyUsageSummary(pool, key);

      if (!usage) {
        return res.status(404).json({ ok: false, error: 'API key not found' });
      }

      return res.json({ ok: true, ...usage });
    } catch (err) {
      console.error('[ApiKeys] Usage check failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Failed to get usage' });
    }
  });

  router.get('/tiers', (req, res) => {
    const tiers = Object.entries(TIERS).map(([name, config]) => ({
      tier: name,
      daily_limit: config.daily_limit,
      price_usdt_month: config.price_usdt,
      available: true
    }));

    res.json({
      ok: true,
      tiers,
      deposit: {
        address: TREASURY,
        network: 'Polygon (ChainId 137)',
        token: 'USDT',
        token_address: USDT_POLYGON,
      }
    });
  });

  // POST /api/keys/:key/deposit — Verify USDT deposit by TX hash
  router.post('/:key/deposit', async (req, res) => {
    const { key } = req.params;
    const { tx_hash, tier } = req.body || {};

    if (!tx_hash || !tx_hash.startsWith('0x') || tx_hash.length !== 66) {
      return res.status(400).json({
        ok: false,
        error: 'tx_hash required',
        message: 'Provide the Polygon transaction hash of your USDT deposit',
        deposit_info: {
          address: TREASURY,
          network: 'Polygon (ChainId 137)',
          token: 'USDT (6 decimals)',
          token_address: USDT_POLYGON,
          pricing: TIER_PRICES,
        },
        example: { tx_hash: '0x...', tier: 'basic' }
      });
    }

    try {
      // Verify key exists
      const keyRow = await pool.query(
        'SELECT * FROM api_credits WHERE api_key = $1', [key]
      );
      if (!keyRow.rows[0]) {
        return res.status(404).json({ ok: false, error: 'API key not found' });
      }

      // Check if TX was already used
      const existingTx = await pool.query(
        'SELECT 1 FROM api_deposits WHERE tx_hash = $1', [tx_hash]
      ).catch(() => ({ rows: [] }));

      if (existingTx.rows.length > 0) {
        return res.status(400).json({
          ok: false,
          error: 'tx_already_used',
          message: 'This transaction has already been credited to an account'
        });
      }

      // Verify TX on Polygon
      const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
      let receipt;
      try {
        receipt = await provider.getTransactionReceipt(tx_hash);
      } catch (e) {
        return res.status(400).json({
          ok: false,
          error: 'tx_not_found',
          message: 'Transaction not found on Polygon. Wait for confirmation.',
        });
      }

      if (!receipt || receipt.status !== 1) {
        return res.status(400).json({
          ok: false,
          error: 'tx_failed',
          message: 'Transaction failed or still pending',
        });
      }

      // Parse USDT transfer amount from logs
      const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const usdtInterface = new ethers.Interface([
        'event Transfer(address indexed from, address indexed to, uint256 value)'
      ]);

      let depositAmount = 0;
      let fromAddress = '';
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === USDT_POLYGON.toLowerCase() &&
            log.topics[0] === TRANSFER_TOPIC) {
          try {
            const decoded = usdtInterface.parseLog({ topics: log.topics, data: log.data });
            if (decoded.args.to.toLowerCase() === TREASURY.toLowerCase()) {
              depositAmount = parseFloat(ethers.formatUnits(decoded.args.value, 6));
              fromAddress = decoded.args.from;
              break;
            }
          } catch {}
        }
      }

      if (depositAmount === 0) {
        return res.status(400).json({
          ok: false,
          error: 'no_usdt_received',
          message: `No USDT found sent to treasury (${TREASURY}) in this transaction`,
          tx_hash,
        });
      }

      // Determine tier from deposit amount or requested tier
      let newTier = keyRow.rows[0].tier;
      let newLimit = keyRow.rows[0].daily_limit;

      if (tier === 'enterprise' && depositAmount >= TIER_PRICES.enterprise) {
        newTier = 'enterprise'; newLimit = TIER_LIMITS.enterprise;
      } else if (tier === 'pro' && depositAmount >= TIER_PRICES.pro) {
        newTier = 'pro'; newLimit = TIER_LIMITS.pro;
      } else if (tier === 'basic' && depositAmount >= TIER_PRICES.basic) {
        newTier = 'basic'; newLimit = TIER_LIMITS.basic;
      } else if (depositAmount >= TIER_PRICES.enterprise) {
        newTier = 'enterprise'; newLimit = TIER_LIMITS.enterprise;
      } else if (depositAmount >= TIER_PRICES.pro) {
        newTier = 'pro'; newLimit = TIER_LIMITS.pro;
      } else if (depositAmount >= TIER_PRICES.basic) {
        newTier = 'basic'; newLimit = TIER_LIMITS.basic;
      } else {
        return res.status(400).json({
          ok: false,
          error: 'insufficient_deposit',
          message: `Deposit of $${depositAmount} is below minimum tier price ($${TIER_PRICES.basic})`,
          minimum_required: TIER_PRICES.basic,
          deposited: depositAmount,
        });
      }

      // Record deposit
      await pool.query(`
        CREATE TABLE IF NOT EXISTS api_deposits (
          id SERIAL PRIMARY KEY,
          api_key VARCHAR(100) NOT NULL,
          tx_hash VARCHAR(66) UNIQUE NOT NULL,
          amount_usdt NUMERIC(18,6) NOT NULL,
          from_address VARCHAR(42),
          tier_before VARCHAR(20),
          tier_after VARCHAR(20),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `).catch(() => {});

      await pool.query(`
        INSERT INTO api_deposits (api_key, tx_hash, amount_usdt, from_address, tier_before, tier_after)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [key, tx_hash, depositAmount, fromAddress, keyRow.rows[0].tier, newTier]);

      // Credit the account
      await pool.query(`
        UPDATE api_credits
        SET credits_usdt = COALESCE(credits_usdt, 0) + $1,
            total_deposited = COALESCE(total_deposited, 0) + $1,
            tier = $2,
            daily_limit = $3
        WHERE api_key = $4
      `, [depositAmount, newTier, newLimit, key]);

      console.log(`[DEPOSIT] Key ${key.slice(0, 12)}... deposited $${depositAmount} USDT → ${newTier} (TX: ${tx_hash.slice(0, 10)}...)`);

      discord.deposit(key, depositAmount, newTier).catch(() => {});

      return res.json({
        ok: true,
        deposited_usdt: depositAmount,
        new_tier: newTier,
        new_daily_limit: newLimit,
        credits_added: depositAmount,
        message: `Upgraded to ${newTier} — ${newLimit.toLocaleString()} requests/day`,
        tx_hash,
      });

    } catch (err) {
      console.error('[DEPOSIT] Error:', err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/keys/:key/deposit-info — Get deposit instructions
  router.get('/:key/deposit-info', async (req, res) => {
    const { key } = req.params;

    try {
      const keyRow = await pool.query(
        'SELECT tier, daily_limit, credits_usdt, total_deposited FROM api_credits WHERE api_key = $1', [key]
      );

      if (!keyRow.rows[0]) {
        return res.status(404).json({ ok: false, error: 'API key not found' });
      }

      const k = keyRow.rows[0];

      return res.json({
        ok: true,
        current_tier: k.tier,
        current_limit: k.daily_limit,
        credits_balance: parseFloat(k.credits_usdt || 0),
        total_deposited: parseFloat(k.total_deposited || 0),
        deposit: {
          address: TREASURY,
          network: 'Polygon (ChainId 137)',
          token: 'USDT',
          token_address: USDT_POLYGON,
        },
        pricing: {
          basic: { price: TIER_PRICES.basic, limit: TIER_LIMITS.basic },
          pro: { price: TIER_PRICES.pro, limit: TIER_LIMITS.pro },
          enterprise: { price: TIER_PRICES.enterprise, limit: TIER_LIMITS.enterprise },
        },
        instructions: [
          `1. Send USDT to ${TREASURY} on Polygon network`,
          '2. Copy your transaction hash after confirmation',
          `3. POST /api/keys/${key}/deposit with {"tx_hash":"0x...","tier":"pro"}`,
          '4. Your API key will be upgraded immediately'
        ]
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
