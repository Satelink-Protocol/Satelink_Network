// apps/api/src/middleware/credit_gate.js
// Pre-pay credit gate for RPC calls
// Deducts USDT from credit_balances before serving request
// Returns 402 Payment Required if balance insufficient
// Activates for requests presenting an X-API-Key bound to a wallet (the
// deduction target is resolved from that binding, never from a header).
// Fail-open: on DB error, request is served (never blocks on infra failure)

import { paymentRequiredResponse } from '../utils/payment_required.js';

const DEFAULT_COST_USDT = 0.00003; // $0.000030 — matches seed pricing
const LOG_PREFIX = '[CreditGate]';

export function createCreditGate(db, logger) {
  const log = logger || console;

  // Cache pricing table in memory for 5 min (avoids DB hit per call)
  let pricingCache = null;
  let pricingCacheExpiry = 0;

  async function getPricing() {
    const now = Date.now();
    if (pricingCache && now < pricingCacheExpiry) return pricingCache;

    try {
      const result = await db.query(
        'SELECT method_name, price_usdt FROM rpc_method_pricing WHERE active = true'
      );
      pricingCache = {};
      for (const row of result.rows) {
        pricingCache[row.method_name] = parseFloat(row.price_usdt);
      }
      pricingCacheExpiry = now + 5 * 60 * 1000; // 5 min TTL
      return pricingCache;
    } catch {
      return {}; // fallback to default on DB error
    }
  }

  async function getCost(methodName) {
    const pricing = await getPricing();
    return pricing[methodName] ?? DEFAULT_COST_USDT;
  }

  return async function creditGate(req, res, next) {
    // Customer Zero P0 recovery: when api_credits is canonical, the serving
    // handler authorizes + deducts via creditService. This legacy wallet gate
    // MUST step aside to avoid a double deduction (credit_balances + api_credits).
    if (process.env.CREDIT_CANONICAL === 'true') return next();

    // P0 payer-identity (2026-09): x-wallet-address used to be read directly off
    // the request and trusted as the credit_balances deduction target — C1's
    // twin against this legacy table. A bare header is no longer sufficient: the
    // wallet used for the atomic UPDATE below is resolved ONLY from the
    // api_credits row bound to a presented X-API-Key (the same binding
    // /v1/machine/register proves once, by signature). x-wallet-address alone
    // → 401, never a deduction.
    const rawWallet = req.headers['x-wallet-address'];
    const apiKey = req.headers['x-api-key'];
    if (!rawWallet && !apiKey) return next(); // public/unauthenticated — pass through

    if (!apiKey) {
      return res.status(401).json({
        error: 'wallet_header_insufficient',
        message: 'x-wallet-address alone is not a billing credential. Present a valid X-API-Key (see POST /v1/machine/register).'
      });
    }

    // Resolve the wallet from the account BOUND to the presented api_key — never
    // from the header. Mirrors credit_service.mjs resolveAccount binding
    // (api_credits.wallet_address), the one place api_key↔wallet ownership is
    // established.
    let wallet;
    try {
      const acct = await db.query(
        `SELECT wallet_address FROM api_credits WHERE api_key = $1`,
        [apiKey]
      );
      wallet = acct.rows[0]?.wallet_address ? acct.rows[0].wallet_address.toLowerCase() : null;
    } catch (err) {
      // Fail-open: same posture as the rest of this gate (DB error never blocks).
      log.error(`${LOG_PREFIX} DB error resolving api_key (fail-open): ${err.message}`);
      return next();
    }
    if (!wallet) {
      return res.status(401).json({
        error: 'api_key_not_wallet_bound',
        message: 'This API key has no wallet bound; wallet-based (credit_balances) billing is unavailable for it.'
      });
    }

    // Get method from JSON-RPC body
    const method = req.body?.method || 'eth_call';
    const cost = await getCost(method);

    try {
      // Atomic deduct — only succeeds if balance >= cost
      const result = await db.query(
        `UPDATE credit_balances
         SET balance_usdt = balance_usdt - $1,
             total_spent  = total_spent + $1,
             updated_at   = NOW()
         WHERE lower(wallet_address) = $2
           AND balance_usdt >= $1
         RETURNING balance_usdt`,
        [cost, wallet]
      );

      if (result.rowCount === 0) {
        // Check if wallet exists at all
        const balRow = await db.query(
          'SELECT balance_usdt FROM credit_balances WHERE lower(wallet_address) = $1',
          [wallet]
        );

        const currentBalance = parseFloat(balRow.rows[0]?.balance_usdt ?? 0);

        log.warn(`${LOG_PREFIX} Payment required: wallet=${wallet} balance=${currentBalance} needed=${cost}`);

        // Real deployed addresses as fallback — never tell a paying caller "not deployed yet"
        // (the vault IS live at 0x80AF…; an unset env must not block deposits).
        const VAULT = process.env.REVENUE_VAULT_ADDRESS || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';
        const USDT = process.env.USDT_CONTRACT_ADDRESS || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
        const API_BASE = process.env.API_BASE_URL || 'https://rpc.satelink.network';

        return res.status(402).json(paymentRequiredResponse({
          error: 'Insufficient credits',
          balance_usdt: currentBalance,
          required_usdt: cost,
          rpc_method: method,
          deposit_address: VAULT,
          network: 'Polygon Mainnet (chainId: 137)',
          usdt_contract: USDT,
          payment: {
            vault_address: VAULT,
            token: 'USDT',
            token_address: USDT,
            chain_id: 137,
            chain_name: 'Polygon',
            minimum_deposit_usdt: parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50'),
            deposit_url: `${API_BASE}/credits/initiate?amount=10`,
            docs: 'https://satelink.network/docs'
          },
          message: 'Deposit USDT to RevenueVault to continue. Low-balance auto-refill recommended.'
        }));
      }

      // Attach metadata for downstream logging
      req.creditDeducted = cost;
      req.creditWallet = wallet;
      req.creditBalanceAfter = parseFloat(result.rows[0].balance_usdt);

      next();

    } catch (err) {
      // Fail-open: log error but do NOT block the request
      log.error(`${LOG_PREFIX} DB error (fail-open): ${err.message}`);
      next();
    }
  };
}
