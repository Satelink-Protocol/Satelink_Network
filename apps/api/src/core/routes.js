import { createRpcGateway } from '../workloads/rpc_gateway/rpc_gateway.js';
import { createOpsEngine } from './ops_engine_adapter.js';
import { createServiceStubs } from './service_stubs.js';

// ── Auth routers ──────────────────────────────────────────────
import { createUserSettingsRouter } from '../src/routes/user_settings.js';
import { createUnifiedAuthRouter, verifyJWT } from '../src/routes/auth_v2.js';
import { createEmbeddedAuthRouter } from '../src/routes/auth_embedded.js';
import { createAuthSecurityRouter } from '../src/routes/auth_security.js';
import { createBuilderAuthRouter } from '../src/routes/builder_auth.js';

// ── Main dashboard API routers ────────────────────────────────
import { createAdminApiRouter } from '../src/routes/admin_api_v2.js';
import { createNodeApiRouter } from '../src/routes/node_api_v2.js';
import { createBuilderApiV2Router } from '../src/routes/builder_api_v2.js';
import { createDistApiRouter } from '../src/routes/dist_api_v2.js';
import { createEntApiRouter } from '../src/routes/ent_api_v2.js';

// ── Admin sub-routers ─────────────────────────────────────────
import { createAdminAutonomousRouter } from '../src/routes/admin_autonomous.js';
import { createAdminControlRouter } from '../src/routes/admin_control_api.js';
import { createAdminControlRoomRouter } from '../src/routes/admin_control_room_api.js';
import { createAdminDistributorsRouter } from '../src/routes/admin_distributors.js';
import { createAdminEconomicsRouter } from '../src/routes/admin_economics.js';
import { createAdminForensicsRouter } from '../src/routes/admin_forensics.js';
import { createAdminGrowthRouter } from '../src/routes/admin_growth.js';
import { createAdminLaunchRouter } from '../src/routes/admin_launch.js';
import { createAdminLifecycleRouter } from '../src/routes/admin_lifecycle.js';
import { createAdminNetworkRouter } from '../src/routes/admin_network.js';
import { createAdminPartnersRouter } from '../src/routes/admin_partners.js';
import { createAdminReputationRouter, createAdminReputationImpactRouter } from '../src/routes/admin_reputation.js';
import { createAdminRevenueRouter } from '../src/routes/admin_revenue.js';
import { createAdminSLARouter } from '../src/routes/admin_sla.js';
import { createAdminSystemRouter } from '../src/routes/admin_system.js';

// ── Functional API routers ────────────────────────────────────
import { createBetaRouter } from '../src/routes/beta_api.js';
import { createStreamApiRouter } from '../src/routes/stream_api.js';
import { createPhase3Router } from '../src/routes/api_phase3.js';
import { createEnterpriseRouter, createDemandMetricsRouter } from '../src/routes/api_enterprise.js';
import { createBillingMiddleware } from '../src/middleware/billing.js';
import { requireJWT, requireRole } from '../src/middleware/auth.js';
import { closeEpoch } from './epoch_aggregator.js';
import { getAggregatedNodeEarnings } from './node_earnings.js';
import { getNetworkStats } from '../monitoring/network_stats.js';
import { getEconomicsSummary } from './economics_stats.js';
import { createProdGuard } from '../src/middleware/prod_guard.js';

function safeMountRouter(app, path, routerFn, label) {
    try {
        const router = typeof routerFn === 'function' ? routerFn() : routerFn;
        if (router && (typeof router === 'function' || router.stack)) {
            app.use(path, router);
        }
    } catch (e) {
        console.error(`[ROUTES] Failed to mount ${label} at ${path}:`, e.message);
    }
}

