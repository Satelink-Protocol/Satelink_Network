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
        const walletHdr = req.headers['x-wallet-address'];
        const clientIp = getClientIp(req);
        const canonical = CREDIT_CANONICAL();

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
        if (canonical && (apiKey || walletHdr)) {
            // CANONICAL: api_credits is authoritative. One atomic call does the
            // daily-limit gate (429), balance deduct (402), and usage metering.
            // No Redis, no credit_balances, no anonymous downgrade (unknown key → 401).
            let verdict;
            try {
                verdict = await authorizeAndMeter(db, { apiKey, wallet: walletHdr });
            } catch (err) {
                console.error('[RPC Gateway] creditService error (fail-open + alert):', err.message);
                verdict = { ok: true, tier: 'unknown', remaining: null, limit: null, balanceAfter: null, degraded: true };
            }
            res.set('X-Credit-Source', 'api_credits');
            if (!verdict.ok) {
                const payload = { ok: false, error: verdict.code, message: verdict.message };
                if (verdict.http === 402) {
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
            let rateCheck = { allowed: true, tier: 'free', remaining: 500, limit: 500 };
            try {
                const ratePromise = checkRateLimit(apiKey, clientIp);
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Rate limit timeout')), 500)
                );
                rateCheck = await Promise.race([ratePromise, timeoutPromise]);
            } catch (err) {
                console.warn('[RPC Gateway] Rate check skipped (timeout)');
            }

            res.set({
                'X-RateLimit-Limit': rateCheck.limit,
                'X-RateLimit-Remaining': rateCheck.remaining,
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
