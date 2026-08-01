/**
 * RPC Billing Helper
 * Records revenue to PostgreSQL + Redis counters
 *
 * Schema (from docker/init/init.sql):
 *   revenue_events_v2(id, epoch_id, op_type, node_id, client_id,
 *                     amount_usdt, status, request_id, created_at, ...)
 */

import { getSharedRedis } from './shared_redis.js';
import { broadcaster } from '../../realtime/broadcaster-instance.js';
import { isFounderApiKey } from '../../payments/founder_wallets.js';
import { shadowWriteRevenueLedger } from '../../ledger/shadow_ledger_write.js';

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

const DEFAULT_RPC_COST_USDT = 0.00003;

// Use shared Redis client to avoid connection pool exhaustion
function getRedis() {
  return getSharedRedis();
}

export async function recordRpcRevenue({ pool, chain, method, apiKey, source, requestId, amountUsdt }) {
  // Customer Zero Phase 6 — phantom-billing elimination:
  // A revenue event is created ONLY for traffic that produced an ACTUAL credit
  // deduction. `amountUsdt` is the real amount deducted by creditService on the
  // canonical path. Free-tier (cost 0), anonymous, and exhausted (402, never
  // reaches here) traffic pass amountUsdt <= 0 → NO revenue event, NO revenue
  // counter. This guarantees settlement totals == collected credits.
  const billed = Number(amountUsdt);
  if (!Number.isFinite(billed) || billed <= 0) {
    return { recorded: false, reason: 'no_deduction' };
  }
  const costUsdt = billed; // record the ACTUAL deducted amount, not list price
  const clientId = apiKey || 'public';
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().split('T')[0];

  const redis = getRedis();

  // 0. Redis-based dedup — skip if already billed this requestId
  if (redis && requestId) {
    const dedupKey = `billing:dedup:${requestId}`;
    try {
      const alreadyBilled = await redis.get(dedupKey);
      if (alreadyBilled) {
        return;
      }
      await redis.set(dedupKey, '1', 'EX', 60);
    } catch (err) {
      // Continue even if dedup check fails
    }
  }

  // 1. Increment Redis counters (for real-time metrics)
  if (redis) {
    try {
      await Promise.all([
        redis.incr(`rpc:requests:${today}`),
        redis.incrbyfloat(`rpc:revenue:${today}`, costUsdt)
      ]);
    } catch (err) {
      console.error('[Billing] Redis error:', err.message);
    }
  }

  // 2. Insert into PostgreSQL
  if (!pool || !pool.query) {
    console.error('[Billing] CRITICAL: pool is undefined!');
    return;
  }

  try {
    const isTestData = await isFounderApiKey(pool, apiKey);
    const revRequestId = requestId || String(Date.now());
    await pool.query(
      `INSERT INTO revenue_events_v2 (op_type, client_id, amount_usdt, status, request_id, created_at, chain, method, source, is_test_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      ['rpc_call', apiKey || 'public', costUsdt, 'completed', revRequestId, Math.floor(Date.now() / 1000), chain || null, method || null, source || null, isTestData]
    );
    // M3 shadow ledger — flag-gated (LEDGER_SHADOW_WRITE, default OFF), isolated
    // pool, never throws. Same request_id so the shadow txn parity-matches this row.
    shadowWriteRevenueLedger(pool, { requestId: revRequestId, amountUsdt: costUsdt, isTestData });
    console.log(`[Billing] ✓ $${costUsdt}`);

    broadcaster.publish('revenue:event', {
      amount_usdt: costUsdt,
      method: method || 'rpc_call',
      chain: chain || 'unknown',
      epoch_id: null,
      client_id: clientId,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Billing] INSERT failed:', err.message);
  }
}

export function getDefaultCost(chain) {
  return CHAIN_PRICING_USDT[chain] || DEFAULT_RPC_COST_USDT;
}
