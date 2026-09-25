/**
 * MEV Private Relay (L8-001)
 *
 * Private mempool relay for MEV searchers.
 * Transactions are NOT broadcast to public mempool — submitted directly to validators.
 *
 * Pricing:
 * - eth_sendRawTransaction: $0.001 (10x standard RPC)
 * - eth_sendBundle: $0.005
 * - eth_callBundle (simulation): $0.0001
 * - flashbots_getBundleStats: $0.00005
 *
 * Auth: Requires API key (no free tier)
 *
 * Endpoints:
 * - POST /rpc/mev — Submit private transaction
 * - POST /rpc/mev/bundle — Submit MEV bundle (Flashbots-compatible)
 * - POST /rpc/mev/bundle/simulate — Dry-run bundle simulation (eth_callBundle)
 * - GET /rpc/mev/bundle/:hash — Check bundle inclusion status
 * - GET /rpc/mev/status — Relay health and stats
 *
 * Features:
 * - Redis-based API key caching (5 min TTL)
 * - Per-key rate limiting (sliding window)
 * - Flashbots signature for Ethereum mainnet
 * - Realtime revenue broadcast
 * - Bundle simulation before payment
 * - Bundle status tracking
 */

import { Router } from 'express';
import { keyRef } from '../../security/key_mask.mjs';
import crypto from 'crypto';
import { broadcaster } from '../../realtime/broadcaster-instance.js';
import { isFounderApiKey } from '../../payments/founder_wallets.js';
import { shadowWriteRevenueLedger } from '../../ledger/shadow_ledger_write.js';

const MEV_PROVIDERS = {
  ethereum: [
    { name: 'flashbots', url: 'https://rpc.flashbots.net', priority: 1, requiresSignature: true },
    { name: 'mev-blocker', url: 'https://rpc.mevblocker.io', priority: 2, requiresSignature: false }
  ],
  polygon: [
    { name: 'llama-mev', url: 'https://polygon.llamarpc.com', priority: 1, requiresSignature: false }
  ],
  arbitrum: [
    { name: 'llama-mev', url: 'https://arbitrum.llamarpc.com', priority: 1, requiresSignature: false }
  ]
};

const MEV_PRICING_USDT = {
  eth_sendRawTransaction: 0.001,
  eth_sendBundle: 0.005,
  eth_sendPrivateTransaction: 0.001,
  eth_callBundle: 0.0001,
  flashbots_getBundleStats: 0.00005
};

const DEFAULT_MEV_PRICE = 0.001;

const RATE_LIMITS = {
  free: 10,
  basic: 100,
  pro: 1000,
  enterprise: 5000
};

const mevStats = {
  totalSubmissions: 0,
  successfulSubmissions: 0,
  failedSubmissions: 0,
  bundlesSubmitted: 0,
  bundleSimulations: 0,
  bundleStatusChecks: 0,
  revenueUsdt: 0,
  lastSubmissionAt: null,
  rateLimitHits: 0
};

/**
 * CHANGE 3: Flashbots signature generation
 * Signs request body for Flashbots Protect API
 */
async function signFlashbotsRequest(body) {
  const signerKey = process.env.FLASHBOTS_SIGNER_KEY;
  if (!signerKey) return null;

  try {
    const { Wallet, hashMessage } = await import('ethers');
    const wallet = new Wallet(signerKey);
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const messageHash = hashMessage(bodyStr);
    const signature = await wallet.signMessage(bodyStr);
    return `${wallet.address}:${signature}`;
  } catch (e) {
    console.warn('[MEV] Flashbots signing failed:', e.message);
    return null;
  }
}

/**
 * CHANGE 1: Redis-based rate limiting (sliding window)
 */
async function checkMevRateLimit(redis, apiKey, tier) {
  if (!redis) return { allowed: true, count: 0, limit: RATE_LIMITS[tier] || 10 };

  const limit = RATE_LIMITS[tier] || RATE_LIMITS.free;
  const window = 60; // seconds
  const key = `mev:ratelimit:${keyRef(apiKey)}`;
  const now = Date.now();
  const windowStart = now - window * 1000;

  try {
    const pipe = redis.pipeline();
    pipe.zremrangebyscore(key, 0, windowStart);
    pipe.zadd(key, now, `${now}-${Math.random()}`);
    pipe.zcard(key);
    pipe.expire(key, window);
    const results = await pipe.exec();
    const count = results[2][1];

    if (count > limit) {
      mevStats.rateLimitHits++;
      return { allowed: false, count, limit };
    }
    return { allowed: true, count, limit };
  } catch (e) {
    console.warn('[MEV] Rate limit check failed:', e.message);
    return { allowed: true, count: 0, limit };
  }
}

