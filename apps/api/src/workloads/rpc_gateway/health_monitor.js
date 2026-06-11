/**
 * Health Monitor
 * S1-RPC-008: Provider health monitoring + alerting
 *
 * Features:
 * - Check all providers every 60 seconds
 * - Track success rate, avg latency, error count
 * - Discord webhook alerts for failures
 * - GET /rpc/health endpoint
 */

import { PROVIDER_CONFIGS } from './providers.js';

const HEALTH_CHECK_INTERVAL = 60_000;
const ALERT_THRESHOLD_ERROR_RATE = 0.3;
const ALERT_THRESHOLD_LATENCY_MS = 5000;
const ALERT_COOLDOWN_MS = 300_000;

const providerHealth = new Map();
const lastAlertTime = new Map();

// Chain-aware health check definitions, grouped by chain family.
// To support a new chain family, add an entry here with the chains it
// covers, the JSON-RPC payload to send, and a validator for the response.
const CHAIN_HEALTH_CHECKS = {
  evm: {
    chains: ['ethereum', 'polygon', 'polygon-amoy', 'arbitrum', 'base'],
    buildPayload: () => ({
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1
    }),
    validate: (data) => {
      if (!data || typeof data !== 'object') {
        return { valid: false, reason: 'Response is not a JSON object' };
      }
      if (data.result === undefined || data.result === null) {
        return { valid: false, reason: data.error?.message || 'Missing result field' };
      }
      return { valid: true };
    }
  },
  solana: {
    chains: ['solana'],
    buildPayload: () => ({
      jsonrpc: '2.0',
      method: 'getBlockHeight',
      params: [],
      id: 1
    }),
    validate: (data) => {
      if (!data || typeof data !== 'object') {
        return { valid: false, reason: 'Response is not a JSON object' };
      }
      if (typeof data.result !== 'number') {
        return { valid: false, reason: data.error?.message || 'result is not a number' };
      }
      return { valid: true };
    }
  }
};

// Chains not listed in any family above fall back to the EVM check —
// preserves current behavior for any chain added to PROVIDER_CONFIGS
// without a matching health-check entry.
const DEFAULT_CHAIN_FAMILY = 'evm';

const CHAIN_TO_FAMILY = Object.entries(CHAIN_HEALTH_CHECKS).reduce((map, [family, cfg]) => {
  for (const chain of cfg.chains) map[chain] = family;
  return map;
}, {});

function getChainFamily(chain) {
  return CHAIN_TO_FAMILY[chain] || DEFAULT_CHAIN_FAMILY;
}

export function buildHealthCheckPayload(chain) {
  const family = getChainFamily(chain);
  return CHAIN_HEALTH_CHECKS[family].buildPayload();
}

export function validateHealthResponse(chain, data) {
  const family = getChainFamily(chain);
  return CHAIN_HEALTH_CHECKS[family].validate(data);
}

function initializeHealthState() {
  for (const chain of Object.keys(PROVIDER_CONFIGS)) {
    for (const provider of PROVIDER_CONFIGS[chain].providers) {
      const key = `${chain}:${provider.id}`;
      providerHealth.set(key, {
        chain,
        provider: provider.id,
        url: provider.url,
        checks: 0,
        successes: 0,
        failures: 0,
        totalLatency: 0,
        lastCheck: null,
        lastError: null,
        status: 'unknown'
      });
    }
  }
}

async function checkProvider(chain, provider) {
  const key = `${chain}:${provider.id}`;
  const health = providerHealth.get(key);

  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildHealthCheckPayload(chain)),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const latency = Date.now() - startTime;
    const data = await response.json();

    const validation = validateHealthResponse(chain, data);
    if (!validation.valid) {
      console.error(`[Health Monitor] Validation failed for ${key}: ${validation.reason}`);
      throw new Error(data.error?.message || validation.reason);
    }

    health.checks++;
    health.successes++;
    health.totalLatency += latency;
    health.lastCheck = new Date().toISOString();
    health.lastError = null;
    health.status = 'healthy';
    return { success: true, latency };
  } catch (err) {
    const latency = Date.now() - startTime;
    health.checks++;
    health.failures++;
    health.totalLatency += latency;
    health.lastCheck = new Date().toISOString();
    health.lastError = err.message;
    health.status = 'unhealthy';
    console.error(`[Health Monitor] Check failed: chain=${chain} provider=${provider.id} error=${err.message}`);
    return { success: false, latency, error: err.message };
  }
}

