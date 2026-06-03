/**
 * Latency-Based RPC Router
 * S1-RPC-002: Latency-based provider routing with Redis EMA tracking
 * S1-RPC-003: 3-state circuit breaker with Redis persistence
 * S1-RPC-005: Weighted load balancing across providers
 * S2-NODE: Network node routing with revenue attribution
 */

import { getProviders, getChainConfig, CHAIN_ALIASES } from "./providers.js";
import {
  isOpen,
  recordSuccess,
  recordFailure,
  getCircuitStats,
} from "./circuit_breaker.js";
import {
  selectWeightedProvider,
  incrementRequestCount,
  getRequestCounts,
  getWeightsForProviders,
} from "./load_balancer.js";
import {
  selectNodeSimple,
  forwardToNode,
  recordNodeSuccess,
  recordNodeFailure,
} from "./node_dispatcher.js";
import { getSharedRedis } from "./shared_redis.js";

// Database pool reference - set by initRouterWithPool()
let pgPool = null;

export function initRouterWithPool(pool) {
  pgPool = pool;
  console.log('[RPC Router] Initialized with database pool for node routing');
}

const EMA_ALPHA = 0.2;
const REQUEST_TIMEOUT_MS = 10000;

// Use shared Redis client to avoid connection pool exhaustion
async function getRedis() {
  return getSharedRedis();
}

function getLatencyKey(chain, providerId) {
  const normalized = CHAIN_ALIASES[chain] || chain;
  return `rpc:latency:${normalized}:${providerId}`;
}

async function getProviderLatencies(chain, providers) {
  const redis = await getRedis();
  if (!redis) {
    return providers.map((p) => ({ ...p, latency: null }));
  }

  const keys = providers.map((p) => getLatencyKey(chain, p.id));

  try {
    const mgetPromise = redis.mget(...keys);
    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve(keys.map(() => null)), 300)
    );
    const values = await Promise.race([mgetPromise, timeoutPromise]);

    return providers.map((p, i) => ({
      ...p,
      latency: values[i] ? parseFloat(values[i]) : null,
    }));
  } catch (err) {
    console.error("[RPC Router] Failed to get latencies:", err.message);
    return providers.map((p) => ({ ...p, latency: null }));
  }
}

async function updateLatency(chain, providerId, newLatency) {
  const redis = await getRedis();
  if (!redis) return;

  const key = getLatencyKey(chain, providerId);

  try {
    const oldValue = await redis.get(key);
    let ema;

    if (oldValue) {
      const oldLatency = parseFloat(oldValue);
      ema = EMA_ALPHA * newLatency + (1 - EMA_ALPHA) * oldLatency;
    } else {
      ema = newLatency;
    }

    await redis.set(key, ema.toFixed(2), "EX", 3600);
  } catch (err) {
    console.error("[RPC Router] Failed to update latency:", err.message);
  }
}

function sortProvidersByLatency(providersWithLatency) {
  return [...providersWithLatency].sort((a, b) => {
    if (a.latency === null && b.latency === null) {
      return a.priority - b.priority;
    }
    if (a.latency === null) return 1;
    if (b.latency === null) return -1;
    return a.latency - b.latency;
  });
}

async function executeRpcCall(providerUrl, method, params, id) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const startTime = Date.now();

  try {
    const response = await fetch(providerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params: params || [],
        id: id || 1,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latency = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error.message || "RPC error");
    }

    return { success: true, result, latency };
  } catch (err) {
    clearTimeout(timeout);
    const latency = Date.now() - startTime;
    return { success: false, error: err.message, latency };
  }
}

// Emergency fallback providers - ALWAYS available, no API key required
const EMERGENCY_FALLBACKS = {
  polygon: 'https://polygon.drpc.org',
  ethereum: 'https://eth.llamarpc.com',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
  base: 'https://mainnet.base.org',
  'polygon-amoy': 'https://rpc-amoy.polygon.technology'
};