async function submitToMevProvider(chain, method, params, requestBody, timeout = 10000) {
  const providers = MEV_PROVIDERS[chain];
  if (!providers || providers.length === 0) {
    throw new Error(`No MEV providers available for chain: ${chain}`);
  }

  const sortedProviders = [...providers].sort((a, b) => a.priority - b.priority);
  let lastError = null;

  for (const provider of sortedProviders) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const rpcBody = {
        jsonrpc: '2.0',
        method,
        params,
        id: Date.now()
      };

      const headers = { 'Content-Type': 'application/json' };

      // CHANGE 3: Add Flashbots signature for providers that require it
      if (provider.requiresSignature && chain === 'ethereum') {
        const fbSignature = await signFlashbotsRequest(rpcBody);
        if (fbSignature) {
          headers['X-Flashbots-Signature'] = fbSignature;
        }
      }

      const response = await fetch(provider.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(rpcBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        lastError = new Error(`Provider ${provider.name} returned ${response.status}`);
        continue;
      }

      const data = await response.json();

      if (data.error) {
        lastError = new Error(data.error.message || 'MEV provider error');
        continue;
      }

      return {
        success: true,
        provider: provider.name,
        result: data.result,
        bundleId: data.result?.bundleHash || crypto.randomUUID()
      };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err;
      console.error(`[MEV] Provider ${provider.name} failed:`, err.message);
    }
  }

  throw lastError || new Error('All MEV providers failed');
}

async function recordMevRevenue(db, method, apiKey, requestId, chain) {
  if (!db || !db.query) return null;

  const amount = MEV_PRICING_USDT[method] || DEFAULT_MEV_PRICE;
  const clientId = apiKey || 'anonymous';
  const isTestData = await isFounderApiKey(db, apiKey);

  try {
    const now = Math.floor(Date.now() / 1000);
    const result = await db.query(
      `INSERT INTO revenue_events_v2 (op_type, node_id, client_id, amount_usdt, status, request_id, created_at, is_test_data, is_billable)
       VALUES ('mev_relay', $1, $2, $3, 'success', $4, $5, $6, false)
       RETURNING id, epoch_id`,
      ['mev_private', clientId, amount, requestId, now, isTestData]
    );
    // M3 shadow ledger — flag-gated, isolated pool, never throws.
    shadowWriteRevenueLedger(db, { requestId, amountUsdt: amount, isTestData });

    mevStats.revenueUsdt += amount;
    console.log(`[MEV] Revenue: ${chain}/${method} → $${amount}`);

    // CHANGE 2: Broadcast revenue event to realtime channel
    try {
      broadcaster.publish('revenue:event', {
        source: 'mev_relay',
        amount_usdt: amount,
        method,
        chain,
        request_id: requestId,
        epoch_id: result.rows[0]?.epoch_id || null,
        ts: Date.now()
      });
    } catch (broadcastErr) {
      console.warn('[MEV] Broadcast failed:', broadcastErr.message);
    }

    return { amount, epochId: result.rows[0]?.epoch_id };
  } catch (e) {
    console.error('[MEV] Failed to record revenue:', e.message);
    return null;
  }
}

/**
 * CHANGE 1: Redis-cached API key validation
 */