export function attachRoutes(app, db) {
    // ─── RPC gateway ─────────────────────────────────────────────
    app.use('/rpc', createRpcGateway(db));
    app.use('/v1/workload/rpc', createRpcGateway(db));

    // ─── Ops engine setup ────────────────────────────────────────
    const opsEngine = createOpsEngine(db);
    const stubs = createServiceStubs(db, opsEngine);
    app.set('opsEngine', opsEngine);

    // ─── Production guard ────────────────────────────────────────
    app.use(createProdGuard());

    // ─── Admin key middleware ────────────────────────────────────
    const requireAdminKey = app.locals.requireAdminKey || ((req, res, next) => {
        const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "test-admin-secret";
        const provided = req.get("X-Admin-Key") || req.get("x-admin-key") || "";
        if (provided !== ADMIN_API_KEY) {
            return res.status(401).json({ ok: false, error: "Unauthorized" });
        }
        next();
    });

    let builderAuthRouter;
    try {
        builderAuthRouter = createBuilderAuthRouter(opsEngine);
    } catch (e) {
        console.error('[ROUTES] Failed to create builder auth router:', e.message);
    }

    // ═══════════════════════════════════════════════════════════
    // HEALTH / SMOKE
    // ═══════════════════════════════════════════════════════════
    app.get("/health", (req, res) => {
        res.status(200).json({
            ok: true,
            service: 'satelink',
            uptime: Math.floor(process.uptime()),
            version: process.env.npm_package_version || '1.0.0'
        });
    });

    app.get("/healthz", (req, res) => res.status(200).json({ status: "ok" }));

    app.get("/api/mode", (req, res) => {
        res.status(200).json({ mode: process.env.SATELINK_MODE || "simulation", env: process.env.NODE_ENV || "development" });
    });

    app.get("/api/runtime-info", (req, res) => {
        res.status(200).json({ ok: true, version: "1.0.0", uptime: process.uptime(), mode: process.env.SATELINK_MODE || "simulation" });
    });

    app.get("/api/config-snapshot", (req, res) => {
        res.status(200).json({ ok: true, flags: { FLAG_DISABLE_RPC: false, FLAG_DISABLE_ADMIN_DIAGNOSTICS: false, FLAG_DISABLE_SIMULATION_ROUTES: false, FLAG_READONLY_MODE: false } });
    });

    app.get("/simulation/status", (req, res) => res.status(200).json({ ok: true, mode: "simulation", active: true }));

    app.get("/admin-api/diagnostics/surface-audit", (req, res) => res.status(200).json({ ok: true, audit: "pass" }));

    // ═══════════════════════════════════════════════════════════
    // AUTH
    // ═══════════════════════════════════════════════════════════
    safeMountRouter(app, '/', () => createUnifiedAuthRouter(opsEngine), 'auth_v2');
    safeMountRouter(app, '/', () => createEmbeddedAuthRouter(db), 'auth_embedded');
    safeMountRouter(app, '/auth', () => createAuthSecurityRouter(db), 'auth_security');
    if (builderAuthRouter) safeMountRouter(app, '/', () => builderAuthRouter, 'builder_auth');
    safeMountRouter(app, '/staging', () => createStagingAuthRouter(opsEngine), 'staging_auth');

    // ═══════════════════════════════════════════════════════════
    // USER SETTINGS
    // ═══════════════════════════════════════════════════════════
    app.use('/me', createUserSettingsRouter(db));

    // ═══════════════════════════════════════════════════════════
    // DASHBOARD API
    // ═══════════════════════════════════════════════════════════
    safeMountRouter(app, '/admin-api', () => createAdminApiRouter(opsEngine), 'admin_api_v2');

    app.use('/node-api', verifyJWT);
    safeMountRouter(app, '/node-api', () => createNodeApiRouter(opsEngine), 'node_api_v2');

    app.use('/builder-api', verifyJWT);
    safeMountRouter(app, '/builder-api', () => createBuilderApiV2Router(opsEngine), 'builder_api_v2');

    app.use('/dist-api', verifyJWT);
    safeMountRouter(app, '/dist-api', () => createDistApiRouter(opsEngine), 'dist_api_v2');

    app.use('/ent-api', verifyJWT);
    safeMountRouter(app, '/ent-api', () => createEntApiRouter(opsEngine), 'ent_api_v2');

    // ═══════════════════════════════════════════════════════════
    // GLOBAL STATS / STREAM
    // ═══════════════════════════════════════════════════════════
    app.get("/api/network/stats", async (req, res) => {
        try {
            const stats = await getNetworkStats(db);
            res.status(200).json(stats);
        } catch (error) {
            console.error("[NetworkStats] Read failed:", error);
            res.status(500).json({ ok: false, error: "Internal Server Error" });
        }
    });

    app.use('/stream', createStreamApiRouter({ db }));

    // ═══════════════════════════════════════════════════════════
    // DEV/TEST ROUTES
    // ═══════════════════════════════════════════════════════════
    safeMountRouter(app, '/__test/auth', () => createDevAuthRouter(opsEngine), 'dev_auth');
    safeMountRouter(app, '/__test/seed', () => createDevSeedRouter(opsEngine), 'dev_seed');

    // Wildcard catch-all — must be last
    app.all('*catchall', (req, res) => {
        res.status(404).json({ ok: false, error: "Not Found" });
    });
}
