/**
 * Metrics Dashboard Endpoint
 * S1-RPC-009: Comprehensive metrics + Prometheus format
 *
 * GET /metrics — JSON network performance snapshot
 * GET /metrics/prometheus — Prometheus text format
 *
 * M7 (T-30): mounted at the top level in app_factory.mjs, ungated — moved
 * out from behind freeTierGate (was /rpc/metrics; see rpc_gateway.js).
 */

import { Router } from 'express';
import { getSharedRedis } from './shared_redis.js';
import { getSupportedChains, getProviders, PROVIDER_CONFIGS } from './providers.js';
import { getCacheStats } from './cache.js';
import { getCircuitStats, STATE } from './circuit_breaker.js';
import { getHealthStatus } from './health_monitor.js';
import { getWsStats } from './ws_gateway.js';

const startTime = Date.now();

// Use shared Redis client to avoid connection pool exhaustion
function getRedis() {
  return getSharedRedis();
}

async function getRedisCounter(key) {
  const client = getRedis();
  if (!client) return 0;

  try {
    const val = await client.get(key);
    return parseInt(val, 10) || 0;
  } catch (err) {
    return 0;
  }
}

async function getTodayCounters() {
  const today = new Date().toISOString().split('T')[0];
  const client = getRedis();

  if (!client) {
    return { requests: 0, cacheHits: 0 };
  }

  try {
    const [requests, cacheHits] = await client.mget(
      `rpc:requests:${today}`,
      `rpc:cache_hits:${today}`
    );

    return {
      requests: parseInt(requests, 10) || 0,
      cacheHits: parseInt(cacheHits, 10) || 0
    };
  } catch (err) {
    return { requests: 0, cacheHits: 0 };
  }
}

async function getRevenueStats(db) {
  if (!db || !db.query) {
    return { eventsToday: 0, usdtToday: 0, activeEpoch: null };
  }

  try {
    const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

    const result = await db.query(
      `SELECT
         COUNT(*) as events_today,
         COALESCE(SUM(amount_usdt), 0) as usdt_today
       FROM revenue_events_v2
       WHERE created_at > $1`,
      [oneDayAgo]
    );

    const epochRow = await db.query(
      "SELECT id FROM epoch_ledger WHERE status='OPEN' ORDER BY id DESC LIMIT 1"
    );
    const activeEpoch = epochRow.rows[0]?.id || null;

    return {
      eventsToday: parseInt(result.rows[0]?.events_today, 10) || 0,
      usdtToday: parseFloat(result.rows[0]?.usdt_today) || 0,
      activeEpoch
    };
  } catch (err) {
    console.error('[Metrics] Revenue query failed:', err.message);
    return { eventsToday: 0, usdtToday: 0, activeEpoch: null };
  }
}

async function getChainMetrics(chain) {
  const providers = getProviders(chain);
  const healthStatus = getHealthStatus();

  let healthy = 0;
  let degraded = 0;
  let circuitClosed = 0;
  let circuitOpen = 0;
  let circuitHalfOpen = 0;
  let bestLatency = Infinity;
  let totalLatency = 0;
  let latencyCount = 0;

  for (const provider of providers) {
    const circuit = await getCircuitStats(chain, provider.id);

    if (circuit.state === STATE.CLOSED) {
      circuitClosed++;
      healthy++;
    } else if (circuit.state === STATE.OPEN) {
      circuitOpen++;
      degraded++;
    } else if (circuit.state === STATE.HALF_OPEN) {
      circuitHalfOpen++;
      degraded++;
    }

    const healthProvider = healthStatus.providers.find(
      p => p.chain === chain && p.provider === provider.id
    );

    if (healthProvider && healthProvider.avgLatencyMs > 0) {
      const lat = healthProvider.avgLatencyMs;
      totalLatency += lat;
      latencyCount++;
      if (lat < bestLatency) bestLatency = lat;
    }
  }

  const cacheStats = getCacheStats();

  return {
    providers: {
      total: providers.length,
      healthy,
      degraded
    },
    performance: {
      bestLatencyMs: bestLatency === Infinity ? 0 : Math.round(bestLatency),
      avgLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      cacheHitRate: `${cacheStats.hitRate}%`
    },
    circuitBreakers: {
      closed: circuitClosed,
      open: circuitOpen,
      halfOpen: circuitHalfOpen
    }
  };
}

