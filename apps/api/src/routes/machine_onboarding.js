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
import { getIntelSummary, recordPricingView } from '../economics/pricing_intelligence/index.js';

const API_BASE = () => process.env.API_BASE_URL || 'https://rpc.satelink.network';
const VAULT = () => process.env.REVENUE_VAULT_ADDRESS || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';
const USDT = () => process.env.USDT_CONTRACT_ADDRESS || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const MIN_DEPOSIT_USDT = () => parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50');
// Instant trial identity quota (revenue sprint 2026-07-11): per-key daily
// limit enforced by the EXISTING authorizeAndMeter path — deliberately a
// daily cap, not a lifetime cap, because a lifetime cap would require
// changing billing logic. 2× the anonymous IP cap, on a private quota.
const INSTANT_TRIAL_DAILY_LIMIT = () => parseInt(process.env.INSTANT_TRIAL_DAILY_LIMIT || '1000', 10);

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
    // M3 — derived trading intelligence product, metered off the SAME credits.
    intelligence: {
      catalog: `${API_BASE()}/v1/intelligence`,
      price_usdt_per_call: 0.01,
      note: 'Derived analytics from public market data (funding divergence, OI shifts, ' +
        'liquidation-pressure model, microstructure). Not raw feed redistribution, not advice.',
    },
  };
}

