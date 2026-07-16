/**
 * Node Dispatcher
 * Routes RPC requests to registered Satelink network nodes
 *
 * This replaces the stub logic that only used external providers.
 * Now registered operators actually receive traffic and earn revenue.
 */

import { broadcaster } from '../../realtime/broadcaster-instance.js';
import { isDebug } from '../../utils/log_level.js';

const REQUEST_TIMEOUT_MS = 15000; // 15s to account for serverless cold starts
const HEARTBEAT_THRESHOLD_SECONDS = 300; // 5 minutes

// Method-specific pricing (USDT per call)
const METHOD_PRICING = {
  'eth_call': 0.00005,
  'eth_getLogs': 0.00008,
  'eth_sendRawTransaction': 0.0001,
  'eth_getTransactionReceipt': 0.00003,
  'eth_blockNumber': 0.00003,
  'eth_chainId': 0.00001,
  'eth_getBalance': 0.00003,
  'eth_gasPrice': 0.00002,
  'eth_estimateGas': 0.00005,
  'eth_getBlockByNumber': 0.00004,
  'eth_getTransactionByHash': 0.00003,
  'eth_getCode': 0.00003,
  'eth_getStorageAt': 0.00004,
  'eth_accounts': 0.00001,
  'net_version': 0.00001,
  'web3_clientVersion': 0.00001,
};

const DEFAULT_METHOD_PRICE = 0.00003;

/**
 * Selects the best available node for a given chain and request type.
 *
 * Selection criteria:
 * 1. Must be active (status = 'active')
 * 2. Must have recent heartbeat (within 5 min)
 * 3. Must support the requested chain_id
 * 4. Weighted by reputation score if available
 * 5. Fallback: round-robin by total_requests (least loaded first)
 */
export async function selectNode(pool, { chainId, nodeType = 'rpc', excludeIds = [] }) {
  if (!pool || !pool.query) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const heartbeatCutoff = nowSeconds - HEARTBEAT_THRESHOLD_SECONDS;

  try {
    // Query registered_nodes for eligible nodes
    // chain_ids is JSONB, so we check if chainId is in the array
    const { rows } = await pool.query(`
      SELECT
        node_id,
        endpoint_url,
        wallet,
        region,
        reputation_score,
        uptime_pct
      FROM registered_nodes
      WHERE status = 'active'
        AND last_heartbeat_at > $1
        AND $2 = ANY(
          SELECT jsonb_array_elements_text(chain_ids)::integer
        )
        AND node_type = $3
        AND node_id != ALL($4::text[])
      ORDER BY
        reputation_score DESC NULLS LAST,
        uptime_pct DESC NULLS LAST
      LIMIT 5
    `, [heartbeatCutoff, chainId, nodeType, excludeIds.length ? excludeIds : ['__none__']]);

    if (rows.length === 0) {
      return null;
    }

    // Weighted random selection from top 5 nodes
    // Higher reputation = higher probability of selection
    const totalWeight = rows.reduce((sum, n) => sum + (n.reputation_score || 1), 0);
    let rand = Math.random() * totalWeight;

    for (const node of rows) {
      rand -= (node.reputation_score || 1);
      if (rand <= 0) {
        return node;
      }
    }

    return rows[0];
  } catch (err) {
    console.error('[NodeDispatcher] selectNode error:', err.message);
    return null;
  }
}

/**
 * Alternative simpler query if JSONB array check doesn't work
 */
export async function selectNodeSimple(pool, { chainId, nodeType = 'rpc', excludeIds = [] }) {
  if (!pool || !pool.query) {
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const heartbeatCutoff = nowSeconds - HEARTBEAT_THRESHOLD_SECONDS;

  try {
    // Query active nodes with circuit breaker filter
    // Exclude public RPC redirects — only select real operator endpoints
    const { rows } = await pool.query(`
      SELECT
        node_id,
        endpoint_url,
        wallet,
        region,
        chain_ids,
        reputation_score,
        uptime_pct,
        consecutive_failures,
        total_requests_served,
        avg_latency_ms
      FROM registered_nodes
      WHERE status = 'active'
        AND last_heartbeat_at > $1
        AND node_type = $2
        AND consecutive_failures < 4
        AND endpoint_url NOT LIKE '%drpc.org%'
        AND endpoint_url NOT LIKE '%ankr.com%'
        AND endpoint_url NOT LIKE '%llamarpc.com%'
        AND endpoint_url NOT LIKE '%alchemy.com%'
        AND endpoint_url NOT LIKE '%infura.io%'
        AND endpoint_url NOT LIKE '%satelink.network%'
        AND endpoint_url NOT LIKE '%1rpc.io%'
      ORDER BY
        reputation_score DESC NULLS LAST,
        total_requests_served ASC NULLS LAST
      LIMIT 20
    `, [heartbeatCutoff, nodeType]);

    // Filter by chain_id in JS
    const eligible = rows.filter(node => {
      if (excludeIds.includes(node.node_id)) return false;
      const chains = Array.isArray(node.chain_ids) ? node.chain_ids : [];
      return chains.includes(chainId);
    });

    if (eligible.length === 0) {
      return null;
    }

    // Take top 5 and do weighted selection
    const top5 = eligible.slice(0, 5);
    const totalWeight = top5.reduce((sum, n) => sum + (n.reputation_score || 1), 0);
    let rand = Math.random() * totalWeight;

    for (const node of top5) {
      rand -= (node.reputation_score || 1);
      if (rand <= 0) {
        return node;
      }
    }

    return top5[0];
  } catch (err) {
    console.error('[NodeDispatcher] selectNodeSimple error:', err.message);
    return null;
  }
}

/**
 * Forwards RPC request to a network node
 */
export async function forwardToNode(node, rpcRequest) {
  const startTime = Date.now();

  try {
    const response = await fetch(node.endpoint_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, br' },
      body: JSON.stringify(rpcRequest),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const latencyMs = Date.now() - startTime;

    if (!response.ok) {
      throw new Error(`Node returned HTTP ${response.status}`);
    }

    const data = await response.json();

    // RPC-level errors (like "insufficient funds", "typed transaction too short") are VALID responses
    // The node successfully processed the request - the error is from the blockchain, not the node
    // Only network/HTTP errors should be treated as node failures
    return {
      success: true,
      data,
      latencyMs,
      nodeId: node.node_id
    };

  } catch (err) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      error: err.message,
      latencyMs,
      nodeId: node.node_id
    };
  }
}

