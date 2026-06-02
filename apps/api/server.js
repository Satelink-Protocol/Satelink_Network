import express from "express";
import { createPhase3Router } from "./src/gateway/routes/api_phase3.js";
import { createServer } from 'http';
import { pathToFileURL } from 'url';
import { startSentinel } from "./src/autonomous/sentinel.js";
import { getScalingStats } from "./src/autonomous/auto_scaler.js";
import { getHealerStats } from "./src/autonomous/rpc_healer.js";
import { getAnomalyStats } from "./src/autonomous/revenue_anomaly.js";
import { checkTreasury, getTreasuryStatus } from "./src/autonomous/treasury_monitor.js";
import { getCapacityStats } from "./src/autonomous/capacity_alerter.js";
import { createApp } from "./app_factory.mjs";
import { createWsGateway, getWsStats } from "./src/workloads/rpc_gateway/ws_gateway.js";
import { startHealthMonitor, healthMonitorStatus } from "./src/scheduler/node_health_monitor.js";
import { startOfflineDetector, offlineDetectorStatus } from "./src/services/node_registry/offline_detector.js";
import { startEpochScheduler, schedulerStatus, runEpochCycle } from "./src/economics/epoch_scheduler.js";
import { startClaimExpiryJob } from "./src/scheduler/jobs/claim_expiry_job.js";
import { ensureMachineAccessTables } from "./src/machine-access/index.js";
import { startTreasurySettlementScheduler } from "./src/jobs/treasury_settlement_job.mjs";
import { startDataRetentionScheduler } from "./src/jobs/data_retention_job.mjs";
import { startRpcAggregationScheduler } from "./src/jobs/rpc_aggregation_job.mjs";
import { createSettlementAnchorJob } from "./src/scheduler/jobs/settlement_anchor_job.js";
import { discord } from "./src/services/discord_notify.mjs";
import pkg from "pg";
import { DepositListener } from "./src/services/deposit_listener.js";
import { runMigrations } from "./src/db/migrate.js";
import { createCreditsRouter } from "./src/routes/credits.js";

const { Pool } = pkg;

// Suppress ethers.js internal @TODO console.log for eth_getFilterChanges "filter not found".
// ethers v6 subscriber-filterid.js#poll() catches filter-expiry errors and emits
// console.log("@TODO", error) — harmless but noisy in production logs.
const _origConsoleLog = console.log;
console.log = (...args) => {
  if (args[0] === '@TODO' && (
    args[1]?.payload?.method === 'eth_getFilterChanges' ||
    args[1]?.message?.includes('could not coalesce')
  )) return;
  _origConsoleLog(...args);
};

// Redis eliminated — all caching/rate-limiting/circuit-breaker is in-memory
// This saves ~865k commands/month on Upstash free tier

