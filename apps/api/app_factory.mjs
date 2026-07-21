import express from "express";
import compression from 'compression';
import { attachBaseMiddleware } from "./src/security/middleware.js";
import revenueRoutes from "./src/routes/revenue.js";
import { createRpcGateway } from "./src/workloads/rpc_gateway/rpc_gateway.js";
import { createMevRelayRouter } from "./src/workloads/mev_relay/index.js";
import { createAiGatewayRouter } from "./src/workloads/ai_gateway/index.js";
import { createBandwidthRouter } from "./src/workloads/bandwidth_proxy/index.js";
import { createLangChainAdapterRouter } from "./src/workloads/ai_gateway/langchain_adapter.js";
import { createPluginManifestRouter, createOpenApiRouter } from "./src/workloads/ai_gateway/plugin_manifest.js";
import { createSimpleApiKeysRouter } from "./src/billing/api_keys_route.mjs";
import { createNodeRegistryRouter } from "./src/services/node_registry/registration.js";
import { createSdkAnalyticsRouter } from "./src/workloads/rpc_gateway/sdk_analytics.js";
import { createSettlementAuditRouter } from "./src/services/settlement/audit.js";
import { createWebhookRouter, ensureWebhookTable } from "./src/workloads/webhooks/index.js";
import { createOracleRouter } from "./src/workloads/oracle/index.js";
import { createClaimsRouter } from "./src/routes/claims_route.mjs";
import { createOsEventsRouter } from "./src/realtime/os-events-route.js";
import { createMachineAccessRouter } from "./src/machine-access/index.js";
import { createAdminMalRouter } from "./src/routes/admin_mal_route.mjs";
import { createFinancialTruthRouter } from "./src/services/financial/truth.js";
import { createCreditsRouter } from "./src/routes/credits.js";
import { createDepositNotifyRouter } from "./src/routes/deposit_notify_api.js";
import { createWellKnownSatelinkRouter, createMachineV1Router } from "./src/routes/machine_onboarding.js";
import { createMachineIntelRouter } from "./src/routes/machine_intel.js";
import { createDepositEconomicsRouter, createVaultRouter } from "./src/routes/deposit_economics.js";
import { createFreeTierGate, getFreeTierStats } from "./src/middleware/free_tier_gate.js";
import { bumpConversionStage } from "./src/middleware/upgrade_context.js";
import { createX402Middleware } from "./src/payments/x402/middleware.js";
import { createFunnelHandler } from "./src/payments/x402/funnel.js";
import { createUnifiedAuthRouter as createUserAuthRouter } from "./src/gateway/routes/auth_v2.js";
import { createUnifiedAuthRouter } from './src/routes/node_auth_route.mjs';
import { createAuthController } from './src/auth/auth_controller.js';
import { createAdminRouter, requireAdminAuth } from './src/admin/admin_router.js';
import { ensureAdminTables } from './src/admin/ensure_admin_tables.js';
import { createVnextKernelRouter } from './src/vnext/http/kernel_router.js';

export function createApp(pool, redis) {
  // Initialize free tier gate (Path C: 500 free calls/day per IP).
  // pool powers the personalized upgrade block on wall 402s (background-
  // filled cache — the gate never waits on Postgres; limits unchanged).
  const freeTierGate = createFreeTierGate(console, redis, pool);
  const app = express();

  // Attach base middleware (CORS, helmet, security headers)
  attachBaseMiddleware(app);
  app.use(compression({ level: 6, threshold: 1024 }));

  // Ensure Admin Command Center tables exist before routes are mounted.
  // IF NOT EXISTS — safe on every boot. Fire-and-forget with a logged catch
  // (same pattern as ensureWebhookTable below); the Railway Postgres host is
  // only reachable inside Railway, so this is how the migration gets applied.
  ensureAdminTables(pool)
    .then(() => console.log('[Admin] Tables ensured (developer_intel, outreach_campaigns, automation_logs)'))
    .catch(e => console.error('[Admin] Table setup failed:', e.message));

  // Core health endpoints
  app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));

  // Enhanced public health endpoint — ALWAYS returns 200 for Railway
  app.get("/health", async (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    const checks = { server: 'ok', db: 'unknown', uptime: Math.floor(process.uptime()) };
    try {
      await pool.query('SELECT 1');
      checks.db = 'ok';
    } catch (e) {
      checks.db = 'degraded: ' + (e.message || 'unknown').slice(0, 50);
    }
    res.status(200).json({
      ok: true,
      ...checks,
      timestamp: new Date().toISOString()
    });
  });