/**
 * Records successful RPC call - attributes revenue to node
 */
export async function recordNodeSuccess(pool, { nodeId, latencyMs, chainId, method, apiKey, requestId, billedUsdt }) {
  const now = Math.floor(Date.now() / 1000);

  // Phase 6: only an ACTUAL deduction creates a revenue event. Node stats
  // (requests served, latency, reputation) still update for every served call —
  // serving free traffic is real work — but it produces NO revenue row.
  const billed = Number(billedUsdt);
  const isPaid = Number.isFinite(billed) && billed > 0;
  const usdtValue = isPaid ? billed : 0;

  try {
    // 1. Write to revenue_events_v2 WITH node_id attribution — paid traffic only
    if (isPaid) {
      await pool.query(`
        INSERT INTO revenue_events_v2
          (op_type, node_id, client_id, amount_usdt, status, request_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        `rpc_${method}`,
        nodeId,
        apiKey || 'public',
        usdtValue,
        'completed',
        requestId || `${nodeId}-${now}`,
        now
      ]);
    }

    // 2. Update node stats:
    //    - Increment total_requests_served
    //    - Reset consecutive_failures on success
    //    - Update avg_latency_ms using exponential moving average (alpha = 0.2)
    await pool.query(`
      UPDATE registered_nodes
      SET
        total_requests_served = total_requests_served + 1,
        consecutive_failures = 0,
        avg_latency_ms = CASE
          WHEN avg_latency_ms IS NULL THEN $1
          ELSE avg_latency_ms * 0.8 + $1 * 0.2
        END,
        updated_at = $2
      WHERE node_id = $3
    `, [latencyMs, now, nodeId]);

    // 3. Broadcast revenue event — paid traffic only
    if (isPaid) {
      broadcaster.publish('revenue:event', {
        amount_usdt: usdtValue,
        method,
        chain_id: chainId,
        node_id: nodeId,
        latency_ms: latencyMs,
        timestamp: new Date().toISOString()
      });
    }

    if (isDebug) console.log(`[NodeDispatcher] ✓ ${nodeId} served ${method} (${isPaid ? '$' + usdtValue : 'free'}) ${latencyMs}ms`);

  } catch (err) {
    console.error('[NodeDispatcher] recordNodeSuccess error:', err.message);
  }
}

/**
 * Records node failure - for circuit breaker tracking
 */
export async function recordNodeFailure(pool, nodeId, reason) {
  const now = Math.floor(Date.now() / 1000);

  try {
    // Increment consecutive_failures for circuit breaker
    // After 4 consecutive failures, node is excluded from selection
    await pool.query(`
      UPDATE registered_nodes
      SET
        consecutive_failures = consecutive_failures + 1,
        last_failure_at = $1,
        last_failure_reason = $2,
        updated_at = $1
      WHERE node_id = $3
    `, [now, reason.slice(0, 255), nodeId]);

    console.warn(`[NodeDispatcher] ✗ ${nodeId} failed: ${reason}`);

  } catch (err) {
    console.error('[NodeDispatcher] recordNodeFailure error:', err.message);
  }
}

/**
 * Get count of online nodes for a chain
 */
export async function getOnlineNodeCount(pool, chainId, nodeType = 'rpc') {
  if (!pool || !pool.query) return 0;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const heartbeatCutoff = nowSeconds - HEARTBEAT_THRESHOLD_SECONDS;

  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as count
      FROM registered_nodes
      WHERE status = 'active'
        AND last_heartbeat_at > $1
        AND node_type = $2
    `, [heartbeatCutoff, nodeType]);

    return parseInt(rows[0]?.count) || 0;
  } catch (err) {
    console.error('[NodeDispatcher] getOnlineNodeCount error:', err.message);
    return 0;
  }
}

export { METHOD_PRICING, DEFAULT_METHOD_PRICE };
