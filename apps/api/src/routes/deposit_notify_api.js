// apps/api/src/routes/deposit_notify_api.js
//
// Deposit notify webhook — lets an autonomous payer signal "I deposited" right
// after broadcasting their USDT transfer, instead of waiting for the next
// DepositListener poll to notice it. The notification is advisory: credits are
// only applied once the deposit is confirmed on-chain by the DepositListener.
// This closes the machine-to-machine loop opened by the machine-readable 402
// (see utils/payment_required.js → notify_url).
//
//   POST /api/deposit/notify
//   body: { wallet_address, tx_hash, chain_id? }
//
// Idempotent on tx_hash. Never leaks stack traces.

import express from 'express';

const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const TXHASH_RE = /^0x[a-fA-F0-9]{64}$/;

// The credit_deposits table predates this endpoint and was built for confirmed
// on-chain deposits (block_number NOT NULL, no status column). A notify arrives
// BEFORE confirmation, so we widen the schema idempotently the first time the
// route is hit: block_number becomes optional, and status/created_at are added.
let _schemaReady = false;
async function ensureSchema(pool) {
  if (_schemaReady) return;
  await pool.query(`ALTER TABLE credit_deposits ALTER COLUMN block_number DROP NOT NULL`).catch(() => {});
  await pool.query(`ALTER TABLE credit_deposits ALTER COLUMN block_number SET DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE credit_deposits ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'confirmed'`).catch(() => {});
  await pool.query(`ALTER TABLE credit_deposits ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`).catch(() => {});
  _schemaReady = true;
}

async function postRevenueAlert(walletAddress, txHash) {
  const webhookUrl = process.env.DISCORD_REVENUE_WEBHOOK_URL;
  if (!webhookUrl) return; // optional — silently skip if unconfigured
  try {
    const content =
      `💳 Deposit Notification — wallet: \`${walletAddress}\` ` +
      `tx: \`${txHash}\` — DepositListener will confirm on-chain`;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) {
      console.error(`[DepositNotify] Discord webhook returned ${res.status}`);
    }
  } catch (e) {
    console.error(`[DepositNotify] Discord alert failed: ${e.message}`);
  }
}

export function createDepositNotifyRouter(pool) {
  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  router.post('/notify', async (req, res) => {
    try {
      const { wallet_address, tx_hash } = req.body || {};

      if (!wallet_address || !WALLET_RE.test(wallet_address)) {
        return res.status(400).json({
          ok: false,
          error: 'invalid_wallet_address',
          message: 'wallet_address must be a 0x-prefixed 40-hex-char address'
        });
      }
      if (!tx_hash || !TXHASH_RE.test(tx_hash)) {
        return res.status(400).json({
          ok: false,
          error: 'invalid_tx_hash',
          message: 'tx_hash must be a 0x-prefixed 64-hex-char transaction hash'
        });
      }

      await ensureSchema(pool);

      // Already seen? Treat as success — the notify is idempotent and the
      // DepositListener owns confirmation either way.
      const existing = await pool.query(
        'SELECT id FROM credit_deposits WHERE tx_hash = $1',
        [tx_hash]
      );
      if (existing.rows.length > 0) {
        return res.json({ ok: true, message: 'Already processing' });
      }

      await pool.query(
        `INSERT INTO credit_deposits (wallet_address, tx_hash, amount_usdt, status, created_at)
         VALUES ($1, $2, 0, 'pending_confirmation', NOW())
         ON CONFLICT (tx_hash) DO NOTHING`,
        [wallet_address, tx_hash]
      );

      await postRevenueAlert(wallet_address, tx_hash);

      return res.json({
        ok: true,
        message: 'Deposit notification received. Credits applied once confirmed on-chain.',
        wallet_address,
        tx_hash
      });
    } catch (err) {
      console.error('[DepositNotify] Error:', err.message);
      return res.status(500).json({ ok: false, error: 'internal_error' });
    }
  });

  return router;
}
