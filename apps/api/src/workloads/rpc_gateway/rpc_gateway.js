import { Router } from 'express';
import crypto from 'crypto';
import { routeRpcRequest, getRouterStats, initRouterWithPool, getNodeRoutingStatus } from './router.js';
import { getSupportedChains, getChainConfig, CHAIN_ALIASES } from './providers.js';
import { getCached, setCached, isCacheable, getCacheStats } from './cache.js';
import { checkRateLimit, incrementUsage, createApiKey, getUsageStats, getTiers } from './rate_limiter.js';
import { createHealthEndpoint, startHealthMonitor } from './health_monitor.js';
import { createMetricsRouter } from './metrics.js';
import { recordRpcRevenue } from './rpc_billing.js';
import { createCreditGate } from '../../middleware/credit_gate.js';
import { authorizeAndMeter } from '../../billing/credit_service.mjs';
import { enforceCapacity } from '../../capacity/capacity_enforcement.js';
import { paymentRequiredResponse } from '../../utils/payment_required.js';

// Customer Zero P0 recovery: when CREDIT_CANONICAL=true, authenticated callers
// (X-API-Key or x-wallet-address) are authorized + metered + deducted against
// api_credits via creditService — the single source of truth. When false, the
// legacy Redis rate-limit + credit_balances path runs unchanged.
const CREDIT_CANONICAL = () => process.env.CREDIT_CANONICAL === 'true';

const SUPPORTED_CHAINS = new Set([...getSupportedChains(), ...Object.keys(CHAIN_ALIASES)]);

const CHAIN_PRICING_USDT = {
    'ethereum': 0.00005,
    'eth': 0.00005,
    'polygon': 0.00003,
    'matic': 0.00003,
    'polygon-amoy': 0.00003,
    'amoy': 0.00003,
    'arbitrum': 0.00004,
    'arb': 0.00004,
    'base': 0.00004
};

const DEFAULT_RPC_REWARD_USDT = 0.00003;

// 402 contract for any request that never resolves to a billable account
// (credentials that match no account, or anonymous traffic while the free
// taste is disabled). Built from the canonical 402 util so the vault,
// minimum and calldata fields can never drift from what the deposit
// listener actually credits — the static body this replaces advertised a
// $1 minimum (real: $0.50) and a dead deposit URL, and machines that can't
// parse an x402 accepts block had no plain-steps path to payment.
const paymentRequiredBody = (message) => paymentRequiredResponse({
    message,
    how_to_pay: [
        `Fastest (x402 SDKs): retry this call with an x402 payment header — one $0.10 USDC payment on Base buys a 1,000-call bundle. The 402 you received carries the exact requirements in "accepts".`,
        'Prepaid (any HTTP client): register your wallet (see "register"), fetch deposit calldata (see "deposit.calldata_url"), send the USDT, retry with the X-API-Key you were issued.',
        'Full machine-readable service manifest: see "manifest_url"; live pricing and market comparison: see "pricing_url".',
    ],
});

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.socket?.remoteAddress ||
           'unknown';
}

