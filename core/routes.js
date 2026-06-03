import { createOpsEngine } from './ops_engine_adapter.js';
import { createServiceStubs } from './service_stubs.js';
import { createProdGuard } from '../src/middleware/prod_guard.js';

// Routes guaranteed to load (tested clean dep chains)
import { createUnifiedAuthRouter, verifyJWT } from '../src/routes/auth_v2.js';
import { closeEpoch } from './epoch_aggregator.js';
import { getAggregatedNodeEarnings } from './node_earnings.js';
import { getNetworkStats } from './network_stats.js';
import { getEconomicsSummary } from './economics_stats.js';

/**
 * Dynamically import a route module, returning null on failure.
 * Used for route files that may have missing deps during dev.
 */
async function tryImport(specifier) {
    try {
        return await import(specifier);
    } catch (e) {
        console.warn(`[ROUTES] skipped ${specifier}: ${e.message}`);
        return null;
    }
}

/**
 * Safe mount helper — catches construction errors so one bad
 * route file doesn't crash the whole server.
 */
function safeMountRouter(app, path, routerFn, label) {
    try {
        const router = typeof routerFn === 'function' ? routerFn() : routerFn;
        if (router && (typeof router === 'function' || router.stack)) {
            app.use(path, router);
            console.log(`[ROUTES] ✓ Mounted ${label} at ${path}`);
        } else {
            console.error(`[ROUTES] ✗ ${label} returned invalid router:`, typeof router);
        }
    } catch (e) {
        console.error(`[ROUTES] ✗ Failed to mount ${label} at ${path}: ${e.message}`);
    }
}