export async function routeRpcRequest(chain, method, params, id, options = {}) {
  const { apiKey, requestId } = options;

  const chainConfig = getChainConfig(chain);
  if (!chainConfig) {
    return { success: false, error: `Unsupported chain: ${chain}` };
  }

  const chainId = chainConfig.chainId;

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Try registered Satelink network nodes first
  // This is where operators earn revenue!
  // WRAPPED IN TRY/CATCH — dispatcher errors must NEVER prevent fallback
  // ═══════════════════════════════════════════════════════════════════════════
  if (pgPool) {
    try {
      const excludedNodes = [];
      const maxNodeAttempts = 2;

      for (let attempt = 0; attempt < maxNodeAttempts; attempt++) {
        const node = await selectNodeSimple(pgPool, {
          chainId,
          nodeType: 'rpc',
          excludeIds: excludedNodes
        });

        if (node) {
          console.log(`[RPC Router] Trying network node: ${node.node_id} (${node.region})`);

          const result = await forwardToNode(node, {
            jsonrpc: '2.0',
            method,
            params: params || [],
            id: id || 1
          });

          if (result.success) {
            // Fire-and-forget: record revenue attribution to node
            setImmediate(() => {
              recordNodeSuccess(pgPool, {
                nodeId: node.node_id,
                latencyMs: result.latencyMs,
                chainId,
                method,
                apiKey,
                requestId
              }).catch(() => {});
            });

            console.log(`[RPC Router] ✓ Network node ${node.node_id} served ${method} (${result.latencyMs}ms)`);

            return {
              success: true,
              result: result.data,
              provider: `node:${node.node_id}`,
              latency: result.latencyMs,
              source: 'network_node'
            };
          }

          // Node failed - record failure and try another
          console.warn(`[RPC Router] ✗ Node ${node.node_id} failed: ${result.error}`);
          setImmediate(() => {
            recordNodeFailure(pgPool, node.node_id, result.error).catch(() => {});
          });
          excludedNodes.push(node.node_id);
        } else {
          // No more nodes available
          break;
        }
      }

      console.log('[RPC Router] No network nodes available, falling back to external providers');
    } catch (dispatcherErr) {
      // Dispatcher error must NOT kill the request — fall through to providers
      console.error('[RPC Router] Dispatcher error, falling back:', dispatcherErr.message);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Fallback to external providers (no node revenue attribution)
  // ═══════════════════════════════════════════════════════════════════════════
  const providers = getProviders(chain);
  if (providers.length === 0) {
    return { success: false, error: `No providers for chain: ${chain}` };
  }

  const providersWithLatency = await getProviderLatencies(chain, providers);

  // Circuit breaker checks with timeout - fail open (allow through) if slow
  const availableProviders = [];
  const circuitCheckPromises = providersWithLatency.map(async (p) => {
    try {
      const checkPromise = isOpen(chain, p.id);
      const timeoutPromise = new Promise((resolve) =>
        setTimeout(() => resolve(false), 200)
      );
      const circuitOpen = await Promise.race([checkPromise, timeoutPromise]);
      return { provider: p, open: circuitOpen };
    } catch {
      return { provider: p, open: false };
    }
  });

  const circuitResults = await Promise.all(circuitCheckPromises);
  for (const { provider, open } of circuitResults) {
    if (!open) {
      availableProviders.push(provider);
    }
  }

  if (availableProviders.length === 0) {
    console.warn(
      "[RPC Router] All providers circuit-broken, trying first anyway",
    );
    availableProviders.push(providersWithLatency[0]);
  }

  const attemptedProviders = [];
  let remainingProviders = [...availableProviders];

  while (remainingProviders.length > 0) {
    const provider = selectWeightedProvider(remainingProviders);

    // 🔥 NEW DEBUG LOG (BEFORE CALL)
    console.log(`[RPC Router DEBUG] Trying → ${chain} → ${provider.id}`);

    attemptedProviders.push(provider.id);

    const { success, result, error, latency } = await executeRpcCall(
      provider.url,
      method,
      params,
      id,
    );

    if (success) {
      // Post-success operations - fire and forget (non-blocking)
      recordSuccess(chain, provider.id).catch(() => {});
      updateLatency(chain, provider.id, latency).catch(() => {});
      incrementRequestCount(chain, provider.id).catch(() => {});

      console.log(
        `[RPC Router] ${chain} → ${provider.id} (${latency}ms) [weighted]`,
      );

      return {
        success: true,
        result,
        provider: provider.id,
        latency,
      };
    }

    console.warn(`[RPC Router] ${provider.id} failed: ${error} (${latency}ms)`);
    recordFailure(chain, provider.id).catch(() => {});

    remainingProviders = remainingProviders.filter((p) => p.id !== provider.id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: Emergency fallback — last resort before total failure
  // ═══════════════════════════════════════════════════════════════════════════
  const normalizedChain = CHAIN_ALIASES[chain] || chain;
  const emergencyUrl = EMERGENCY_FALLBACKS[normalizedChain];

  if (emergencyUrl) {
    console.warn(`[RPC Router] Trying emergency fallback: ${emergencyUrl}`);

    const { success, result, error, latency } = await executeRpcCall(
      emergencyUrl,
      method,
      params,
      id
    );

    if (success) {
      console.log(`[RPC Router] ✓ Emergency fallback succeeded (${latency}ms)`);
      return {
        success: true,
        result,
        provider: 'emergency-fallback',
        latency,
        source: 'emergency_fallback'
      };
    }

    console.error(`[RPC Router] Emergency fallback also failed: ${error}`);
    attemptedProviders.push('emergency-fallback');
  }

  return {
    success: false,
    error: "All providers failed",
    attemptedProviders,
  };
}

export async function getNodeRoutingStatus() {
  const hasPool = pgPool !== null && typeof pgPool.query === 'function';
  let nodeCount = 0;
  let eligibleNodes = [];

  if (hasPool) {
    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const heartbeatCutoff = nowSeconds - 300;
      const { rows } = await pgPool.query(`
        SELECT node_id, endpoint_url, chain_ids, status, last_heartbeat_at, consecutive_failures
        FROM registered_nodes
        WHERE status = 'active'
          AND last_heartbeat_at > $1
          AND node_type = 'rpc'
          AND consecutive_failures < 4
        LIMIT 10
      `, [heartbeatCutoff]);
      nodeCount = rows.length;
      eligibleNodes = rows.map(r => ({
        node_id: r.node_id,
        endpoint_url: r.endpoint_url ? (r.endpoint_url.slice(0, 30) + '...') : 'null',
        chain_ids: r.chain_ids,
        consecutive_failures: r.consecutive_failures
      }));
    } catch (e) {
      return { hasPool, error: e.message };
    }
  }

  return {
    hasPool,
    nodeCount,
    eligibleNodes,
    heartbeatThresholdSeconds: 300
  };
}

export async function getRouterStats(chain) {
  const providers = getProviders(chain);
  const providersWithLatency = await getProviderLatencies(chain, providers);
  const weights = getWeightsForProviders(providersWithLatency);
  const requestCounts = await getRequestCounts(
    chain,
    providers.map((p) => p.id),
  );

  const stats = [];
  for (let i = 0; i < providersWithLatency.length; i++) {
    const p = providersWithLatency[i];
    const circuit = await getCircuitStats(chain, p.id);
    const weightInfo = weights.find((w) => w.id === p.id);

    stats.push({
      id: p.id,
      type: p.type,
      latency: p.latency,
      weight: weightInfo?.weight || 0,
      requests: requestCounts[i],
      circuit: {
        state: circuit.state,
        failures: circuit.failures,
        timeUntilReset: circuit.timeUntilReset,
      },
    });
  }

  return stats;
}

export { getRedis };