export function createRpcGateway(db) {
    const router = Router();

    // Initialize router with database pool for network node routing
    initRouterWithPool(db);

    // ── Autonomous payer: credit gate middleware (402 on low balance)
    const creditGate = createCreditGate(db, console);

    startHealthMonitor();
    createHealthEndpoint(router);

    const metricsRouter = createMetricsRouter(db);
    router.use('/', metricsRouter);

    router.get('/stats/:chain', async (req, res) => {
        const { chain } = req.params;
        try {
            const providerStats = await getRouterStats(chain);
            const cacheStats = getCacheStats();
            res.json({
                ok: true,
                chain,
                providers: providerStats,
                cache: {
                    hits: cacheStats.hits,
                    misses: cacheStats.misses,
                    hitRate: `${cacheStats.hitRate}%`
                }
            });
        } catch (err) {
            console.error('[RPC Gateway] Stats error:', err.message);
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    router.get('/tiers', (req, res) => {
        res.json({ ok: true, tiers: getTiers() });
    });

    router.get('/debug/node-routing', async (req, res) => {
        try {
            const status = await getNodeRoutingStatus();
            res.json({ ok: true, ...status });
        } catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    router.get('/chains', (req, res) => {
        const chains = getSupportedChains().map(chainKey => {
            const config = getChainConfig(chainKey);
            return {
                chain: chainKey,
                chainId: config.chainId,
                name: config.name,
                providers: config.providers.length,
                priceUsdt: CHAIN_PRICING_USDT[chainKey] || DEFAULT_RPC_REWARD_USDT,
                aliases: Object.entries(CHAIN_ALIASES)
                    .filter(([_, v]) => v === chainKey)
                    .map(([k]) => k)
            };
        });
        res.json({ ok: true, chains });
    });

    router.get('/usage', async (req, res) => {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            return res.status(400).json({ ok: false, error: 'API key required' });
        }

        const stats = await getUsageStats(apiKey);
        if (!stats) {
            return res.status(404).json({ ok: false, error: 'Invalid API key' });
        }

        res.json({ ok: true, ...stats });
    });

    router.post('/keys', async (req, res) => {
        const adminKey = req.headers['x-admin-key'];
        if (adminKey !== process.env.ADMIN_API_KEY) {
            return res.status(403).json({ ok: false, error: 'Admin access required' });
        }

        const { tier, owner } = req.body || {};
        if (!tier) {
            return res.status(400).json({ ok: false, error: 'Tier required' });
        }

        try {
            const result = await createApiKey(tier, owner);
            res.json({ ok: true, ...result });
        } catch (err) {
            console.error('[RPC Gateway] Key creation error:', err.message);
            res.status(400).json({ ok: false, error: err.message });
        }
    });

    // GET /rpc/:chain — Public informational endpoint (does NOT interfere with POST)
    router.get('/:chain', (req, res) => {
        const { chain } = req.params;
        const normalizedChain = CHAIN_ALIASES[chain] || chain;

        // Check if it's a valid chain
        if (!SUPPORTED_CHAINS.has(chain)) {
            return res.status(404).json({
                ok: false,
                error: `Unknown chain: ${chain}`,
                supported: [...getSupportedChains()]
            });
        }

        const config = getChainConfig(normalizedChain);
        const pricing = CHAIN_PRICING_USDT[normalizedChain] || CHAIN_PRICING_USDT[chain] || DEFAULT_RPC_REWARD_USDT;

        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json({
            service: 'Satelink RPC Gateway',
            chain: normalizedChain,
            chainId: config?.chainId || null,
            name: config?.name || normalizedChain,
            status: 'online',
            usage: 'Send JSON-RPC POST requests to this endpoint',
            endpoint: `https://rpc.satelink.network/rpc/${chain}`,
            pricing: {
                model: 'pay_per_use',
                base_cost_usdt: pricing,
                settlement: 'USDT on Polygon'
            },
            providers: config?.providers?.length || 0,
            health: 'https://rpc.satelink.network/rpc/health',
            documentation: 'https://rpc.satelink.network/provider.json',
            example: {
                curl: `curl -X POST https://rpc.satelink.network/rpc/${chain} -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
            }
        });
    });

    router.post('/:chain', creditGate, async (req, res) => {
        const startTime = Date.now();
        const { chain } = req.params;
        const apiKey = req.headers['x-api-key'];
        // P0-wallet-auth (2026-09): x-wallet-address is read but must NEVER
        // reach billing on its own — it was C1's twin (an unauthenticated
        // header trusted to name the deduction target). Billing identity now
        // comes ONLY from a resolved api_key account, or a facilitator-
        // verified x402 payment (req.x402.wallet, unchanged from P0-2).
        // rawWalletHeader is kept ONLY for the 401 below and for
        // logging/display — it must never be passed to enforceCapacity/
        // authorizeAndMeter/credit_gate.
        const rawWalletHeader = req.headers['x-wallet-address'] || null;
        const walletForBilling = req.x402?.settled ? (req.x402.wallet || null) : null;
        const clientIp = getClientIp(req);
        const canonical = CREDIT_CANONICAL();

        // A bare x-wallet-address with no valid api_key and no settled x402
        // payment is an insufficient credential. Reject before any billing or
        // free-tier logic runs — never silently downgrade it to anonymous
        // (that would serve the call for free) or bill an unverified wallet.
        if (rawWalletHeader && !apiKey && !req.x402?.settled) {
            return res.status(401).json({
                ok: false,
                error: 'wallet_header_insufficient',
                message: 'x-wallet-address alone is not a billing credential. Present a valid X-API-Key (see POST /v1/machine/register) or pay via x402.'
            });
        }

        // Anonymous (no key, no settled x402 payment): serve the free taste.
        // The free-tier gate mounted BEFORE this router has already enforced
        // the per-IP daily limit (over-limit IPs got a 402 there, x402-
        // upgraded by the middleware), so a request reaching this point is
        // under-limit — it flows to the legacy branch below, which
        // rate-limits, meters, and bills $0 (no revenue event).
        //
        // War room 2026-07-10: the unconditional 402 here (83eeaea) rejected
        // 100% of anonymous demand — ~96k 402s/day, 4 pricing views, zero
        // external payments — because Chainlist-sourced clients never parse a
        // 402 body. Value first, wall at the limit. Set
        // ANON_FREE_TIER_ENABLED=false to restore the hard 402 without a
        // deploy. x402-settled calls were always allowed through (revenue for
        // those is recorded at settlement with demand_source='x402').
        if (!apiKey && !req.x402?.settled
            && process.env.ANON_FREE_TIER_ENABLED === 'false') {
            return res.status(402).json(paymentRequiredBody(
                'Anonymous access is disabled. Register a wallet for prepaid credits, or pay per call with an x402 payment header.'));
        }

        // Validate chain + JSON-RPC body BEFORE any billing so an invalid
        // request is never charged or metered.
        if (!SUPPORTED_CHAINS.has(chain)) {
            return res.status(400).json({
                ok: false,
                error: `Unsupported chain: ${chain}. Supported: ${[...SUPPORTED_CHAINS].join(', ')}`
            });
        }

        const body = req.body;

        if (!body || body.jsonrpc !== '2.0' || !body.method) {
            return res.status(400).json({ ok: false, error: 'Invalid JSON-RPC 2.0 payload: requires jsonrpc="2.0" and method' });
        }

        if (typeof body.method !== 'string' || body.method.length === 0) {
            return res.status(400).json({ ok: false, error: 'Invalid JSON-RPC method' });
        }

        // ── AUTHORIZE + METER ────────────────────────────────────────────────
        // Phase 6: a revenue event is created ONLY for an actual deduction. This
        // holds the real amount deducted (0 for free/anonymous → no revenue event).
        let billedUsdt = 0;
        if (canonical && (apiKey || walletForBilling)) {
            // CANONICAL: api_credits is authoritative. One atomic call does the
            // daily-limit gate (429), balance deduct (402), and usage metering.
            // No Redis, no credit_balances, no anonymous downgrade (unknown key → 401).
            // wallet is walletForBilling ONLY — never the raw header (P0-wallet-auth).
            let verdict;
            try {
                // M8: capacity enforcement cutover. In legacy mode this is the
                // unchanged api_credits authorizeAndMeter; in dual it evaluates
                // both paths and serves legacy; in new the authorization
                // capacity decision is served. Path is read at request time
                // (CAPACITY_ENFORCEMENT_PATH) so a Railway flip reverts with no
                // redeploy.
                verdict = await enforceCapacity(db, { apiKey, wallet: walletForBilling });
            } catch (err) {
                console.error('[RPC Gateway] creditService error (fail-open + alert):', err.message);
                verdict = { ok: true, tier: 'unknown', remaining: null, limit: null, balanceAfter: null, degraded: true };
            }
            res.set('X-Credit-Source', verdict.creditSource === 'authorization' ? 'authorization' : 'api_credits');
            if (!verdict.ok) {
                if (verdict.code === 'account_not_found') {
                    return res.status(402).json(paymentRequiredBody(
                        'The API key or wallet you sent matches no account. Register the wallet (see "register") or check the X-API-Key value.'));
                }
                const payload = { ok: false, error: verdict.code, message: verdict.message };
                // Payment path on BOTH money moments: balance exhausted (402)
                // AND the keyed daily limit (429). The 429 was previously a
                // dead end — the exact moment a key's workload has formed
                // dependency and should convert, it got no upgrade path
                // (erpc journey audit, 2026-07-11). Response payload only;
                // verdict logic untouched.
                if (verdict.http === 402 || verdict.code === 'daily_limit_exceeded') {
                    const apiBase = process.env.API_BASE_URL || 'https://rpc.satelink.network';
                    payload.payment = {
                        vault_address: process.env.REVENUE_VAULT_ADDRESS || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF',
                        token: 'USDT',
                        token_address: process.env.USDT_CONTRACT_ADDRESS || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
                        chain_id: 137,
                        minimum_deposit_usdt: parseFloat(process.env.MIN_DEPOSIT_USDT || '0.50'),
                        deposit_url: `${apiBase}/api/keys/deposit-info`,
                        calldata_url: `${apiBase}/credits/deposit/initiate?amount=1.00`
                    };
                    payload.manifest_url = `${apiBase}/.well-known/satelink.json`;
                    payload.pricing_url = `${apiBase}/v1/pricing`;
                    if (verdict.code === 'daily_limit_exceeded') {
                        payload.message =
                            `${verdict.message}. Lift it without waiting for the UTC reset: deposit USDT ` +
                            `(any amount ≥ $0.50) to the vault and claim it on THIS key — ` +
                            `1) GET ${apiBase}/credits/deposit/initiate?amount=<usdt> for ready-to-sign calldata, ` +
                            `2) POST ${apiBase}/api/keys/deposit {"tx_hash":"0x…"} with your X-API-Key header. ` +
                            'Credits upgrade the key to a paid tier with a higher ceiling and never expire.';
                        payload.upgrade_steps = [
                            `GET ${apiBase}/credits/deposit/initiate?amount=1.00`,
                            `POST ${apiBase}/api/keys/deposit with {"tx_hash":"0x…"} and your X-API-Key header`,
                        ];
                    }
                }
                return res.status(verdict.http || 402).json(payload);
            }
            res.set({
                'X-RateLimit-Limit': verdict.limit ?? '',
                'X-RateLimit-Remaining': verdict.remaining ?? '',
                'X-RateLimit-Tier': verdict.tier,
                'X-Credit-Balance': verdict.balanceAfter ?? ''
            });
            // Only a real deduction (paid tier, cost > 0) bills revenue.
            billedUsdt = Number(verdict.cost) > 0 ? Number(verdict.cost) : 0;
        } else {
            // LEGACY: Redis rate-limit (flag off, or anonymous public traffic).
            // An x402-settled call is paid per-request: the per-IP daily counter
            // (which the payer already exhausted to reach the 402) must not 429
            // it. Usage is still metered via incrementUsage below.
            let rateCheck = { allowed: true, tier: 'free', remaining: 500, limit: 500 };
            if (req.x402?.settled) {
                rateCheck = { allowed: true, tier: 'x402', remaining: null, limit: null };
            } else {
                try {
                    const ratePromise = checkRateLimit(apiKey, clientIp);
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Rate limit timeout')), 500)
                    );
                    rateCheck = await Promise.race([ratePromise, timeoutPromise]);
                } catch (err) {
                    console.warn('[RPC Gateway] Rate check skipped (timeout)');
                }
            }

            res.set({
                'X-RateLimit-Limit': rateCheck.limit ?? '',
                'X-RateLimit-Remaining': rateCheck.remaining ?? '',
                'X-RateLimit-Tier': rateCheck.tier
            });

            if (!rateCheck.allowed) {
                res.set('X-RateLimit-Reset', rateCheck.resetAt);
                return res.status(429).json({
                    error: 'rate_limit_exceeded',
                    upgrade_url: `${process.env.API_BASE_URL || 'https://rpc.satelink.network'}/credits/initiate?amount=10`,
                    deposit_address: process.env.REVENUE_VAULT_ADDRESS || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF',
                    network: 'Polygon Mainnet',
                    docs: 'https://satelink.network/docs'
                });
            }

            // Usage tracking - fire and forget (non-blocking)
            incrementUsage(apiKey, clientIp).catch(() => {});
        }

        const request_id = `rpc_${crypto.randomUUID()}`;
        const method = body.method;
        const params = body.params || [];

        try {
            // Cache check with 300ms timeout
            let cachedResponse = null;
            try {
                const cachePromise = getCached(chain, method, params);
                const cacheTimeout = new Promise((resolve) => setTimeout(() => resolve(null), 300));
                cachedResponse = await Promise.race([cachePromise, cacheTimeout]);
            } catch {
                // Cache miss, continue
            }

            if (cachedResponse) {
                // Billing - fire and forget (only when a real deduction occurred)
                recordRpcRevenue({
                    pool: db,
                    chain,
                    method,
                    apiKey,
                    source: 'edge_cache',
                    requestId: request_id,
                    amountUsdt: billedUsdt
                }).catch(() => {});
                // JSON-RPC 2.0: the response id MUST equal the caller's request
                // id. The cached body carries the ORIGINAL requester's id — echo
                // the current one instead so concurrent machines correlate.
                return res.status(200).json({ ...cachedResponse, id: body.id ?? null });
            }

            const routeResult = await routeRpcRequest(chain, method, params, body.id, {
                apiKey,
                requestId: request_id,
                billedUsdt
            });

            if (!routeResult.success) {
                return res.status(502).json({ ok: false, error: routeResult.error });
            }

            // Cache set - fire and forget
            if (isCacheable(method)) {
                setCached(chain, method, params, routeResult.result).catch(() => {});
            }

            // Billing - fire and forget
            // Skip if request was served by a network node (revenue already attributed in dispatcher)
            if (routeResult.source !== 'network_node') {
                recordRpcRevenue({
                    pool: db,
                    chain,
                    method,
                    apiKey,
                    source: routeResult.provider || 'external_provider',
                    requestId: request_id,
                    amountUsdt: billedUsdt
                }).catch(() => {});
            }

            const elapsed = Date.now() - startTime;
            console.log(`[RPC Gateway] ${chain}/${method} → ${routeResult.provider} (${elapsed}ms)`);

            res.status(200).json(routeResult.result);
        } catch (error) {
            console.error('[RPC Gateway] Execution error:', error.message);
            res.status(502).json({ ok: false, error: 'RPC execution failed', message: error.message });
        }
    });

    return router;
}