app.get("/api/mode", (req, res) => {
    res.status(200).json({
      ok: true,
      mode: process.env.SATELINK_MODE || "simulation",
      env: process.env.NODE_ENV || "development"
    });
  });

  app.get("/api/runtime-info", (req, res) => {
    res.status(200).json({ ok: true, version: "1.0.0", uptime: process.uptime() });
  });

  app.get("/simulation/status", (req, res) => res.status(200).json({ ok: true, mode: "simulation", active: true }));

  // ── Public Machine-Readable Endpoints (no auth, for Chainlist/DeFi bots/AI agents) ──

  // GET /api/pricing — RPC pricing catalog for machine discovery
  app.get("/api/pricing", async (req, res) => {
    const DEFAULT_METHODS = {
      eth_blockNumber:          { usdt_per_call: 0.000001 },
      eth_getBalance:           { usdt_per_call: 0.000010 },
      eth_call:                 { usdt_per_call: 0.000030 },
      eth_sendRawTransaction:   { usdt_per_call: 0.000100 },
      eth_getLogs:              { usdt_per_call: 0.000050 },
      eth_getTransactionReceipt:{ usdt_per_call: 0.000020 }
    };

    let rpcPricing = {};
    try {
      const result = await pool.query(
        `SELECT method, base_cost_usdt FROM rpc_method_pricing WHERE enabled = 1 ORDER BY method`
      );
      const rows = Array.isArray(result) ? result : (result.rows || []);
      for (const m of rows) {
        rpcPricing[m.method] = { usdt_per_call: parseFloat(m.base_cost_usdt) };
      }
    } catch (e) {
      console.warn("[Pricing] rpc_method_pricing unavailable, using defaults:", e.message);
    }

    res.json({
      provider: "Satelink",
      network: "Polygon PoS",
      chain_id: 137,
      rpc_endpoint: "https://rpc.satelink.network/rpc/polygon",
      pricing_model: "pay_per_use",
      settlement_token: "USDT",
      settlement_chain: "Polygon",
      deposit_address: process.env.REVENUE_VAULT_ADDRESS || "0x577D3716d6Ad5b676d230f5409deF9838FABaCEF",
      methods: Object.keys(rpcPricing).length > 0 ? rpcPricing : DEFAULT_METHODS,
      free_tier: { requests_per_day: 500, api_key_required: false },
      status_url: "https://rpc.satelink.network/api/status"
    });
  });

  // GET /api/treasury/status — vault balance + deposit totals for agents and dashboards
  app.get("/api/treasury/status", async (req, res) => {
    const VAULT = process.env.REVENUE_VAULT_ADDRESS || '0x577D3716d6Ad5b676d230f5409deF9838FABaCEF';
    const USDT  = process.env.USDT_CONTRACT_ADDRESS  || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
    const RPC   = process.env.POLYGON_RPC             || 'https://polygon-mainnet.g.alchemy.com/v2/ZdR6Od2Clb0P2Jq1URQkc';

    // Fetch on-chain vault USDT balance (balanceOf selector = 0x70a08231)
    async function onChainBalance() {
      const data = '0x70a08231' + '000000000000000000000000' + VAULT.slice(2).toLowerCase();
      try {
        const r = await fetch(RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: USDT, data }, 'latest'], id: 1 }),
          signal: AbortSignal.timeout(4000)
        });
        const j = await r.json();
        if (!j.result || j.result === '0x') return 0;
        return Number(BigInt(j.result)) / 1e6;
      } catch { return null; }
    }

    try {
      const [depositsRow, walletsRow, vaultBal] = await Promise.all([
        pool.query(`SELECT COALESCE(SUM(amount_usdt), 0) AS total FROM credit_deposits`).catch(() => ({ rows: [{ total: 0 }] })),
        pool.query(`SELECT COUNT(*) AS cnt FROM credit_balances WHERE balance_usdt > 0`).catch(() => ({ rows: [{ cnt: 0 }] })),
        onChainBalance()
      ]);

      res.json({
        ok: true,
        vault_address:        VAULT,
        vault_balance_usdt:   vaultBal,
        total_deposited_usdt: parseFloat(depositsRow.rows[0]?.total || 0),
        active_wallets:       parseInt(walletsRow.rows[0]?.cnt || 0),
        network:              'Polygon Mainnet',
        timestamp:            new Date().toISOString()
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/diagnostics — system health for agents and dashboards (no auth required)
  app.get("/api/diagnostics", async (req, res) => {
    const t0 = Date.now();
    try {
      const [dbPing, nodeCount, epochCount, revenueSum] = await Promise.all([
        pool.query('SELECT 1').then(() => ({ ok: true, latencyMs: Date.now() - t0 })).catch(e => ({ ok: false, error: e.message })),
        pool.query(`SELECT COUNT(*) AS cnt FROM registered_nodes WHERE status = 'active'`).catch(() => ({ rows: [{ cnt: 0 }] })),
        pool.query(`SELECT COUNT(*) AS cnt FROM epochs`).catch(() => ({ rows: [{ cnt: 0 }] })),
        pool.query(`SELECT COALESCE(SUM(amount_usdt), 0) AS total FROM revenue_events_v2 WHERE is_test_data = false`).catch(() => ({ rows: [{ total: 0 }] }))
      ]);

      res.json({
        ok: true,
        timestamp:  new Date().toISOString(),
        system: {
          uptimeSeconds:  Math.floor(process.uptime()),
          memoryMb:       Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          nodeVersion:    process.version
        },
        database:   dbPing,
        counts: {
          activeNodes:        parseInt(nodeCount.rows[0]?.cnt  || 0),
          epochs:             parseInt(epochCount.rows[0]?.cnt || 0),
          totalRevenueUsdt:   parseFloat(revenueSum.rows[0]?.total || 0)
        },
        health: {
          database:   dbPing.ok ? 'healthy' : 'degraded',
          api:        'healthy'
        },
        responseTimeMs: Date.now() - t0
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/status — Live network status for machine monitoring
  app.get("/api/status", async (req, res) => {
    try {
      // current_epoch reads epoch_ledger (the live settlement ledger that
      // /api/settlement/history serves) — the `epochs` table lags it by hundreds
      // of epochs. total_requests_24h reads the same Redis free-tier counters that
      // /stats/free-tier exposes; the revenue_events_v2 count only captures billed
      // calls and undercounts real request volume by ~30x.
      const [nodesResult, regNodesResult, billedResult, epochResult, freeTierStats, healthResult] = await Promise.all([
        pool.query(`SELECT COUNT(*) as count FROM nodes WHERE status = 'online' OR status = 'active'`),
        pool.query(`SELECT COUNT(*) as count FROM registered_nodes WHERE status = 'active'`),
        pool.query(`SELECT COUNT(*) as total FROM revenue_events_v2 WHERE created_at > extract(epoch from now()) - 86400 AND is_test_data = false`),
        pool.query(`SELECT id FROM epoch_ledger ORDER BY id DESC LIMIT 1`),
        getFreeTierStats().catch(() => null),
        // Measured uptime/latency from the 24h health-log sample. These were
        // the hardcoded constants 99.5 / 85 until the 2026-07 data-truth audit
        // (docs/DATA_TRUTH_AUDIT.md #25). null when there is no sample.
        pool.query(
          `SELECT ROUND(100.0*COUNT(*) FILTER (WHERE status IN ('healthy','ok','up','online'))/NULLIF(COUNT(*),0),2)::float AS uptime,
                  ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY response_time_ms))::int AS p50
             FROM node_health_logs WHERE checked_at >= extract(epoch from now())-86400`
        ).catch(() => null)
      ]);
      const billed24h = parseInt(billedResult.rows?.[0]?.total || 0);
      const freeTierCalls = parseInt(freeTierStats?.totalCalls || 0);
      const requests24h = freeTierCalls > 0 ? freeTierCalls : billed24h;
      const nodesOnline = parseInt(nodesResult.rows[0]?.count || 0) + parseInt(regNodesResult.rows[0]?.count || 0);
      const measured = healthResult?.rows?.[0] || {};

      res.json({
        status: "operational",
        uptime_pct: measured.uptime ?? null,
        nodes_online: nodesOnline,
        current_epoch: epochResult.rows[0]?.id || 0,
        total_requests_24h: requests24h,
        avg_latency_ms: measured.p50 ?? null,
        chains_supported: ["polygon", "ethereum", "arbitrum", "base"],
        settlement: "USDT on Polygon PoS"
      });
    } catch (e) {
      console.error("[Status] Error:", e.message);
      res.json({
        status: "degraded",
        uptime_pct: null,
        nodes_online: null,
        current_epoch: 0,
        total_requests_24h: 0,
        avg_latency_ms: null,
        chains_supported: ["polygon", "ethereum", "arbitrum", "base"],
        settlement: "USDT on Polygon PoS"
      });
    }
  });

  // GET /provider.json — Machine-readable provider metadata (Chainlist, DeFi bots, AI agents)
  app.get("/provider.json", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json({
      name: "Satelink Network",
      description: "Decentralized Physical Infrastructure RPC Gateway",
      version: "1.0.0",
      website: "https://satelink.network",
      contact: "satelinknetwork@gmail.com",
      tracking: "none",
      trackingDetails: "Satelink does not log wallet addresses or IP addresses",
      chains: [
        {
          name: "Polygon Mainnet",
          chainId: 137,
          endpoint: "https://rpc.satelink.network/rpc/polygon",
          wss: "wss://rpc.satelink.network/rpc/ws/polygon"
        },
        {
          name: "Polygon Amoy Testnet",
          chainId: 80002,
          endpoint: "https://rpc.satelink.network/rpc/amoy"
        },
        {
          name: "Ethereum Mainnet",
          chainId: 1,
          endpoint: "https://rpc.satelink.network/rpc/ethereum"
        },
        {
          name: "Arbitrum One",
          chainId: 42161,
          endpoint: "https://rpc.satelink.network/rpc/arbitrum"
        },
        {
          name: "Base",
          chainId: 8453,
          endpoint: "https://rpc.satelink.network/rpc/base"
        }
      ],
      settlement: {
        token: "USDT",
        chain: "Polygon",
        contract: process.env.REVENUE_VAULT_ADDRESS || "0x577D3716d6Ad5b676d230f5409deF9838FABaCEF"
      },
      freeTier: {
        requestsPerDay: 500,
        apiKeyRequired: false
      },
      status: "https://rpc.satelink.network/api/status",
      pricing: "https://rpc.satelink.network/api/pricing"
    });
  });

  // Node operator auth endpoint (public, rate-limited)
  app.use("/api/auth", createUnifiedAuthRouter());

  // Unified auth router — login, register, /me
  // Adapt pg pool to match the db interface expected by auth modules
  const pgDbAdapter = {
    prepare: (sql) => ({
      get: async (params) => {
        const pgSql = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
        const result = await pool.query(pgSql, params);
        return result.rows[0] || null;
      },
      run: async (params) => {
        const pgSql = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
        return pool.query(pgSql, params);
      }
    }),
    // Direct query methods for wallet_auth.js
    query: async (sql, params) => {
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      return pool.query(pgSql, params);
    },
    get: async (sql, params) => {
      let idx = 0;
      const pgSql = sql.replace(/\?/g, () => `$${++idx}`);
      const result = await pool.query(pgSql, params);
      return result.rows[0] || null;
    }
  };

  // Wallet signature auth — /auth/challenge, /auth/verify (frontend wallet login flow)
  app.use("/auth", createAuthController(pgDbAdapter));

  // Email/password auth — /auth/login, /auth/register, /auth/me
  app.use("/auth", createUserAuthRouter({ db: pgDbAdapter }));

  // Free tier monitoring endpoint (outside /api to avoid router conflicts)
  app.get("/stats/free-tier", async (req, res) => res.json(await getFreeTierStats()));

  // x402 v2 parallel payment rail — inert bare next() unless X402_ENABLED='true'.
  // With a settled x402 payment the request must not also consume free-tier
  // quota, so the gate is skipped for exactly that case; every other request
  // hits freeTierGate unchanged (the gate module itself is untouched).
  const x402Middleware = createX402Middleware(pool, console);
  const freeTierGateUnlessX402Paid = (req, res, next) =>
    req.x402?.settled ? next() : freeTierGate(req, res, next);

  // RPC Gateway — freeTierGate runs before JSON parsing to reject rate-limited IPs
  // before their request body is allocated (prevents OOM from high-volume abusers).
  // Body limit 1mb covers all legitimate RPC batch calls; 50mb caused heap exhaustion.
  app.use("/rpc", x402Middleware, freeTierGateUnlessX402Paid, express.json({ limit: '1mb' }), createRpcGateway(pool));

  // MEV Private Relay (S3-001) — 10x pricing, requires API key
  app.use("/rpc/mev", createMevRelayRouter(pool, redis));

  // Deposit-page P0 backend — credit balance/history (path-param) + on-chain vault
  // balance. Mounted BEFORE the "/v1" ai-gateway so /v1/credits and /v1/vault are not
  // shadowed by it. Schema verified via psql against production Postgres.
  app.use("/v1/credits", createDepositEconomicsRouter(pool, console));
  app.use("/v1/vault", createVaultRouter(console));

  // Autonomous machine onboarding — /v1/pricing + /v1/machine/register.
  // Mounted BEFORE the "/v1" ai-gateway so its paths are not shadowed.
  app.use("/v1", express.json({ limit: '16kb' }), createMachineV1Router(pool, redis));

  // Machine decision APIs — /v1/compare + /v1/capabilities (pricing intel).
  // Read-only; mounted BEFORE the "/v1" ai-gateway for the same shadowing reason.
  app.use("/v1", createMachineIntelRouter(pool, redis));

  // AI Inference Gateway (S3-002) — OpenAI-compatible, per-token billing
  app.use("/v1", createAiGatewayRouter(pool, redis));

  app.use("/api/bandwidth", createBandwidthRouter(pool, redis));  // LangChain Tool Adapter (S3-004) — AI agent tool definitions
  app.use("/v1/tools", createLangChainAdapterRouter(pool, redis));

  // OpenAI Plugin Manifest (S3-005) — AI ecosystem integration
  // + Satelink machine manifest (/.well-known/satelink.json)
  app.use("/.well-known", createWellKnownSatelinkRouter());
  app.use("/.well-known", createPluginManifestRouter());
  app.use("/openapi.json", createOpenApiRouter());

  // API Key management (with deposit verification for tier upgrades)
  app.use("/api/keys", createSimpleApiKeysRouter(pool));

  // Revenue API routes
  app.use("/api", revenueRoutes(pool));

  // Node Registry (S2-001)
  app.use("/api/nodes", createNodeRegistryRouter(pool, redis));

  // Claims API (pull model settlement)
  app.use("/api/nodes", createClaimsRouter(pool));

  // SDK Analytics (S4-005)
  app.use("/api", createSdkAnalyticsRouter());

  // Settlement Audit (S7-004)
  app.use("/api/settlement", createSettlementAuditRouter(pool));

  // Webhook Delivery System (S8-003)
  app.use("/api/webhooks", createWebhookRouter(pool, redis));
  ensureWebhookTable(pool).catch(e => console.error('[Webhooks] Table setup failed:', e.message));

  // Oracle Price Feed (S8-004)
  app.use("/api/oracle", createOracleRouter(pool, redis));

  // Satelink OS Real-time Events (SSE)
  app.use("/os", createOsEventsRouter());

  // Internal machine identity and observability control plane
  app.use("/machine-access/v1", createMachineAccessRouter(pool, redis));

  // Admin MAL - Founder Mode diagnostics (MASTER_ADMIN_TOKEN protected)
  app.use("/api/admin", createAdminMalRouter(pool));

  // Financial Truth - canonical source for all financial metrics
  app.use("/api/financial", createFinancialTruthRouter(pool));

  // Conversion funnel: fetching deposit calldata is the "payment_started"
  // signal (the URL every 402 advertises). Counting middleware only — the
  // credits router itself is untouched.
  app.use("/credits/deposit/initiate", (req, _res, next) => {
    bumpConversionStage(redis, 'pay_start');
    next();
  });

  // Credits API - autonomous payer balance and deposit queries
  app.use("/credits", createCreditsRouter(pool, console));

  // Deposit notify webhook - machines signal after depositing; DepositListener
  // still owns on-chain confirmation. Closes the M2M loop from the 402 notify_url.
  app.use("/api/deposit", createDepositNotifyRouter(pool));

  // x402 conversion funnel counters — same admin-token guard as /admin.
  app.get("/internal/x402-funnel", requireAdminAuth, createFunnelHandler(pool));

  // Admin Command Center — protected by ADMIN_SECRET_TOKEN (x-admin-token header).
  // express.json() is applied here so the JSON-only admin routes parse bodies
  // without forcing a parser onto the high-volume /rpc path above.
  app.use("/admin", requireAdminAuth, express.json({ limit: '256kb' }), createAdminRouter(pool, redis));

  // vNext durable kernel surface — ADDITIVE, admin-gated, and inert unless
  // VNEXT_KERNEL_ENABLED=true (default OFF: no DB access, no kernel boot). Does
  // not touch any existing route or the live money path.
  app.use("/vnext", requireAdminAuth, createVnextKernelRouter(pool));

  return app;
}
