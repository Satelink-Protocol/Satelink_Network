/**
 * Simple API Key Management
 * The API key is a bearer secret — pass it in the X-API-Key header (never the
 * URL path) for every key-scoped endpoint.
 * POST /api/keys              — Create free tier key (no auth required, rate-limited)
 *                               Optional body: { email, email_consent } captures opt-in contact.
 * POST /api/keys/email        — Attach/update opt-in email for an existing key (X-API-Key header)
 * GET  /api/keys/usage        — Check usage           (X-API-Key header)
 * GET  /api/keys/deposit-info — Deposit instructions  (X-API-Key header)
 * POST /api/keys/deposit      — Verify USDT deposit + upgrade tier (X-API-Key header)
 * GET  /api/keys/deposits     — Deposit history       (X-API-Key header)
 * GET  /api/keys/usage-history— Daily usage history   (X-API-Key header)
 */

import { Router } from 'express';
import { ethers } from 'ethers';
import {
  createApiKeyWithCredits,
  getKeyUsageSummary,
  ensureCreditTables,
  setKeyEmail,
  normaliseEmail,
  TIERS
} from './credit_system.mjs';
import { discord } from '../services/discord_notify.mjs';
import { isFounderWallet } from '../payments/founder_wallets.js';
import {
  apiKeyCreateLimiter,
  apiKeyDepositLimiter,
  apiKeyReadLimiter
} from '../security/middleware/rate_limits.js';
import {
  extractApiKey,
  isValidKeyFormat,
  checkDepositOwnership,
  hasEnoughConfirmations,
  confirmationCount,
  MIN_CONFIRMATIONS
} from './deposit_validation.mjs';

const TREASURY = process.env.REVENUE_VAULT_ADDRESS || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';
const USDT_POLYGON = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const POLYGON_RPC = 'https://polygon.drpc.org';

const TIER_PRICES = {
  basic: 9,
  pro: 49,
  enterprise: 199,
};

// Pay-as-you-go floor — must match what the 402 bodies advertise
// (credit_gate/payment_required: minimum_deposit_usdt 0.50).
const MIN_DEPOSIT_USDT = parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50');

const TIER_LIMITS = {
  free: 500,
  basic: 10000,
  pro: 100000,
  enterprise: 1000000,
};