function manifestBody() {
  const base = API_BASE();
  return {
    schema_version: '1.0',
    service: 'Satelink RPC Gateway',
    description:
      'DePIN RPC gateway: machines pay per call for blockchain RPC APIs. Primary rail is ' +
      'x402 (USDC on Base) — permissionless: pay the HTTP 402 challenge with any x402 v2 ' +
      'client, no account. USDT prepaid credits on Polygon are available as an alternative. ' +
      'Fully autonomous onboarding — no email, no dashboard, no human.',
    chain: { name: 'Polygon PoS Mainnet', chain_id: 137 },
    pricing: {
      x402_bundle: `$${process.env.X402_BUNDLE_PRICE_USD || '0.10'} = ${Number(process.env.X402_BUNDLE_CALLS || 1000).toLocaleString('en-US')} calls (USDC on Base)`,
      price_per_call_usdt: PRICE_PER_CALL_USDT,
      details: `${base}/v1/pricing`,
    },
    // Primary rail: x402 (USDC on Base). x402-native agents auto-pay the
    // machine-payable HTTP 402 the endpoint returns after a small free allowance
    // (accepts carried in the PAYMENT-REQUIRED header, x402 v2). The USDT vault
    // rail is preserved for existing integrations under alternative_rails.
    payment: {
      rail: 'x402',
      network: 'eip155:8453',
      asset: 'USDC',
      price: `$${process.env.X402_BUNDLE_PRICE_USD || '0.10'} = ${Number(process.env.X402_BUNDLE_CALLS || 1000).toLocaleString('en-US')} calls`,
      payTo: process.env.X402_PAY_TO || '0x966E1Ae22996545015b1414B35234b10719d7Ad4',
      resource: `${base}/rpc/polygon`,
      note: 'permissionless — pay the 402 challenge with any x402 v2 client (@x402/fetch, pay.sh); no account',
      alternative_rails: [
        {
          rail: 'usdt-vault',
          token: 'USDT',
          token_address: USDT(),
          vault_address: VAULT(),
          chain_id: 137,
          minimum_deposit_usdt: MIN_DEPOSIT_USDT(),
          confirmations_required: MIN_CONFIRMATIONS,
        },
      ],
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
    // Machine decision surface — market comparison + live capabilities so an
    // autonomous buyer can rank Satelink against alternatives from APIs alone.
    compare_url: `${base}/v1/compare`,
    capabilities_url: `${base}/v1/capabilities`,
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
export function createMachineV1Router(pool, redis = null) {
  const router = Router();
  ensureCreditTables(pool);

  router.get('/pricing', async (_req, res) => {
    recordPricingView(redis, 'pricing');
    const body = pricingBody();
    // Market/trust enrichment is best-effort: the base pricing body (what the
    // serving path actually bills) must always return, even if intel is down.
    try {
      const intel = await getIntelSummary(pool, redis);
      body.market_position = intel.market.position;
      body.market_median_usd_per_million = intel.market.market_median_usd_per_million;
      body.effective_usd_per_million = intel.market.satelink.effective_usd_per_million;
      body.machine_preference_score = intel.machine_preference_score;
      body.why_choose_satelink = intel.why_choose_satelink;
      body.compare_url = `${API_BASE()}/v1/compare`;
      body.capabilities_url = `${API_BASE()}/v1/capabilities`;
    } catch (err) {
      console.error('[MachineV1] pricing intel enrichment skipped:', err.message);
    }
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(body);
  });

  // Instant trial keys: one per IP per UTC day (plus the burst limiter).
  // Redis-backed with an in-memory fallback — same pattern as the free-tier
  // gate. Without the cap, a wall-hitter could mint a fresh key per request
  // and the trial quota would be meaningless.
  const instantMints = new Map(); // ip -> yyyymmdd (in-memory fallback)
  const INSTANT_PER_IP_PER_DAY = 2;

  async function instantMintAllowed(ip) {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    if (redis) {
      try {
        const key = `ik:${ip}:${day}`;
        const n = await redis.incr(key);
        if (n === 1) await redis.expire(key, 25 * 3600);
        return n <= INSTANT_PER_IP_PER_DAY;
      } catch { /* fall through to memory */ }
    }
    const k = `${ip}:${day}`;
    const n = (instantMints.get(k) || 0) + 1;
    if (instantMints.size > 10000) instantMints.clear();
    instantMints.set(k, n);
    return n <= INSTANT_PER_IP_PER_DAY;
  }

  router.post('/machine/register', apiKeyCreateLimiter, async (req, res) => {
    const { wallet_address, signature, mode } = req.body || {};

    // ── Instant mode: wallet-less trial identity (revenue sprint 2026-07-11).
    // The stranger tests proved the wallet signature is the drop-off: raw-HTTP
    // consumers (python-requests, plain Go) hold no keys and eth-account can
    // hard-fail at install. The trial key removes that wall: 10-second curl,
    // own per-key daily quota, clearly marked trial. Payment attaches later,
    // when the quota binds and the workload already depends on the key.
    if (mode === 'instant') {
      const ip =
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
      if (!(await instantMintAllowed(ip))) {
        return res.status(429).json({
          ok: false,
          error: 'instant_key_limit',
          message: `Instant trial keys are limited to ${INSTANT_PER_IP_PER_DAY}/day per IP. Use the key you already created, or register a wallet for a permanent identity.`,
        });
      }
      try {
        const result = await createApiKeyWithCredits(pool, 'free', null, {});
        await pool.query(
          `UPDATE api_credits SET daily_limit = $1, demand_source = 'instant_trial' WHERE api_key = $2`,
          [INSTANT_TRIAL_DAILY_LIMIT(), result.api_key]
        );
        const base = API_BASE();
        return res.status(201).json({
          ok: true,
          api_key: result.api_key,
          identity: 'instant_trial',
          daily_limit: INSTANT_TRIAL_DAILY_LIMIT(),
          wallet_address: null,
          message:
            `Trial machine key: ${INSTANT_TRIAL_DAILY_LIMIT()} calls/day on your own quota (no IP/subnet contention), no wallet, no email. ` +
            'Send it as the X-API-Key header. Attach a wallet later to add prepaid credits when your workload grows.',
          next_steps: [
            `Use now: curl -X POST ${base}/rpc/polygon -H "X-API-Key: ${result.api_key}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
            `Grow past ${INSTANT_TRIAL_DAILY_LIMIT()}/day: deposit USDT (calldata: GET ${base}/credits/deposit/initiate?amount=<usdt>) or pay per bundle with x402 — details: ${base}/v1/pricing`,
          ],
          pricing_url: `${base}/v1/pricing`,
          manifest_url: `${base}/.well-known/satelink.json`,
        });
      } catch (err) {
        console.error('[MachineRegister] instant mint failed:', err.message);
        return res.status(500).json({ ok: false, error: 'registration_failed' });
      }
    }

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
