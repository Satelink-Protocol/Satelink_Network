// apps/api/src/routes/machine_onboarding.js
//
// Autonomous machine onboarding surface — the endpoints an agent with a funded
// wallet needs to become a paying customer with zero human involvement:
//
//   GET  /.well-known/satelink.json   — machine-readable service manifest
//   GET  /v1/pricing                  — pricing + deposit semantics
//   POST /v1/machine/register         — wallet-based identity → API key
//
// Every number in the manifest reflects what the serving path ACTUALLY bills
// (creditService flat PRICE_PER_CALL_USDT on paid tiers), never aspirational
// pricing. Static content is cached; register is rate-limited.

import { Router } from 'express';
import { ethers } from 'ethers';
import {
  createApiKeyWithCredits,
  ensureCreditTables,
} from '../billing/credit_system.mjs';
import {
  resolveAccount,
  PRICE_PER_CALL_USDT,
  TIER_DAILY_LIMIT,
} from '../billing/credit_service.mjs';
import { MIN_CONFIRMATIONS } from '../billing/deposit_validation.mjs';
import { apiKeyCreateLimiter } from '../security/middleware/rate_limits.js';

const API_BASE = () => process.env.API_BASE_URL || 'https://rpc.satelink.network';
const VAULT = () => process.env.REVENUE_VAULT_ADDRESS || '0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3';
const USDT = () => process.env.USDT_CONTRACT_ADDRESS || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const MIN_DEPOSIT_USDT = () => parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50');

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

// The exact message a machine signs (EIP-191 personal_sign) to prove it
// controls the wallet it registers. Binding an unproven wallet would let a
// squatter pre-register someone else's address and siphon their deposits,
// because on-chain deposits auto-credit by sender wallet.
export function registrationMessage(wallet) {
  return `satelink:register:${String(wallet).toLowerCase()}`;
}

function pricingBody() {
  return {
    ok: true,
    service: 'Satelink RPC Gateway',
    pricing_model: 'prepaid_credits_pay_per_call',
    price_per_call_usdt: PRICE_PER_CALL_USDT,
    currency: 'USDT',
    settlement_chain: { name: 'Polygon PoS Mainnet', chain_id: 137 },
    tiers: [
      { tier: 'free', daily_limit: TIER_DAILY_LIMIT.free, cost_per_call_usdt: 0 },
      { tier: 'basic', daily_limit: TIER_DAILY_LIMIT.basic, cost_per_call_usdt: PRICE_PER_CALL_USDT },
      { tier: 'pro', daily_limit: TIER_DAILY_LIMIT.pro, cost_per_call_usdt: PRICE_PER_CALL_USDT },
      { tier: 'enterprise', daily_limit: TIER_DAILY_LIMIT.enterprise, cost_per_call_usdt: PRICE_PER_CALL_USDT },
    ],
    deposit: {
      token: 'USDT',
      token_address: USDT(),
      token_decimals: 6,
      vault_address: VAULT(),
      chain_id: 137,
      minimum_usdt: MIN_DEPOSIT_USDT(),
      confirmations_required: MIN_CONFIRMATIONS,
      flow: [
        `1. USDT.approve(${VAULT()}, amount)`,
        `2. RevenueVault.deposit(amount)  — calldata from GET ${API_BASE()}/credits/deposit/initiate?amount=<usdt>`,
        `3. Credits appear on the account bound to the sender wallet after ${MIN_CONFIRMATIONS} confirmations (automatic).`,
        `4. Optional fast-path: POST ${API_BASE()}/api/keys/deposit with { tx_hash } once confirmed.`,
      ],
      calldata_endpoint: `${API_BASE()}/credits/deposit/initiate?amount=1.00`,
      claim_endpoint: `${API_BASE()}/api/keys/deposit`,
      notify_endpoint: `${API_BASE()}/api/deposit/notify`,
    },
    credit_semantics:
      'Prepaid, non-expiring USDT credits on the account (api_credits). Each paid-tier RPC call ' +
      `atomically deducts ${PRICE_PER_CALL_USDT} USDT. Free tier bills 0 and is limited to ` +
      `${TIER_DAILY_LIMIT.free} calls/day. HTTP 402 with a machine-readable payment block is ` +
      'returned when credits are exhausted; HTTP 429 when the tier daily limit is reached.',
  };
}