export function createSimpleApiKeysRouter(pool) {
  const router = Router();

  ensureCreditTables(pool);

  router.post('/', apiKeyCreateLimiter, async (req, res) => {
    const { tier = 'free', wallet_address, email, email_consent } = req.body || {};

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

    // Email is optional. If supplied it must be valid — we reject junk rather
    // than silently dropping it, so callers know their address was not stored.
    let normalisedEmail = null;
    if (email !== undefined && email !== null && email !== '') {
      normalisedEmail = normaliseEmail(email);
      if (!normalisedEmail) {
        return res.status(400).json({ ok: false, error: 'Invalid email format' });
      }
    }

    try {
      const result = await createApiKeyWithCredits(pool, tier, wallet_address || null, {
        email: normalisedEmail,
        emailConsent: email_consent === true,
      });

      return res.json({
        ok: true,
        api_key: result.api_key,
        tier: result.tier,
        daily_limit: result.daily_limit,
        email_captured: result.email_captured,
        usage: `Add header: X-API-Key: ${result.api_key}`,
        example: `curl -X POST https://rpc.satelink.network/rpc/polygon -H "X-API-Key: ${result.api_key}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
        docs: 'https://docs.satelink.network'
      });
    } catch (err) {
      console.error('[ApiKeys] Create failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Failed to create API key' });
    }
  });

  // POST /api/keys/email — Attach/update opt-in contact email for an existing key
  // (key via X-API-Key header). Lets keyholders created before email collection
  // opt in. `email_consent: true` marks the address as outreach-eligible.
  router.post('/email', apiKeyReadLimiter, async (req, res) => {
    const key = extractApiKey(req);
    const { email, email_consent } = req.body || {};

    if (!isValidKeyFormat(key)) {
      return res.status(400).json({ ok: false, error: 'Invalid API key format' });
    }

    const normalisedEmail = normaliseEmail(email);
    if (!normalisedEmail) {
      return res.status(400).json({ ok: false, error: 'Invalid email format' });
    }

    try {
      const updated = await setKeyEmail(pool, key, normalisedEmail, email_consent === true);
      if (!updated) {
        return res.status(404).json({ ok: false, error: 'API key not found' });
      }
      return res.json({
        ok: true,
        email_captured: true,
        email_consent: email_consent === true,
        message: email_consent === true
          ? 'Email saved. You may receive product and usage updates.'
          : 'Email saved for account/transactional contact only.',
      });
    } catch (err) {
      console.error('[ApiKeys] Email capture failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Failed to save email' });
    }
  });

  router.get('/usage', apiKeyReadLimiter, async (req, res) => {
    const key = extractApiKey(req);

    if (!isValidKeyFormat(key)) {
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

  // POST /api/keys/deposit — Verify USDT deposit by TX hash (key via X-API-Key header)
  router.post('/deposit', apiKeyDepositLimiter, async (req, res) => {
    const key = extractApiKey(req);
    const { tx_hash, tier } = req.body || {};

    if (!isValidKeyFormat(key)) {
      return res.status(400).json({ ok: false, error: 'Invalid API key format' });
    }

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

      // Require sufficient confirmation depth before crediting irreversible
      // balance — a shallow tx can still be reorged out on Polygon.
      let currentBlock;
      try {
        currentBlock = await provider.getBlockNumber();
      } catch (e) {
        return res.status(503).json({
          ok: false,
          error: 'confirmation_check_failed',
          message: 'Unable to verify confirmation depth right now. Please retry shortly.',
        });
      }
      if (!hasEnoughConfirmations(currentBlock, receipt.blockNumber)) {
        const have = Math.max(0, confirmationCount(currentBlock, receipt.blockNumber));
        return res.status(400).json({
          ok: false,
          error: 'insufficient_confirmations',
          message: `Transaction needs at least ${MIN_CONFIRMATIONS} confirmations before it can be credited (currently ${have}).`,
          required: MIN_CONFIRMATIONS,
          confirmations: have,
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

      // OWNERSHIP BINDING (P0): the on-chain sender must exactly match the
      // wallet registered to this API key, and a registered wallet is
      // mandatory. Prevents deposit hijacking where any treasury-bound
      // transaction is claimed by an unrelated key.
      const ownership = checkDepositOwnership(fromAddress, keyRow.rows[0].wallet_address);
      if (!ownership.ok) {
        return res.status(403).json({
          ok: false,
          error: ownership.code,
          message: ownership.error,
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
      } else if (depositAmount >= MIN_DEPOSIT_USDT) {
        // Pay-as-you-go: any deposit >= the advertised minimum buys spendable
        // credits. Free-tier calls bill $0, so lift the account to basic
        // (per-call billing) — otherwise the credits could never be consumed.
        if (newTier === 'free') { newTier = 'basic'; newLimit = TIER_LIMITS.basic; }
      } else {
        return res.status(400).json({
          ok: false,
          error: 'insufficient_deposit',
          message: `Deposit of $${depositAmount} is below the minimum (${MIN_DEPOSIT_USDT} USDT)`,
          minimum_required: MIN_DEPOSIT_USDT,
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
          credited_usdt NUMERIC(18,6),
          from_address VARCHAR(42),
          tier_before VARCHAR(20),
          tier_after VARCHAR(20),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `).catch(() => {});
      await pool.query(`ALTER TABLE api_deposits ADD COLUMN IF NOT EXISTS credited_usdt NUMERIC(18,6)`).catch(() => {});

      await pool.query(`
        INSERT INTO api_deposits (api_key, tx_hash, amount_usdt, credited_usdt, from_address, tier_before, tier_after, is_test_data)
        VALUES ($1, $2, $3, $3, $4, $5, $6, $7)
      `, [key, tx_hash, depositAmount, fromAddress, keyRow.rows[0].tier, newTier, isFounderWallet(fromAddress)]);

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
      return res.status(500).json({ ok: false, error: 'Deposit processing failed' });
    }
  });

  // GET /api/keys/deposit-info — Get deposit instructions (key via X-API-Key header)
  router.get('/deposit-info', apiKeyReadLimiter, async (req, res) => {
    const key = extractApiKey(req);

    if (!isValidKeyFormat(key)) {
      return res.status(400).json({ ok: false, error: 'Invalid API key format' });
    }

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
          `1. Send USDT to ${TREASURY} on Polygon network from your registered wallet`,
          '2. Copy your transaction hash after confirmation',
          '3. POST /api/keys/deposit with header X-API-Key: <your key> and body {"tx_hash":"0x...","tier":"pro"}',
          '4. Your API key will be upgraded once the deposit reaches the required confirmation depth'
        ]
      });
    } catch (err) {
      console.error('[ApiKeys] deposit-info failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Failed to load deposit info' });
    }
  });

  // GET /api/keys/deposits — Fetch deposit history (key via X-API-Key header)
  router.get('/deposits', apiKeyReadLimiter, async (req, res) => {
    const key = extractApiKey(req);
    if (!isValidKeyFormat(key)) {
      return res.status(400).json({ ok: false, error: 'Invalid API key format', deposits: [] });
    }
    try {
      const result = await pool.query(
        'SELECT tx_hash, amount_usdt, created_at FROM api_deposits WHERE api_key = $1 ORDER BY created_at DESC LIMIT 100',
        [key]
      );
      return res.json({ ok: true, deposits: result.rows });
    } catch (err) {
      console.error('[ApiKeys] deposits fetch failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Failed to fetch deposits', deposits: [] });
    }
  });

  // GET /api/keys/usage-history — Fetch daily usage history (key via X-API-Key header)
  router.get('/usage-history', apiKeyReadLimiter, async (req, res) => {
    const key = extractApiKey(req);
    if (!isValidKeyFormat(key)) {
      return res.status(400).json({ ok: false, error: 'Invalid API key format', usage: [] });
    }
    try {
      const result = await pool.query(
        'SELECT date::text as date, request_count, usdt_spent FROM api_usage_daily WHERE api_key = $1 ORDER BY date DESC LIMIT 30',
        [key]
      );
      return res.json({ ok: true, usage: result.rows });
    } catch (err) {
      console.error('[ApiKeys] usage-history fetch failed:', err.message);
      return res.status(500).json({ ok: false, error: 'Failed to fetch usage history', usage: [] });
    }
  });

  return router;
}