async function validateApiKey(apiKey, db, redis) {
  if (!apiKey || !apiKey.startsWith('sk_')) {
    return { valid: false, error: 'MEV relay requires a valid API key (sk_live_*)' };
  }

  // Check Redis cache first
  if (redis) {
    try {
      const cacheKey = `mev:apikey:${keyRef(apiKey)}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        const keyRecord = JSON.parse(cached);
        if (keyRecord.tier === 'public') {
          return { valid: false, error: 'MEV relay not available on public tier. Upgrade to basic or above.' };
        }
        return { valid: true, tier: keyRecord.tier, cached: true };
      }
    } catch (e) {
      console.warn('[MEV] Redis cache read failed:', e.message);
    }
  }

  if (!db || !db.query) {
    return { valid: true, tier: 'basic' };
  }

  try {
    const result = await db.query(
      `SELECT tier, status FROM rpc_api_keys
       WHERE key_hash = encode(sha256($1::bytea), 'hex') AND status = 'active'`,
      [apiKey]
    );

    if (result.rows.length === 0) {
      return { valid: false, error: 'Invalid or inactive API key' };
    }

    const tier = result.rows[0].tier;

    // Cache the result in Redis (5 minute TTL)
    if (redis) {
      try {
        const cacheKey = `mev:apikey:${keyRef(apiKey)}`;
        await redis.setex(cacheKey, 300, JSON.stringify({ tier, status: 'active' }));
      } catch (e) {
        console.warn('[MEV] Redis cache write failed:', e.message);
      }
    }

    if (tier === 'public') {
      return { valid: false, error: 'MEV relay not available on public tier. Upgrade to basic or above.' };
    }

    return { valid: true, tier };
  } catch (e) {
    return { valid: true, tier: 'basic' };
  }
}

export function createMevRelayRouter(db, redis) {
  const router = Router();

  router.get('/status', (req, res) => {
    const chains = Object.keys(MEV_PROVIDERS).map(chain => ({
      chain,
      providers: MEV_PROVIDERS[chain].length,
      available: MEV_PROVIDERS[chain].length > 0
    }));

    res.json({
      ok: true,
      status: 'operational',
      chains,
      stats: {
        totalSubmissions: mevStats.totalSubmissions,
        successRate: mevStats.totalSubmissions > 0
          ? ((mevStats.successfulSubmissions / mevStats.totalSubmissions) * 100).toFixed(1) + '%'
          : 'N/A',
        bundlesSubmitted: mevStats.bundlesSubmitted,
        bundleSimulations: mevStats.bundleSimulations,
        bundleStatusChecks: mevStats.bundleStatusChecks,
        revenueUsdt: mevStats.revenueUsdt.toFixed(6),
        rateLimitHits: mevStats.rateLimitHits,
        lastSubmissionAt: mevStats.lastSubmissionAt
      },
      endpoints: {
        submit: 'POST /rpc/mev',
        bundle: 'POST /rpc/mev/bundle',
        simulate: 'POST /rpc/mev/bundle/simulate',
        bundleStatus: 'GET /rpc/mev/bundle/:bundleHash',
        status: 'GET /rpc/mev/status'
      },
      pricing: MEV_PRICING_USDT,
      rateLimits: RATE_LIMITS,
      features: {
        flashbotsSignature: !!process.env.FLASHBOTS_SIGNER_KEY,
        redisCaching: !!redis,
        realtimeBroadcast: true,
        bundleSimulation: true,
        bundleStatusTracking: true
      }
    });
  });

  router.post('/', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const keyCheck = await validateApiKey(apiKey, db, redis);

    if (!keyCheck.valid) {
      return res.status(403).json({ ok: false, error: keyCheck.error });
    }

    // CHANGE 1: Rate limit check
    const rateCheck = await checkMevRateLimit(redis, apiKey, keyCheck.tier);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        ok: false,
        error: 'rate_limit_exceeded',
        message: `MEV relay limit: ${rateCheck.limit} requests/minute for ${keyCheck.tier} tier`,
        current: rateCheck.count,
        limit: rateCheck.limit,
        retry_after: 60
      });
    }

    const { chain = 'ethereum' } = req.query;
    const body = req.body;

    if (!body || body.jsonrpc !== '2.0' || !body.method) {
      return res.status(400).json({ ok: false, error: 'Invalid JSON-RPC 2.0 payload' });
    }

    const method = body.method;
    const params = body.params || [];

    const allowedMethods = ['eth_sendRawTransaction', 'eth_sendPrivateTransaction', 'eth_sendBundle'];
    if (!allowedMethods.includes(method)) {
      return res.status(400).json({
        ok: false,
        error: `MEV relay only supports: ${allowedMethods.join(', ')}`
      });
    }

    const requestId = `mev_${crypto.randomUUID()}`;
    mevStats.totalSubmissions++;

    try {
      const result = await submitToMevProvider(chain, method, params, body);

      mevStats.successfulSubmissions++;
      mevStats.lastSubmissionAt = new Date().toISOString();
      if (method === 'eth_sendBundle') {
        mevStats.bundlesSubmitted++;
      }

      await recordMevRevenue(db, method, apiKey, requestId, chain);

      res.json({
        jsonrpc: '2.0',
        id: body.id || null,
        result: result.result,
        _mev: {
          bundleId: result.bundleId,
          provider: result.provider,
          requestId,
          priceUsdt: MEV_PRICING_USDT[method] || DEFAULT_MEV_PRICE,
          rateLimit: {
            remaining: rateCheck.limit - rateCheck.count,
            limit: rateCheck.limit
          }
        }
      });
    } catch (err) {
      mevStats.failedSubmissions++;
      console.error('[MEV] Submission failed:', err.message);

      res.status(502).json({
        jsonrpc: '2.0',
        id: body.id || null,
        error: {
          code: -32603,
          message: 'MEV submission failed',
          data: err.message
        }
      });
    }
  });

  router.post('/bundle', async (req, res) => {
    const apiKey = req.headers['x-api-key'];
    const keyCheck = await validateApiKey(apiKey, db, redis);

    if (!keyCheck.valid) {
      return res.status(403).json({ ok: false, error: keyCheck.error });
    }

    // CHANGE 1: Rate limit check
    const rateCheck = await checkMevRateLimit(redis, apiKey, keyCheck.tier);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        ok: false,
        error: 'rate_limit_exceeded',
        message: `MEV relay limit: ${rateCheck.limit} requests/minute for ${keyCheck.tier} tier`,
        current: rateCheck.count,
        limit: rateCheck.limit,
        retry_after: 60
      });
    }

    const { chain = 'ethereum' } = req.query;
    const { txs, blockNumber, minTimestamp, maxTimestamp } = req.body || {};

    if (!txs || !Array.isArray(txs) || txs.length === 0) {
      return res.status(400).json({ ok: false, error: 'txs array required' });
    }

    const requestId = `mev_bundle_${crypto.randomUUID()}`;
    mevStats.totalSubmissions++;
    mevStats.bundlesSubmitted++;

    try {
      const bundleParams = [{
        txs,
        blockNumber: blockNumber || 'latest',
        minTimestamp,
        maxTimestamp
      }];

      const result = await submitToMevProvider(chain, 'eth_sendBundle', bundleParams, req.body);

      mevStats.successfulSubmissions++;
      mevStats.lastSubmissionAt = new Date().toISOString();

      await recordMevRevenue(db, 'eth_sendBundle', apiKey, requestId, chain);

      res.json({
        ok: true,
        bundleHash: result.bundleId,
        provider: result.provider,
        requestId,
        priceUsdt: MEV_PRICING_USDT.eth_sendBundle,
        rateLimit: {
          remaining: rateCheck.limit - rateCheck.count,
          limit: rateCheck.limit
        }
      });
    } catch (err) {
      mevStats.failedSubmissions++;
      console.error('[MEV] Bundle submission failed:', err.message);

      res.status(502).json({
        ok: false,
        error: 'Bundle submission failed',
        message: err.message
      });
    }
  });

  /**
   * POST /bundle/simulate — eth_callBundle dry-run simulation
   * MEV searchers use this to test bundle profitability before paying for submission
   */
  router.post('/bundle/simulate', async (req, res) => {
    const startTime = Date.now();
    const apiKey = req.headers['x-api-key'];
    const keyCheck = await validateApiKey(apiKey, db, redis);

    if (!keyCheck.valid) {
      return res.status(403).json({ ok: false, error: keyCheck.error });
    }

    const rateCheck = await checkMevRateLimit(redis, apiKey, keyCheck.tier);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        ok: false,
        error: 'rate_limit_exceeded',
        message: `MEV relay limit: ${rateCheck.limit} requests/minute`,
        retry_after: 60
      });
    }

    const { txs, blockNumber, stateBlockNumber } = req.body || {};

    if (!txs || !Array.isArray(txs) || txs.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_request',
        message: 'txs must be a non-empty array of hex-encoded signed transactions'
      });
    }

    if (txs.length > 25) {
      return res.status(400).json({
        ok: false,
        error: 'bundle_too_large',
        message: 'Maximum 25 transactions per bundle simulation'
      });
    }

    const requestId = `mev_sim_${crypto.randomUUID()}`;
    mevStats.bundleSimulations++;

    try {
      const flashbotsPayload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'eth_callBundle',
        params: [{
          txs,
          blockNumber: blockNumber || 'latest',
          stateBlockNumber: stateBlockNumber || 'latest',
          timestamp: Math.floor(Date.now() / 1000)
        }]
      };

      const headers = { 'Content-Type': 'application/json' };
      const fbSignature = await signFlashbotsRequest(flashbotsPayload);
      if (fbSignature) {
        headers['X-Flashbots-Signature'] = fbSignature;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch('https://relay.flashbots.net', {
        method: 'POST',
        headers,
        body: JSON.stringify(flashbotsPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const result = await response.json();
      const latency = Date.now() - startTime;

      const simulationFee = MEV_PRICING_USDT.eth_callBundle;
      await recordMevRevenue(db, 'eth_callBundle', apiKey, requestId, 'ethereum');

      if (result.error) {
        return res.json({
          ok: false,
          simulation: null,
          error: result.error.message || 'Simulation failed',
          latency_ms: latency,
          fee_usdt: simulationFee,
          requestId
        });
      }

      const simResult = result.result;
      return res.json({
        ok: true,
        simulation: {
          bundleHash: simResult?.bundleHash,
          coinbaseDiff: simResult?.coinbaseDiff,
          ethSentToCoinbase: simResult?.ethSentToCoinbase,
          gasFees: simResult?.gasFees,
          results: simResult?.results,
          stateBlockNumber: simResult?.stateBlockNumber,
          totalGasUsed: simResult?.totalGasUsed
        },
        profitable: simResult?.coinbaseDiff && BigInt(simResult.coinbaseDiff) > 0n,
        latency_ms: latency,
        fee_usdt: simulationFee,
        requestId
      });

    } catch (err) {
      console.error('[MEV] eth_callBundle simulation failed:', err.message);
      return res.status(502).json({
        ok: false,
        error: 'simulation_failed',
        message: err.name === 'AbortError' ? 'Simulation timeout (15s)' : err.message,
        requestId
      });
    }
  });

  /**
   * GET /bundle/:bundleHash — Check if bundle was included on-chain
   * Uses flashbots_getBundleStats to check inclusion status
   */
  router.get('/bundle/:bundleHash', async (req, res) => {
    const { bundleHash } = req.params;
    const { blockNumber } = req.query;
    const apiKey = req.headers['x-api-key'];

    if (!bundleHash || !bundleHash.startsWith('0x')) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_bundle_hash',
        message: 'bundleHash must be a 0x-prefixed hex string'
      });
    }

    const keyCheck = await validateApiKey(apiKey, db, redis);
    if (!keyCheck.valid) {
      return res.status(403).json({ ok: false, error: keyCheck.error });
    }

    const requestId = `mev_status_${crypto.randomUUID()}`;
    mevStats.bundleStatusChecks++;

    try {
      const payload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'flashbots_getBundleStats',
        params: [{ bundleHash, blockNumber: blockNumber || 'latest' }]
      };

      const headers = { 'Content-Type': 'application/json' };
      const fbSignature = await signFlashbotsRequest(payload);
      if (fbSignature) {
        headers['X-Flashbots-Signature'] = fbSignature;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch('https://relay.flashbots.net', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const result = await response.json();

      const statusFee = MEV_PRICING_USDT.flashbots_getBundleStats;
      await recordMevRevenue(db, 'flashbots_getBundleStats', apiKey, requestId, 'ethereum');

      if (result.error) {
        return res.json({
          ok: false,
          bundleHash,
          status: 'unknown',
          error: result.error.message,
          fee_usdt: statusFee,
          requestId
        });
      }

      const stats = result.result;
      return res.json({
        ok: true,
        bundleHash,
        status: stats?.isSimulated ? (stats?.isHighPriority ? 'pending_high_priority' : 'pending') : 'not_found',
        stats: {
          isSimulated: stats?.isSimulated,
          isSentToMiners: stats?.isSentToMiners,
          isHighPriority: stats?.isHighPriority,
          simulatedAt: stats?.simulatedAt,
          submittedAt: stats?.submittedAt,
          sentToMinersAt: stats?.sentToMinersAt
        },
        fee_usdt: statusFee,
        requestId
      });

    } catch (err) {
      console.error('[MEV] Bundle status check failed:', err.message);
      return res.status(502).json({
        ok: false,
        error: 'status_check_failed',
        message: err.name === 'AbortError' ? 'Status check timeout (10s)' : err.message,
        bundleHash,
        requestId
      });
    }
  });

  return router;
}