export async function attachRoutes(app, rawDb) {
    // ─── 1. Create opsEngine with async db wrapper ───────────────
    const opsEngine = createOpsEngine(rawDb);
    createServiceStubs(rawDb, opsEngine);
    app.set('opsEngine', opsEngine);

    // ─── 2. Production guard ─────────────────────────────────────
    app.use(createProdGuard());

    // ─── 3. Admin key middleware ─────────────────────────────────
    const requireAdminKey = app.locals.requireAdminKey || ((req, res, next) => {
        const key = process.env.ADMIN_API_KEY || "test-admin-secret";
        if ((req.get("X-Admin-Key") || req.get("x-admin-key") || "") !== key) {
            return res.status(401).json({ ok: false, error: "Unauthorized" });
        }
        next();
    });

    // ═══════════════════════════════════════════════════════════
    // HEALTH — mounted first so it's always available
    // ═══════════════════════════════════════════════════════════
    app.get("/health", async (req, res) => {
        let db_status = 'ok';
        try { await rawDb.prepare('SELECT 1').get(); } catch (e) { db_status = 'error'; }
        res.status(200).json({
            ok: true,
            service: 'satelink',
            uptime: Math.floor(process.uptime()),
            db_status,
            version: process.env.npm_package_version || '1.0.0'
        });
    });

    // ═══════════════════════════════════════════════════════════
    // AUTH ROUTES
    // ═══════════════════════════════════════════════════════════
    safeMountRouter(app, '/auth', () => createUnifiedAuthRouter(opsEngine), 'auth_v2');

    const authEmbedded = await tryImport('../apps/api/src/gateway/routes/auth_embedded.js');
    if (authEmbedded) safeMountRouter(app, '/', () => authEmbedded.createEmbeddedAuthRouter(rawDb), 'auth_embedded');

    const builderAuth = await tryImport('../apps/api/src/gateway/routes/builder_auth.js');
    let builderAuthRouter;
    if (builderAuth) {
        try { builderAuthRouter = builderAuth.createBuilderAuthRouter(opsEngine); } catch (e) {
            console.error('[ROUTES] Failed to create builder auth router:', e.message);
        }
    }
    if (builderAuthRouter) safeMountRouter(app, '/', () => builderAuthRouter, 'builder_auth');

    const stagingAuth = await tryImport('../apps/api/src/gateway/routes/staging_auth.js');
    if (stagingAuth) safeMountRouter(app, '/staging', () => stagingAuth.createStagingAuthRouter(opsEngine), 'staging_auth');

    // ═══════════════════════════════════════════════════════════
    // USER SETTINGS
    // ═══════════════════════════════════════════════════════════
    const userSettings = await tryImport('../apps/api/src/gateway/routes/user_settings.js');
    if (userSettings) safeMountRouter(app, '/me', () => userSettings.createUserSettingsRouter(rawDb), 'user_settings');

    // ═══════════════════════════════════════════════════════════
    // MAIN DASHBOARD API ROUTES
    // ═══════════════════════════════════════════════════════════
    const adminApi = await tryImport('../src/routes/admin_api_v2.js');
    if (adminApi) safeMountRouter(app, '/admin-api', () => adminApi.createAdminApiRouter(opsEngine), 'admin_api_v2');

    app.use('/node-api', verifyJWT);
    const nodeApi = await tryImport('../src/routes/node_api_v2.js');
    if (nodeApi) safeMountRouter(app, '/node-api', () => nodeApi.createNodeApiRouter(opsEngine), 'node_api_v2');

    app.use('/builder-api', verifyJWT);
    const builderApiV2 = await tryImport('../apps/api/src/gateway/routes/builder_api_v2.js');
    if (builderApiV2) safeMountRouter(app, '/builder-api', () => builderApiV2.createBuilderApiV2Router(opsEngine), 'builder_api_v2');

    app.use('/dist-api', verifyJWT);
    const distApi = await tryImport('../apps/api/src/gateway/routes/dist_api_v2.js');
    if (distApi) safeMountRouter(app, '/dist-api', () => distApi.createDistApiRouter(opsEngine), 'dist_api_v2');

    app.use('/ent-api', verifyJWT);
    const entApi = await tryImport('../apps/api/src/gateway/routes/ent_api_v2.js');
    if (entApi) safeMountRouter(app, '/ent-api', () => entApi.createEntApiRouter(opsEngine), 'ent_api_v2');

    // ═══════════════════════════════════════════════════════════
    // ADMIN SUB-ROUTERS (gateway)
    // ═══════════════════════════════════════════════════════════
    const adminRoutes = [
        ['admin_autonomous', '/admin-api/autonomous', 'createAdminAutonomousRouter'],
        ['admin_control_api', '/admin-api/control', 'createAdminControlRouter'],
        ['admin_control_room_api', '/admin-api/control-room', 'createAdminControlRoomRouter'],
        ['admin_distributors', '/admin-api/distributors', 'createAdminDistributorsRouter'],
        ['admin_economics', '/admin-api/economics', 'createAdminEconomicsRouter'],
        ['admin_forensics', '/admin-api/forensics', 'createAdminForensicsRouter'],
        ['admin_growth', '/admin-api/growth', 'createAdminGrowthRouter'],
        ['admin_launch', '/admin-api/launch', 'createAdminLaunchRouter'],
        ['admin_lifecycle', '/admin-api/lifecycle', 'createAdminLifecycleRouter'],
        ['admin_network', '/admin-api/network', 'createAdminNetworkRouter'],
        ['admin_partners', '/admin-api/partners', 'createAdminPartnersRouter'],
        ['admin_reputation', '/admin-api/reputation', 'createAdminReputationRouter'],
        ['admin_revenue', '/admin-api/revenue', 'createAdminRevenueRouter'],
        ['admin_sla', '/admin-api/sla', 'createAdminSLARouter'],
        ['admin_system', '/admin-api/system', 'createAdminSystemRouter'],
    ];
    for (const [file, mountPath, fn] of adminRoutes) {
        const mod = await tryImport(`../apps/api/src/gateway/routes/${file}.js`);
        if (mod && mod[fn]) safeMountRouter(app, mountPath, () => mod[fn](opsEngine), file);
    }

    // ═══════════════════════════════════════════════════════════
    // FUNCTIONAL APIs
    // ═══════════════════════════════════════════════════════════
    const betaApi = await tryImport('../apps/api/src/gateway/routes/beta_api.js');
    if (betaApi) safeMountRouter(app, '/beta', () => betaApi.createBetaRouter(opsEngine), 'beta_api');

    const streamApi = await tryImport('../apps/api/src/gateway/routes/stream_api.js');
    if (streamApi) safeMountRouter(app, '/stream', () => streamApi.createStreamApiRouter(opsEngine), 'stream_api');

    const phase3 = await tryImport('../src/routes/api_phase3.js');
    if (phase3) safeMountRouter(app, '/api/v3', () => phase3.createPhase3Router(opsEngine), 'api_phase3');

    const enterprise = await tryImport('../src/routes/api_enterprise.js');
    if (enterprise) {
        if (enterprise.createEnterpriseRouter) safeMountRouter(app, '/enterprise', () => enterprise.createEnterpriseRouter(opsEngine), 'enterprise');
        if (enterprise.createDemandMetricsRouter) safeMountRouter(app, '/enterprise/metrics', () => enterprise.createDemandMetricsRouter(opsEngine), 'demand_metrics');
    }

    // ─── Wildcard catch-all LAST ─────────────────────────────────
    app.all('*catchall', (req, res) => {
        res.status(404).json({ ok: false, error: "Not Found" });
    });

    // ═══════════════════════════════════════════════════════════
    // DEV/TEST ROUTES
    // ═══════════════════════════════════════════════════════════
    const devAuth = await tryImport('../apps/api/src/gateway/routes/dev_auth_tokens.js');
    if (devAuth) safeMountRouter(app, '/__test/auth', () => devAuth.createDevAuthRouter(opsEngine), 'dev_auth');

    const devSeed = await tryImport('../apps/api/src/gateway/routes/dev_seed.js');
    if (devSeed) safeMountRouter(app, '/__test/seed', () => devSeed.createDevSeedRouter(opsEngine), 'dev_seed');

    console.log('[ROUTES] Route attachment complete');
}