function manifestBody() {
  const base = API_BASE();
  return {
    schema_version: '1.0',
    service: 'Satelink RPC Gateway',
    description:
      'DePIN RPC gateway: machines pay USDT on Polygon to call blockchain RPC APIs. ' +
      'Fully autonomous onboarding — no email, no dashboard, no human.',
    chain: { name: 'Polygon PoS Mainnet', chain_id: 137 },
    pricing: {
      price_per_call_usdt: PRICE_PER_CALL_USDT,
      details: `${base}/v1/pricing`,
    },
    payment: {
      token: 'USDT',
      token_address: USDT(),
      vault_address: VAULT(),
      chain_id: 137,
      minimum_deposit_usdt: MIN_DEPOSIT_USDT(),
      confirmations_required: MIN_CONFIRMATIONS,
    },
    onboarding: {
      register: {
        method: 'POST',
        url: `${base}/v1/machine/register`,
        body: {
          wallet_address: '0x<your-funding-wallet>',
          signature: `personal_sign of "satelink:register:<lowercase wallet_address>"`,
        },
        returns: 'api_key (X-API-Key header for all RPC calls)',
      },
      fund: {
        calldata: `${base}/credits/deposit/initiate?amount=<usdt>`,
        auto_credit: `deposits from the registered wallet are credited automatically after ${MIN_CONFIRMATIONS} confirmations`,
        claim: `${base}/api/keys/deposit`,
        notify: `${base}/api/deposit/notify`,
      },
      consume: {
        rpc: `${base}/rpc/{chain}`,
        auth_header: 'X-API-Key',
        example: `curl -X POST ${base}/rpc/polygon -H "X-API-Key: sk_..." -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
      },
      observe: {
        balance: `${base}/api/keys/usage (X-API-Key header)`,
        deposits: `${base}/api/keys/deposits (X-API-Key header)`,
      },
    },
    errors: {
      402: 'Credits exhausted — body contains payment.vault_address, token_address, chain_id, and this manifest URL.',
      429: 'Tier daily limit reached — deposit more or wait for the UTC midnight reset.',
    },
    openapi: `${base}/openapi.json`,
    pricing_url: `${base}/v1/pricing`,
    manifest_url: `${base}/.well-known/satelink.json`,
  };
}

/** GET /.well-known/satelink.json — mounted under app.use("/.well-known", …) */
export function createWellKnownSatelinkRouter() {
  const router = Router();
  router.get('/satelink.json', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(manifestBody());
  });
  return router;
}

/** GET /v1/pricing + POST /v1/machine/register — mounted BEFORE the /v1 ai-gateway */
export function createMachineV1Router(pool) {
  const router = Router();
  ensureCreditTables(pool);

  router.get('/pricing', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(pricingBody());
  });

  router.post('/machine/register', apiKeyCreateLimiter, async (req, res) => {
    const { wallet_address, signature } = req.body || {};

    if (!wallet_address || !WALLET_RE.test(wallet_address)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_wallet_address',
        message: 'wallet_address must be a 0x-prefixed 40-hex-char EVM address',
      });
    }
    if (!signature || typeof signature !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'signature_required',
        message: `Sign the message "${registrationMessage(wallet_address)}" with the wallet key (EIP-191 personal_sign) and pass it as "signature". This proves you control the funding wallet.`,
        sign_message: registrationMessage(wallet_address),
      });
    }

    // Proof of wallet ownership — recovered signer must equal the wallet.
    let recovered;
    try {
      recovered = ethers.verifyMessage(registrationMessage(wallet_address), signature);
    } catch {
      return res.status(400).json({ ok: false, error: 'invalid_signature', message: 'Signature could not be verified' });
    }
    if (recovered.toLowerCase() !== wallet_address.toLowerCase()) {
      return res.status(403).json({
        ok: false,
        error: 'signature_mismatch',
        message: 'Signature does not recover to wallet_address',
        sign_message: registrationMessage(wallet_address),
      });
    }

    try {
      // One account per wallet: deposits auto-credit by sender wallet, so a
      // second binding would silently split (or steal) future deposits.
      const existing = await resolveAccount(pool, { wallet: wallet_address });
      if (existing) {
        return res.status(409).json({
          ok: false,
          error: 'wallet_already_registered',
          message: 'This wallet already has an account. Use the API key issued at registration; it cannot be re-issued.',
          registered_tier: existing.tier,
        });
      }

      const result = await createApiKeyWithCredits(pool, 'free', wallet_address, {});
      const base = API_BASE();
      return res.status(201).json({
        ok: true,
        api_key: result.api_key,
        tier: result.tier,
        daily_limit: result.daily_limit,
        wallet_address: wallet_address.toLowerCase(),
        next_steps: [
          `Free tier: ${result.daily_limit} calls/day with header X-API-Key.`,
          `To buy paid capacity: GET ${base}/credits/deposit/initiate?amount=<usdt>, sign+send both transactions from ${wallet_address}.`,
          `Deposits ≥ ${MIN_DEPOSIT_USDT()} USDT auto-credit this account after ${MIN_CONFIRMATIONS} confirmations.`,
        ],
        manifest_url: `${base}/.well-known/satelink.json`,
        pricing_url: `${base}/v1/pricing`,
      });
    } catch (err) {
      console.error('[MachineRegister] failed:', err.message);
      return res.status(500).json({ ok: false, error: 'registration_failed' });
    }
  });

  return router;
}