async function sendDiscordAlert(message) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Satelink RPC Monitor',
        embeds: [{
          title: '🚨 RPC Provider Alert',
          description: message,
          color: 0xff0000,
          timestamp: new Date().toISOString()
        }]
      })
    });
  } catch (err) {
    console.error('[Health Monitor] Discord alert failed:', err.message);
  }
}

function shouldAlert(key) {
  const lastAlert = lastAlertTime.get(key) || 0;
  return Date.now() - lastAlert > ALERT_COOLDOWN_MS;
}

async function runHealthChecks() {
  console.log('[Health Monitor] Starting health check cycle');

  const results = [];

  for (const chain of Object.keys(PROVIDER_CONFIGS)) {
    for (const provider of PROVIDER_CONFIGS[chain].providers) {
      const key = `${chain}:${provider.id}`;
      const result = await checkProvider(chain, provider);
      results.push({ key, ...result });

      const health = providerHealth.get(key);
      const errorRate = health.checks > 0 ? health.failures / health.checks : 0;
      const avgLatency = health.checks > 0 ? health.totalLatency / health.checks : 0;

      if (errorRate > ALERT_THRESHOLD_ERROR_RATE && shouldAlert(key)) {
        lastAlertTime.set(key, Date.now());
        await sendDiscordAlert(
          `**${provider.id}** (${chain}) has ${(errorRate * 100).toFixed(1)}% error rate\n` +
          `Last error: ${health.lastError}`
        );
      }

      if (avgLatency > ALERT_THRESHOLD_LATENCY_MS && shouldAlert(`${key}:latency`)) {
        lastAlertTime.set(`${key}:latency`, Date.now());
        await sendDiscordAlert(
          `**${provider.id}** (${chain}) high latency: ${avgLatency.toFixed(0)}ms avg`
        );
      }
    }
  }

  const healthy = results.filter(r => r.success).length;
  const total = results.length;
  console.log(`[Health Monitor] Cycle complete: ${healthy}/${total} healthy`);
}

let healthCheckInterval = null;

export function startHealthMonitor() {
  if (healthCheckInterval) return;

  initializeHealthState();
  console.log('[Health Monitor] Starting with 60s interval');

  runHealthChecks();
  healthCheckInterval = setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL);
}

export function stopHealthMonitor() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    console.log('[Health Monitor] Stopped');
  }
}

export function getHealthStatus() {
  const providers = [];

  for (const [key, health] of providerHealth.entries()) {
    const errorRate = health.checks > 0 ? health.failures / health.checks : 0;
    const avgLatency = health.checks > 0 ? Math.round(health.totalLatency / health.checks) : 0;

    providers.push({
      chain: health.chain,
      provider: health.provider,
      status: health.status,
      checks: health.checks,
      successRate: health.checks > 0 ? ((health.successes / health.checks) * 100).toFixed(1) + '%' : 'N/A',
      avgLatencyMs: avgLatency,
      lastCheck: health.lastCheck,
      lastError: health.lastError
    });
  }

  const healthy = providers.filter(p => p.status === 'healthy').length;
  const total = providers.length;

  return {
    timestamp: new Date().toISOString(),
    summary: {
      healthy,
      unhealthy: total - healthy,
      total,
      healthPercent: total > 0 ? ((healthy / total) * 100).toFixed(1) + '%' : 'N/A'
    },
    providers
  };
}

export function createHealthEndpoint(router) {
  router.get('/health', (req, res) => {
    const status = getHealthStatus();
    const httpStatus = status.summary.healthy > 0 ? 200 : 503;
    res.status(httpStatus).json(status);
  });
}