export function createMetricsRouter(db) {
  const router = Router();

  router.get('/metrics', async (req, res) => {
    try {
      const chains = getSupportedChains();
      const chainMetrics = {};

      for (const chain of chains) {
        chainMetrics[chain] = await getChainMetrics(chain);
      }

      const revenue = await getRevenueStats(db);
      const todayCounters = await getTodayCounters();
      const wsStats = getWsStats();
      const cacheStats = getCacheStats();

      const metrics = {
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        chains: chainMetrics,
        revenue: {
          eventsToday: revenue.eventsToday,
          usdtToday: revenue.usdtToday.toFixed(6),
          activeEpoch: revenue.activeEpoch
        },
        rpcGateway: {
          totalRequestsToday: todayCounters.requests,
          cacheHitsToday: todayCounters.cacheHits,
          cacheStats: {
            hits: cacheStats.hits,
            misses: cacheStats.misses,
            hitRate: `${cacheStats.hitRate}%`
          },
          wsConnectionsActive: wsStats.activeConnections
        }
      };

      res.json(metrics);
    } catch (err) {
      console.error('[Metrics] Error:', err.message);
      res.status(500).json({ error: 'Failed to gather metrics' });
    }
  });

  router.get('/metrics/prometheus', async (req, res) => {
    try {
      const lines = [];
      const chains = getSupportedChains();
      const revenue = await getRevenueStats(db);
      const todayCounters = await getTodayCounters();
      const cacheStats = getCacheStats();
      const wsStats = getWsStats();

      lines.push('# HELP satelink_uptime_seconds Server uptime in seconds');
      lines.push('# TYPE satelink_uptime_seconds gauge');
      lines.push(`satelink_uptime_seconds ${Math.floor((Date.now() - startTime) / 1000)}`);

      lines.push('# HELP satelink_rpc_requests_total Total RPC requests today');
      lines.push('# TYPE satelink_rpc_requests_total counter');
      lines.push(`satelink_rpc_requests_total ${todayCounters.requests}`);

      lines.push('# HELP satelink_rpc_cache_hits_total Cache hits today');
      lines.push('# TYPE satelink_rpc_cache_hits_total counter');
      lines.push(`satelink_rpc_cache_hits_total ${todayCounters.cacheHits}`);

      lines.push('# HELP satelink_rpc_cache_hit_rate Cache hit rate');
      lines.push('# TYPE satelink_rpc_cache_hit_rate gauge');
      lines.push(`satelink_rpc_cache_hit_rate ${parseFloat(cacheStats.hitRate) / 100}`);

      lines.push('# HELP satelink_revenue_usdt_today Revenue in USDT today');
      lines.push('# TYPE satelink_revenue_usdt_today gauge');
      lines.push(`satelink_revenue_usdt_today ${revenue.usdtToday}`);

      lines.push('# HELP satelink_revenue_events_today Revenue events today');
      lines.push('# TYPE satelink_revenue_events_today counter');
      lines.push(`satelink_revenue_events_today ${revenue.eventsToday}`);

      lines.push('# HELP satelink_active_epoch Current active epoch ID');
      lines.push('# TYPE satelink_active_epoch gauge');
      lines.push(`satelink_active_epoch ${revenue.activeEpoch || 0}`);

      lines.push('# HELP satelink_ws_connections_active Active WebSocket connections');
      lines.push('# TYPE satelink_ws_connections_active gauge');
      lines.push(`satelink_ws_connections_active ${wsStats.activeConnections}`);

      lines.push('# HELP satelink_providers_total Total providers per chain');
      lines.push('# TYPE satelink_providers_total gauge');

      lines.push('# HELP satelink_providers_healthy Healthy providers per chain');
      lines.push('# TYPE satelink_providers_healthy gauge');

      lines.push('# HELP satelink_circuit_breaker_open Open circuit breakers per chain');
      lines.push('# TYPE satelink_circuit_breaker_open gauge');

      lines.push('# HELP satelink_latency_ms Average latency in ms per chain');
      lines.push('# TYPE satelink_latency_ms gauge');

      for (const chain of chains) {
        const metrics = await getChainMetrics(chain);

        lines.push(`satelink_providers_total{chain="${chain}"} ${metrics.providers.total}`);
        lines.push(`satelink_providers_healthy{chain="${chain}"} ${metrics.providers.healthy}`);
        lines.push(`satelink_circuit_breaker_open{chain="${chain}"} ${metrics.circuitBreakers.open}`);
        lines.push(`satelink_latency_ms{chain="${chain}"} ${metrics.performance.avgLatencyMs}`);
      }

      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(lines.join('\n') + '\n');
    } catch (err) {
      console.error('[Metrics] Prometheus error:', err.message);
      res.status(500).send('# Error generating metrics\n');
    }
  });

  return router;
}
