// apps/api/src/routes/credits.js
// Credit balance API for autonomous payer wallets
// GET  /credits/balance?wallet=0x...  → current balance
// GET  /credits/deposits?wallet=0x... → deposit history
// POST /credits/check                 → pre-flight balance check

import express from 'express';

export function createCreditsRouter(db, logger) {
  const router = express.Router();
  const log = logger || console;

  // GET /credits/balance?wallet=0x...
  router.get('/balance', async (req, res) => {
    const wallet = req.query.wallet?.toLowerCase();
    if (!wallet || !wallet.match(/^0x[0-9a-f]{40}$/)) {
      return res.status(400).json({ error: 'Invalid or missing wallet parameter' });
    }

    try {
      const result = await db.query(
        `SELECT wallet_address, balance_usdt, total_deposited, total_spent,
                last_deposit_tx, last_deposit_at, created_at
         FROM credit_balances
         WHERE lower(wallet_address) = $1`,
        [wallet]
      );
      const rows = result.rows || result;

      if (rows.length === 0) {
        return res.json({
          wallet,
          balance_usdt: 0,
          total_deposited: 0,
          total_spent: 0,
          last_deposit_tx: null,
          status: 'no_account',
          deposit_address: process.env.REVENUE_VAULT_ADDRESS,
          network: 'Polygon Mainnet (chainId: 137)'
        });
      }

      const row = rows[0];
      return res.json({
        wallet: row.wallet_address,
        balance_usdt: parseFloat(row.balance_usdt),
        total_deposited: parseFloat(row.total_deposited),
        total_spent: parseFloat(row.total_spent),
        last_deposit_tx: row.last_deposit_tx,
        last_deposit_at: row.last_deposit_at,
        status: parseFloat(row.balance_usdt) > 0 ? 'funded' : 'empty',
        deposit_address: process.env.REVENUE_VAULT_ADDRESS,
        network: 'Polygon Mainnet (chainId: 137)'
      });
    } catch (err) {
      log.error('[Credits] balance error:', err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  // GET /credits/deposits?wallet=0x...&limit=20
  router.get('/deposits', async (req, res) => {
    const wallet = req.query.wallet?.toLowerCase();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    if (!wallet || !wallet.match(/^0x[0-9a-f]{40}$/)) {
      return res.status(400).json({ error: 'Invalid or missing wallet parameter' });
    }

    try {
      const result = await db.query(
        `SELECT tx_hash, amount_usdt, block_number, chain_id, confirmed_at
         FROM credit_deposits
         WHERE lower(wallet_address) = $1
         ORDER BY confirmed_at DESC
         LIMIT $2`,
        [wallet, limit]
      );
      const rows = result.rows || result;

      return res.json({
        wallet,
        deposits: rows.map(r => ({
          tx_hash: r.tx_hash,
          amount_usdt: parseFloat(r.amount_usdt),
          block_number: r.block_number,
          chain_id: r.chain_id,
          confirmed_at: r.confirmed_at,
          polygonscan: `https://polygonscan.com/tx/${r.tx_hash}`
        })),
        total: rows.length
      });
    } catch (err) {
      log.error('[Credits] deposits error:', err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  // GET /credits/initiate?amount=<usdt_amount> — return deposit calldata for autonomous payers
  router.get('/initiate', (req, res) => {
    const { amount } = req.query;
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const amountUsdt = parseFloat(amount);
    const amountRaw = (amountUsdt * 1_000_000).toFixed(0);
    const vaultAddress = process.env.REVENUE_VAULT_ADDRESS;
    const usdtAddress = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';

    // Manual ABI encoding — approve(address,uint256) selector 0x095ea7b3
    const paddedVault = (vaultAddress || '').replace(/^0x/i, '').toLowerCase().padStart(64, '0');
    const paddedAmount = BigInt(amountRaw).toString(16).padStart(64, '0');
    const approveCalldata = `0x095ea7b3${paddedVault}${paddedAmount}`;

    // Manual ABI encoding — deposit(uint256) selector 0xb6b55f25
    const depositCalldata = `0xb6b55f25${paddedAmount}`;

    return res.json({
      revenueVaultAddress: vaultAddress,
      usdtAddress,
      chainId: 137,
      amountUsdt,
      amountRaw,
      approveCalldata,
      depositCalldata,
      instructions: [
        'Step 1: Call USDT.approve(revenueVaultAddress, amountRaw) on Polygon',
        'Step 2: Call RevenueVault.deposit(amountRaw) on Polygon',
        'Chain: Polygon Mainnet (chainId 137)'
      ]
    });
  });

  // POST /credits/check — pre-flight: can this wallet afford X calls?
  router.post('/check', async (req, res) => {
    const { wallet, method, call_count } = req.body;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });

    const cleanWallet = wallet.toLowerCase();
    const count = parseInt(call_count) || 1;

    try {
      const [balResult, priceResult] = await Promise.all([
        db.query(
          'SELECT balance_usdt FROM credit_balances WHERE lower(wallet_address) = $1',
          [cleanWallet]
        ),
        db.query(
          'SELECT price_usdt FROM rpc_method_pricing WHERE method_name = $1 AND active = true',
          [method || 'eth_call']
        )
      ]);
      const balRows = balResult.rows || balResult;
      const priceRows = priceResult.rows || priceResult;

      const balance = parseFloat(balRows[0]?.balance_usdt ?? 0);
      const costPerCall = parseFloat(priceRows[0]?.price_usdt ?? 0.00003);
      const totalCost = costPerCall * count;
      const canAfford = balance >= totalCost;
      const callsAffordable = Math.floor(balance / costPerCall);

      return res.json({
        wallet: cleanWallet,
        balance_usdt: balance,
        method: method || 'eth_call',
        cost_per_call: costPerCall,
        call_count: count,
        total_cost: totalCost,
        can_afford: canAfford,
        calls_affordable: callsAffordable,
        shortfall_usdt: canAfford ? 0 : parseFloat((totalCost - balance).toFixed(6))
      });
    } catch (err) {
      log.error('[Credits] check error:', err.message);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
