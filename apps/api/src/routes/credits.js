// apps/api/src/routes/credits.js
// Credit balance API for autonomous payer wallets
// GET  /credits/balance?wallet=0x...         → current balance
// GET  /credits/deposits?wallet=0x...        → deposit history
// POST /credits/check                        → pre-flight balance check
// GET  /credits/deposit/initiate?amount=<n>  → ready-to-sign EVM calldata

import express from 'express';
import { ethers } from 'ethers';

export function createCreditsRouter(db, logger) {
  const router = express.Router();
  const log = logger || console;

  // GET /credits/balance?wallet=0x...  OR  GET /credits/balance with X-Api-Key header
  //
  // apiKey lookup added for T-1.4 (Dodo checkout success page): a
  // Dodo-funded account (api_credits row keyed by api_key, e.g. "sk_dodo_...")
  // has no wallet_address at all, so the wallet-only lookup below can never
  // find it. Deliberately a HEADER, not a query param — a wallet address is
  // public info either way, but an api_key is a bearer credential, and a
  // query param would land it in access logs and any Referer this page's
  // outbound requests send. Exactly one of wallet/X-Api-Key is required.
  router.get('/balance', async (req, res) => {
    const wallet = req.query.wallet?.toLowerCase();
    const apiKey = typeof req.header('x-api-key') === 'string' ? req.header('x-api-key').trim() : '';

    if (apiKey) {
      if (!apiKey.startsWith('sk_')) {
        return res.status(400).json({ error: 'Invalid apiKey parameter' });
      }
      try {
        const result = await db.query(
          `SELECT api_key, credits_usdt, total_deposited, total_spent, tier, last_used, created_at
             FROM api_credits WHERE api_key = $1`,
          [apiKey]
        );
        const rows = result.rows || result;
        if (rows.length === 0) {
          return res.status(404).json({ error: 'no account for this apiKey' });
        }
        const row = rows[0];
        return res.json({
          api_key: row.api_key,
          balance_usdt: parseFloat(row.credits_usdt || 0),
          total_deposited: parseFloat(row.total_deposited || 0),
          total_spent: parseFloat(row.total_spent || 0),
          tier: row.tier,
          last_deposit_at: row.last_used,
          status: parseFloat(row.credits_usdt || 0) > 0 ? 'funded' : 'empty',
        });
      } catch (err) {
        log.error('[Credits] balance (apiKey) error:', err.message);
        return res.status(500).json({ error: 'Internal error' });
      }
    }

    if (!wallet || !wallet.match(/^0x[0-9a-f]{40}$/)) {
      return res.status(400).json({ error: 'Invalid or missing wallet parameter (or pass an X-Api-Key header instead)' });
    }

    try {
      // CANONICAL: api_credits is the only store the serving path deducts
      // from (see billing/credit_service.mjs). credit_balances is legacy and
      // is never updated by a real request, so a balance read from it here
      // would show a number that never moves — the exact Customer Zero bug.
      const result = await db.query(
        `SELECT api_key, wallet_address, credits_usdt, total_deposited, total_spent,
                last_used, created_at
         FROM api_credits
         WHERE lower(wallet_address) = $1
         ORDER BY created_at ASC LIMIT 1`,
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
        balance_usdt: parseFloat(row.credits_usdt || 0),
        total_deposited: parseFloat(row.total_deposited || 0),
        total_spent: parseFloat(row.total_spent || 0),
        last_deposit_tx: null,
        last_deposit_at: row.last_used,
        status: parseFloat(row.credits_usdt || 0) > 0 ? 'funded' : 'empty',
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
      transactions: [
        {
          step: 1,
          description: 'Approve USDT spending',
          to: usdtAddress,
          data: approveCalldata,
          value: '0x0',
          chainId: 137,
          gas: '0x186a0'
        },
        {
          step: 2,
          description: 'Deposit USDT to RevenueVault',
          to: vaultAddress,
          data: depositCalldata,
          value: '0x0',
          chainId: 137,
          gas: '0x186a0'
        }
      ],
      integration: {
        header: 'X-Wallet-Address',
        usage: 'Add this header with your wallet address to all RPC calls after deposit',
        balance_endpoint: 'https://rpc.satelink.network/credits/balance?wallet=YOUR_WALLET',
        rpc_endpoint: 'https://rpc.satelink.network/rpc/polygon'
      },
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
        // CANONICAL: api_credits, same store authorizeAndMeter deducts from.
        db.query(
          `SELECT credits_usdt FROM api_credits
            WHERE lower(wallet_address) = $1
            ORDER BY created_at ASC LIMIT 1`,
          [cleanWallet]
        ),
        db.query(
          'SELECT price_usdt FROM rpc_method_pricing WHERE method_name = $1 AND active = true',
          [method || 'eth_call']
        )
      ]);
      const balRows = balResult.rows || balResult;
      const priceRows = priceResult.rows || priceResult;

      const balance = parseFloat(balRows[0]?.credits_usdt ?? 0);
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

  // GET /credits/deposit/initiate?amount=<usdt>
  // Returns ready-to-sign approve + deposit calldata for Polygon Mainnet.
  // Machine flow: sign+submit approveCalldata to USDT, then depositCalldata to vault.
  router.get('/deposit/initiate', async (req, res) => {
    const amountStr = req.query.amount;

    if (!amountStr) {
      return res.status(400).json({ error: 'amount parameter required (USDT value, e.g. 1.00)' });
    }

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (amount > 1_000_000) {
      return res.status(400).json({ error: 'amount exceeds maximum (1,000,000 USDT)' });
    }

    const REVENUE_VAULT_ADDRESS = process.env.REVENUE_VAULT_ADDRESS || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';
    const USDT_ADDRESS = process.env.USDT_CONTRACT_ADDRESS || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
    const CHAIN_ID = 137;
    const USDT_DECIMALS = 6;

    // Convert USDT float to raw uint256 (6 decimals)
    const amountRaw = BigInt(Math.round(amount * 10 ** USDT_DECIMALS));

    // Encode calldata using ethers.js v6 Interface
    const vaultIface = new ethers.Interface(['function deposit(uint256 amount)']);
    const usdtIface = new ethers.Interface([
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function balanceOf(address account) view returns (uint256)'
    ]);

    const approveCalldata = usdtIface.encodeFunctionData('approve', [REVENUE_VAULT_ADDRESS, amountRaw]);
    const depositCalldata = vaultIface.encodeFunctionData('deposit', [amountRaw]);

    // Polygon gas estimates (conservative; machines should set their own gas price)
    const GAS_APPROVE = 46000;
    const GAS_DEPOSIT = 68000;
    // 50 gwei — safe fast on Polygon PoS
    const GAS_PRICE_GWEI = 50;
    const GAS_PRICE_WEI = BigInt(GAS_PRICE_GWEI) * BigInt(1e9);

    const revenueVaultAbi = [
      {
        type: 'function', name: 'deposit',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [], stateMutability: 'nonpayable'
      },
      {
        type: 'event', name: 'Deposited',
        inputs: [
          { name: 'from', type: 'address', indexed: true },
          { name: 'amount', type: 'uint256', indexed: false }
        ]
      }
    ];

    const usdtAbi = [
      {
        type: 'function', name: 'approve',
        inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
        outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable'
      },
      {
        type: 'function', name: 'allowance',
        inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view'
      },
      {
        type: 'function', name: 'balanceOf',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view'
      }
    ];

    return res.json({
      revenueVaultAddress: REVENUE_VAULT_ADDRESS,
      usdtAddress: USDT_ADDRESS,
      chainId: CHAIN_ID,
      amountUsdt: amount,
      amountRaw: amountRaw.toString(),
      approveCalldata,
      depositCalldata,
      gasEstimate: {
        approve: (BigInt(GAS_APPROVE) * GAS_PRICE_WEI).toString(),
        deposit: (BigInt(GAS_DEPOSIT) * GAS_PRICE_WEI).toString(),
        approveGasUnits: GAS_APPROVE,
        depositGasUnits: GAS_DEPOSIT,
        gasPriceGwei: GAS_PRICE_GWEI
      },
      abi: {
        revenueVault: revenueVaultAbi,
        usdt: usdtAbi
      },
      instructions: [
        { step: 1, action: 'approve', to: USDT_ADDRESS, data: approveCalldata, description: 'Approve USDT to RevenueVault' },
        { step: 2, action: 'deposit', to: REVENUE_VAULT_ADDRESS, data: depositCalldata, description: 'Deposit USDT into RevenueVault' },
        { step: 3, action: 'header', description: 'Add X-Wallet-Address: <your-wallet> to RPC calls' }
      ],
      network: 'Polygon Mainnet (chainId: 137)',
      polygonscan: `https://polygonscan.com/address/${REVENUE_VAULT_ADDRESS}`
    });
  });

  // Alias: GET /credits/:wallet → /credits/balance?wallet=:wallet
  router.get('/:wallet', (req, res) => res.redirect(`/credits/balance?wallet=${req.params.wallet}`));

  return router;
}