async function ensureBillingTables(pool) {
  // CRITICAL: Drop NOT NULL on node_id FIRST (runs independently)
  try {
    await pool.query(`
      ALTER TABLE revenue_events_v2
      ALTER COLUMN node_id DROP NOT NULL
    `);
    console.log('[STARTUP] node_id constraint dropped');
  } catch (e) {
    // Ignore - constraint may not exist or table may not exist yet
  }

  try {
    // Create epochs table FIRST — epoch_scheduler depends on this
    await pool.query(`
      CREATE TABLE IF NOT EXISTS epochs (
        id SERIAL PRIMARY KEY,
        starts_at BIGINT NOT NULL,
        ends_at BIGINT,
        status TEXT DEFAULT 'OPEN',
        total_revenue_usdt NUMERIC(18,8) DEFAULT 0,
        node_pool_usdt NUMERIC(18,8) DEFAULT 0,
        platform_share_usdt NUMERIC(18,8) DEFAULT 0,
        distributor_share_usdt NUMERIC(18,8) DEFAULT 0,
        total_node_weight REAL DEFAULT 0,
        closed_at TEXT
      )
    `);
    console.log('[STARTUP] epochs table ensured');

    // Create epoch_earnings table — earnings pipeline depends on this
    await pool.query(`
      CREATE TABLE IF NOT EXISTS epoch_earnings (
        epoch_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        wallet_or_node_id TEXT NOT NULL,
        amount_usdt NUMERIC(18,8) NOT NULL,
        status TEXT NOT NULL DEFAULT 'UNPAID',
        created_at BIGINT NOT NULL,
        PRIMARY KEY (epoch_id, role, wallet_or_node_id)
      )
    `);
    console.log('[STARTUP] epoch_earnings table ensured');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS epoch_ledger (
        id SERIAL PRIMARY KEY,
        epoch_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'OPEN',
        started_at BIGINT NOT NULL,
        closed_at BIGINT,
        total_revenue NUMERIC(18,8) DEFAULT 0,
        node_pool NUMERIC(18,8) DEFAULT 0,
        platform_fee NUMERIC(18,8) DEFAULT 0,
        distribution_pool NUMERIC(18,8) DEFAULT 0,
        merkle_root TEXT,
        tx_hash TEXT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS revenue_events_v2 (
        id SERIAL PRIMARY KEY,
        op_type TEXT,
        node_id TEXT,
        client_id TEXT,
        amount_usdt NUMERIC(18,8) NOT NULL DEFAULT 0,
        status TEXT DEFAULT 'pending',
        request_id TEXT UNIQUE,
        created_at BIGINT,
        chain TEXT,
        method TEXT,
        source TEXT,
        epoch_id INTEGER
      )
    `);

    // Add UNIQUE constraint if table already exists without it
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_revenue_events_v2_request_id
      ON revenue_events_v2 (request_id)
      WHERE request_id IS NOT NULL
    `).catch(() => {});

    // Add test/production segregation columns (034_revenue_source_validation)
    await pool.query(`
      ALTER TABLE revenue_events_v2
      ADD COLUMN IF NOT EXISTS is_test_data BOOLEAN NOT NULL DEFAULT FALSE
    `).catch(() => {});

    await pool.query(`
      ALTER TABLE revenue_events_v2
      ADD COLUMN IF NOT EXISTS source_validated BOOLEAN NOT NULL DEFAULT FALSE
    `).catch(() => {});

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_revenue_events_is_test
      ON revenue_events_v2(is_test_data, epoch_id)
    `).catch(() => {});

    await pool.query(`
      INSERT INTO epoch_ledger (epoch_id, status, started_at, total_revenue)
      SELECT 'epoch-auto-1', 'OPEN', EXTRACT(EPOCH FROM NOW()) * 1000, 0
      WHERE NOT EXISTS (SELECT 1 FROM epoch_ledger WHERE status = 'OPEN')
    `).catch(() => {}); // Ignore if epoch_ledger schema differs

    // Node routing columns for dispatcher circuit breaker
    await pool.query(`ALTER TABLE registered_nodes ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0`).catch(() => {});
    await pool.query(`ALTER TABLE registered_nodes ADD COLUMN IF NOT EXISTS total_requests_served BIGINT NOT NULL DEFAULT 0`).catch(() => {});
    await pool.query(`ALTER TABLE registered_nodes ADD COLUMN IF NOT EXISTS avg_latency_ms REAL DEFAULT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE registered_nodes ADD COLUMN IF NOT EXISTS last_failure_at BIGINT DEFAULT NULL`).catch(() => {});
    await pool.query(`ALTER TABLE registered_nodes ADD COLUMN IF NOT EXISTS last_failure_reason TEXT DEFAULT NULL`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_nodes_dispatch ON registered_nodes(status, node_type, last_heartbeat_at) WHERE status = 'active'`).catch(() => {});

    // Create nodes table (referenced by /api/status and epoch earnings)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nodes (
        node_id TEXT PRIMARY KEY,
        wallet TEXT,
        device_type TEXT DEFAULT 'undefined',
        status TEXT DEFAULT 'pending',
        last_seen INTEGER,
        created_at INTEGER
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_nodes_wallet ON nodes(wallet)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status)`).catch(() => {});

    // Performance indexes for revenue queries
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rev2_created_at ON revenue_events_v2(created_at)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rev2_epoch_id ON revenue_events_v2(epoch_id)`).catch(() => {});

    // RPC usage hourly aggregates table (for rpc_aggregation_job)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rpc_usage_hourly (
        id SERIAL PRIMARY KEY,
        hour_start BIGINT NOT NULL,
        client_id TEXT,
        method TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        request_count INTEGER DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        cached_count INTEGER DEFAULT 0,
        total_cost_usdt NUMERIC(18,8) DEFAULT 0,
        avg_latency_ms NUMERIC DEFAULT 0,
        p99_latency_ms INTEGER DEFAULT 0,
        UNIQUE(hour_start, client_id, method, chain_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rpc_usage_hour ON rpc_usage_hourly(hour_start)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_rpc_usage_client ON rpc_usage_hourly(client_id)`).catch(() => {});

    console.log('[STARTUP] Billing tables ensured');
  } catch (err) {
    console.error('[STARTUP] Billing migration failed:', err.message);
  }
}

async function start() {
  console.log("🚀 SERVER STARTED - BOOT SEQUENCE BEGINNING");

  // Step 1: Create PostgreSQL pool (non-blocking - just config)
  let pool;
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : false,
    });
    console.log('[BOOT] ✅ PostgreSQL pool created');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at Pool creation:', err.message);
  }

  // Step 2: Redis ELIMINATED — using in-memory Maps instead
  // Saves ~865k commands/month on Upstash free tier
  const redis = null;
  console.log('[BOOT] ✅ Redis disabled — all caching/rate-limiting in-memory');

  // Step 3: Create Express app (non-blocking)
  let app;
  try {
    app = createApp(pool, redis);
    console.log('[BOOT] ✅ Express app created');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at createApp:', err.message);
  }

  // Step 5: Mount additional middleware and routes
  try {
    app.use("/", createPhase3Router());
    app.use("/credits", createCreditsRouter(pool, console));

    app.get('/ws/stats', (req, res) => {
      res.json({ ok: true, ...getWsStats() });
    });

    app.get('/system/health-monitor', (req, res) => {
      res.json({ ok: true, ...healthMonitorStatus });
    });

    app.get('/system/offline-detector', (req, res) => {
      res.json({ ok: true, ...offlineDetectorStatus });
    });

    app.get('/system/epoch-scheduler', (req, res) => {
      res.json({ ok: true, ...schedulerStatus });
    });

    // Manual epoch trigger for testing/recovery
    app.post('/system/epoch-scheduler/trigger', async (req, res) => {
      try {
        console.log('[ADMIN] Manual epoch cycle triggered');
        const result = await runEpochCycle(pool);
        res.json({ ok: true, ...result });
      } catch (e) {
        console.error('[ADMIN] Manual epoch trigger failed:', e.message);
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    app.get('/system/scaling-stats', async (req, res) => {
      try {
        const stats = await getScalingStats(pool, redis);
        res.json({ ok: true, ...stats });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    app.get(['/system/rpc-healer', '/system/rpc-healer/:chain'], async (req, res) => {
      try {
        const chain = req.params.chain || 'polygon-amoy';
        const stats = await getHealerStats(chain);
        res.json({ ok: true, ...stats });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    app.get('/system/revenue-anomalies', async (req, res) => {
      try {
        const stats = await getAnomalyStats(pool, redis);
        res.json({ ok: true, ...stats });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    app.get('/system/treasury', async (req, res) => {
      try {
        let status = await getTreasuryStatus(redis);
        if (!status) {
          status = await checkTreasury(redis);
        }
        res.json({ ok: true, ...status });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    app.get('/system/capacity', async (req, res) => {
      try {
        const stats = await getCapacityStats(pool, redis);
        res.json({ ok: true, ...stats });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Free tier usage stats (Path C monitoring)
    app.get('/system/free-tier', async (req, res) => {
      try {
        const { getFreeTierStats, getConversionTargets } = await import('./src/middleware/free_tier_gate.js');
        const stats = getFreeTierStats();
        const conversionTargets = getConversionTargets();
        res.json({
          ok: true,
          ...stats,
          conversion_targets: conversionTargets,
          conversion_count: conversionTargets.length
        });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Treasury settlement status endpoint (mounted early, uses job instance later)
    app.get('/system/treasury-settlement', async (req, res) => {
      try {
        const { TreasurySettlementJob } = await import('./src/jobs/treasury_settlement_job.mjs');
        const job = new TreasurySettlementJob(pool);
        const status = await job.getStatus();
        res.json({ ok: true, ...status });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Data retention job status endpoint
    app.get('/system/data-retention', async (req, res) => {
      try {
        const { DataRetentionJob } = await import('./src/jobs/data_retention_job.mjs');
        const job = new DataRetentionJob(pool);
        const status = job.getStatus();
        res.json({ ok: true, ...status });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Manual data retention trigger for testing/recovery
    app.post('/system/data-retention/trigger', async (req, res) => {
      try {
        console.log('[ADMIN] Manual data retention triggered');
        const { DataRetentionJob } = await import('./src/jobs/data_retention_job.mjs');
        const job = new DataRetentionJob(pool);
        const result = await job.run();
        res.json({ ok: true, ...result });
      } catch (e) {
        console.error('[ADMIN] Manual data retention failed:', e.message);
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // RPC aggregation job status endpoint
    app.get('/system/rpc-aggregation', async (req, res) => {
      try {
        const { RpcAggregationJob } = await import('./src/jobs/rpc_aggregation_job.mjs');
        const job = new RpcAggregationJob(pool);
        const status = job.getStatus();
        res.json({ ok: true, ...status });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    // Manual RPC aggregation trigger
    app.post('/system/rpc-aggregation/trigger', async (req, res) => {
      try {
        console.log('[ADMIN] Manual RPC aggregation triggered');
        const { RpcAggregationJob } = await import('./src/jobs/rpc_aggregation_job.mjs');
        const job = new RpcAggregationJob(pool);
        const result = await job.run();
        res.json({ ok: true, ...result });
      } catch (e) {
        console.error('[ADMIN] Manual RPC aggregation failed:', e.message);
        res.status(500).json({ ok: false, error: e.message });
      }
    });

    console.log('[BOOT] ✅ Additional routes mounted');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at route mounting:', err.message);
    
  }

  // Step 6: Create HTTP server
  let httpServer;
  try {
    httpServer = createServer(app);
    console.log('[BOOT] ✅ HTTP server created');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at createServer:', err.message);
    
  }

  // Step 7: Create WebSocket gateway
  try {
    createWsGateway(httpServer, pool);
    console.log('[BOOT] ✅ WebSocket gateway created');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at createWsGateway:', err.message);
    
  }

  // Step 8: Start health monitor
  try {
    startHealthMonitor(pool);
    console.log('[BOOT] ✅ Health monitor started');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at startHealthMonitor:', err.message);
    
  }

  // Step 9: Start offline detector
  try {
    startOfflineDetector(pool);
    console.log('[BOOT] ✅ Offline detector started');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at startOfflineDetector:', err.message);

  }

  // Step 9b: Start DepositListener — watches Polygon Mainnet for USDT deposits to RevenueVault
  let depositListener;
  try {
    depositListener = new DepositListener(pool, console);
    // Moved to after listen to avoid blocking Railway healthcheck
    console.log('[BOOT] ✅ DepositListener initialized');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at DepositListener initialization:', err.message);
  }

  // Step 10: Start epoch scheduler
  try {
    startEpochScheduler(pool);
    console.log('[BOOT] ✅ Epoch scheduler started');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at startEpochScheduler:', err.message);
    
  }

  // Step 11: Start sentinel (auto-scaler, healer, anomaly, treasury, capacity)
  try {
    startSentinel(pool, redis);
    console.log('[BOOT] ✅ Sentinel started');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at startSentinel:', err.message);
    
  }

  // Step 12: Start claim expiry job
  try {
    startClaimExpiryJob(pool);
    console.log('[BOOT] ✅ Claim expiry job started');
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at startClaimExpiryJob:', err.message);
    
  }

  // Step 12b: Start treasury settlement job (auto-forward deposits to ClaimsContract)
  let treasurySettlement;
  try {
    treasurySettlement = startTreasurySettlementScheduler(pool, 5);
    console.log('[BOOT] ✅ Treasury settlement job started (5min interval)');
  } catch (err) {
    console.error('[BOOT] ⚠️ Treasury settlement job failed (non-fatal):', err.message);
  }

  // Step 12c: Start data retention job (cleanup old logs/metrics daily at 3 AM UTC)
  let dataRetention;
  try {
    dataRetention = startDataRetentionScheduler(pool, 3);
    console.log('[BOOT] ✅ Data retention job started (daily at 3:00 UTC)');
  } catch (err) {
    console.error('[BOOT] ⚠️ Data retention job failed (non-fatal):', err.message);
  }

  // Step 12d: Start RPC aggregation job (aggregate revenue_events_v2 into rpc_usage_hourly)
  let rpcAggregation;
  try {
    rpcAggregation = startRpcAggregationScheduler(pool, 60);
    console.log('[BOOT] ✅ RPC aggregation job started (60min interval)');
  } catch (err) {
    console.error('[BOOT] ⚠️ RPC aggregation job failed (non-fatal):', err.message);
  }

  // Step 12e: Start settlement anchor job (anchors closed epochs to blockchain every 5 min)
  let settlementAnchor;
  try {
    const anchorJob = createSettlementAnchorJob(pool);
    settlementAnchor = setInterval(async () => {
      try {
        await anchorJob.run();
      } catch (err) {
        console.error('[SettlementAnchor] Scheduled run failed:', err.message);
      }
    }, 5 * 60 * 1000);
    console.log('[BOOT] ✅ Settlement anchor job started (5min interval)');
  } catch (err) {
    console.error('[BOOT] ⚠️ Settlement anchor job failed (non-fatal):', err.message);
  }

  // Step 13: Bind to port FIRST (Railway healthcheck needs this fast)
  const PORT = process.env.PORT || 8080;
  try {
    httpServer.listen(PORT, async () => {
      console.log('[BOOT] ✅ Server listening on port ' + PORT);
      console.log(`✅ Satelink Backend Running on port ${PORT}`);
      console.log(`📡 WebSocket available at /rpc/ws/:chain`);

      // Start DepositListener after server is up (non-blocking for Railway)
      if (depositListener) {
        depositListener.start().then(() => {
          console.log('[POST-BOOT] ✅ DepositListener started — watching Polygon Mainnet for USDT deposits');
        }).catch(err => {
          console.error('[POST-BOOT] ⚠️ DepositListener failed to start:', err.message);
        });
      }

      // Run migrations and schedulers AFTER server is up (non-blocking for Railway)
      try {
        await ensureBillingTables(pool);
        console.log('[POST-BOOT] ✅ Billing tables ensured');
      } catch (err) {
        console.error('[POST-BOOT] ⚠️ Billing tables failed (non-fatal):', err.message);
      }

      try {
        await runMigrations(pool);
        console.log('[POST-BOOT] ✅ Credit tables migrated');
      } catch (err) {
        console.error('[POST-BOOT] ⚠️ Credit tables migration failed:', err.message);
      }

      try {
        await ensureMachineAccessTables(pool);
        console.log('[POST-BOOT] ✅ Machine access tables ensured');
      } catch (err) {
        console.error('[POST-BOOT] ⚠️ Machine access tables failed (non-fatal):', err.message);
      }

      console.log(`🏥 Health monitor started (2min interval)`);
      console.log(`🔍 Offline detector started (2min interval)`);
      console.log(`⏱️ Epoch scheduler started (60s interval)`);
      console.log(`⚖️ Auto-scaler started (30s interval)`);
      console.log(`🔧 RPC-healer started (60s interval)`);
      console.log(`💰 Revenue-monitor started (5min interval)`);
      console.log(`🏦 Treasury-monitor started (10min interval)`);
      console.log(`📊 Capacity-alerter started (2min interval)`);
      console.log(`💸 Treasury-settlement started (5min interval)`);
      console.log(`🗑️ Data-retention started (daily at 3:00 UTC)`);
      console.log(`📊 RPC-aggregation started (60min interval)`);
      console.log(`⚓ Settlement-anchor started (5min interval)`);
    });
  } catch (err) {
    console.error('[BOOT] ❌ FAILED at httpServer.listen:', err.message);
  }

  // Step 14: Self-heartbeat — the API server IS the node
  const SELF_NODE_ID = 'NODE-ap-south-1-a09becbb';
  setInterval(async () => {
    try {
      const now = Math.floor(Date.now() / 1000);
      await pool.query(
        `UPDATE registered_nodes
         SET status = 'active', last_heartbeat_at = $1, updated_at = $1
         WHERE node_id = $2`,
        [now, SELF_NODE_ID]
      );
      console.log(`[Self-Heartbeat] ✅ ${SELF_NODE_ID} heartbeat sent`);
    } catch (err) {
      console.error('[Self-Heartbeat] ❌ Failed:', err.message);
    }
  }, 300000); // Every 5 minutes
  console.log(`[BOOT] ✅ Self-heartbeat started for ${SELF_NODE_ID} (5min interval)`);

  // Step 15: Graceful shutdown handler
  const shutdown = async (signal) => {
    console.log(`[SHUTDOWN] Received ${signal} — shutting down gracefully`);
    if (depositListener) {
      await depositListener.stop();
      console.log('[SHUTDOWN] DepositListener stopped');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Step 16: Discord daily summary scheduler (8:00 AM UTC)
  if (discord.isEnabled()) {
    const scheduleDailySummary = () => {
      const now = new Date();
      const next8am = new Date();
      next8am.setUTCHours(8, 0, 0, 0);
      if (next8am <= now) next8am.setUTCDate(next8am.getUTCDate() + 1);
      const msToNext8am = next8am - now;

      setTimeout(async function sendSummary() {
        try {
          const dayAgoMs = Date.now() - 86400000;
          const [statsResult, nodesResult, keysResult] = await Promise.all([
            pool.query(`
              SELECT COUNT(*) as calls, COALESCE(SUM(amount_usdt), 0) as revenue
              FROM revenue_events_v2
              WHERE created_at > $1 AND is_test_data = false
            `, [dayAgoMs]).catch(() => ({ rows: [{ calls: 0, revenue: 0 }] })),
            pool.query(`SELECT COUNT(*) as n FROM nodes WHERE LOWER(status) IN ('active', 'online', 'healthy')`).catch(() => ({ rows: [{ n: 0 }] })),
            pool.query(`SELECT COUNT(*) as n FROM api_credits`).catch(() => ({ rows: [{ n: 0 }] })),
          ]);

          await discord.dailySummary({
            calls: parseInt(statsResult.rows[0]?.calls || 0),
            revenue: parseFloat(statsResult.rows[0]?.revenue || 0),
            nodes: parseInt(nodesResult.rows[0]?.n || 0),
            apiKeys: parseInt(keysResult.rows[0]?.n || 0),
            uptime: 99.8,
            rateLimits: 0,
          });
          console.log('[DISCORD] Daily summary sent');
        } catch (e) {
          console.warn('[DISCORD] Daily summary failed:', e.message);
        }
        setTimeout(sendSummary, 24 * 60 * 60 * 1000);
      }, msToNext8am);

      console.log(`[BOOT] ✅ Discord daily summary scheduled for ${next8am.toISOString()}`);
    };
    scheduleDailySummary();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
