/**
 * RpcAggregationJob — Hourly rollup of raw revenue_events_v2 into rpc_usage_hourly
 *
 * Runs every 60 minutes:
 * 1. Reads revenue_events_v2 rows older than 1 hour
 * 2. Aggregates by hour/client/method/chain into rpc_usage_hourly
 * 3. Deletes aggregated raw rows
 * 4. Enforces 24-hour max retention on revenue_events_v2
 *
 * WARNING: this job DELETES from revenue_events_v2, which is a financial ledger.
 * It is intentionally NOT scheduled anywhere. The delete steps below are guarded
 * by PRUNE_FINANCIAL_LEDGER so they no-op by default; do not enable pruning of
 * the revenue ledger without an archival/rollup-preserving redesign.
 */

import { isFinancialTable } from '../utils/financial_tables_guard.js';

// Hard off-switch: revenue_events_v2 is financial; never delete it during aggregation.
const PRUNE_FINANCIAL_LEDGER = false;

const AGGREGATION_DELAY_MS = 60 * 60 * 1000; // 1 hour - only aggregate rows older than this
const MAX_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours - hard delete cutoff

export class RpcAggregationJob {
  constructor(pool) {
    this.pool = pool;
    this.running = false;
    this.lastRun = null;
    this.lastResult = null;
  }

  async run() {
    if (this.running) {
      console.log('[RpcAggregation] Already running, skipping');
      return { skipped: true };
    }

    this.running = true;
    const startTime = Date.now();
    console.log('[RpcAggregation] Starting aggregation...');

    const results = {
      rowsAggregated: 0,
      rowsDeleted: 0,
      hoursProcessed: 0,
      errors: [],
      durationMs: 0,
    };

    try {
      const nowMs = Date.now();
      const aggregateCutoffMs = nowMs - AGGREGATION_DELAY_MS;
      const deleteCutoffMs = nowMs - MAX_RETENTION_MS;

      // Convert to epoch seconds (revenue_events_v2.created_at is in seconds)
      const aggregateCutoffSec = Math.floor(aggregateCutoffMs / 1000);
      const deleteCutoffSec = Math.floor(deleteCutoffMs / 1000);

      // Step 1: Aggregate rows older than 1 hour into hourly buckets
      const aggregateResult = await this.pool.query(`
        INSERT INTO rpc_usage_hourly (hour_start, client_id, method, chain_id, request_count, error_count, cached_count, total_cost_usdt, avg_latency_ms, p99_latency_ms)
        SELECT
          (created_at / 3600) * 3600 AS hour_start,
          COALESCE(client_id, 'public') AS client_id,
          COALESCE(method, 'rpc_call') AS method,
          COALESCE(
            CASE
              WHEN chain = 'polygon' OR chain = 'matic' THEN 137
              WHEN chain = 'polygon-amoy' OR chain = 'amoy' THEN 80002
              WHEN chain = 'ethereum' OR chain = 'eth' THEN 1
              WHEN chain = 'arbitrum' OR chain = 'arb' THEN 42161
              WHEN chain = 'base' THEN 8453
              ELSE 0
            END,
            0
          ) AS chain_id,
          COUNT(*) AS request_count,
          COUNT(*) FILTER (WHERE status != 'completed' AND status != 'success') AS error_count,
          0 AS cached_count,
          COALESCE(SUM(amount_usdt), 0) AS total_cost_usdt,
          0 AS avg_latency_ms,
          0 AS p99_latency_ms
        FROM revenue_events_v2
        WHERE created_at < $1
          AND op_type = 'rpc_call'
        GROUP BY hour_start, client_id, method, chain_id
        ON CONFLICT (hour_start, client_id, method, chain_id)
        DO UPDATE SET
          request_count = rpc_usage_hourly.request_count + EXCLUDED.request_count,
          error_count = rpc_usage_hourly.error_count + EXCLUDED.error_count,
          total_cost_usdt = rpc_usage_hourly.total_cost_usdt + EXCLUDED.total_cost_usdt
      `, [aggregateCutoffSec]);

      results.rowsAggregated = aggregateResult.rowCount || 0;

      // Steps 2 & 3 DELETE from revenue_events_v2 (a financial ledger). Guarded off
      // by default — pruning the revenue ledger destroys revenue history.
      if (PRUNE_FINANCIAL_LEDGER && !isFinancialTable('revenue_events_v2')) {
        // Step 2: Delete aggregated rows (older than 1 hour)
        const deleteResult = await this.pool.query(`
          DELETE FROM revenue_events_v2
          WHERE created_at < $1
            AND op_type = 'rpc_call'
        `, [aggregateCutoffSec]);

        results.rowsDeleted = deleteResult.rowCount || 0;

        // Step 3: Hard delete any remaining rows older than 24 hours (safety net)
        const hardDeleteResult = await this.pool.query(`
          DELETE FROM revenue_events_v2
          WHERE created_at < $1
        `, [deleteCutoffSec]);

        if (hardDeleteResult.rowCount > 0) {
          results.rowsDeleted += hardDeleteResult.rowCount;
          console.log(`[RpcAggregation] Hard-deleted ${hardDeleteResult.rowCount} rows older than 24h`);
        }
      } else {
        console.warn('[RpcAggregation] Ledger prune skipped — revenue_events_v2 is a protected financial table');
      }

      // Count distinct hours processed
      const hoursResult = await this.pool.query(`
        SELECT COUNT(DISTINCT (created_at / 3600) * 3600) AS hours
        FROM rpc_usage_hourly
        WHERE hour_start >= $1
      `, [aggregateCutoffSec - 86400]);
      results.hoursProcessed = parseInt(hoursResult.rows[0]?.hours || 0);

      results.durationMs = Date.now() - startTime;
      this.lastRun = new Date().toISOString();
      this.lastResult = results;

      console.log(`[RpcAggregation] Complete in ${results.durationMs}ms`);
      console.log(`  → Aggregated: ${results.rowsAggregated} rows`);
      console.log(`  → Deleted: ${results.rowsDeleted} raw rows`);

    } catch (e) {
      console.error('[RpcAggregation] Fatal error:', e.message);
      results.errors.push(`Fatal: ${e.message}`);
    } finally {
      this.running = false;
    }

    return results;
  }

  getStatus() {
    return {
      running: this.running,
      lastRun: this.lastRun,
      lastResult: this.lastResult,
      config: {
        aggregationDelayMinutes: AGGREGATION_DELAY_MS / 60000,
        maxRetentionHours: MAX_RETENTION_MS / 3600000,
      },
    };
  }
}

export function createRpcAggregationJob(pool) {
  return new RpcAggregationJob(pool);
}

export function startRpcAggregationScheduler(pool, intervalMinutes = 60) {
  const job = new RpcAggregationJob(pool);
  const intervalMs = intervalMinutes * 60 * 1000;

  // Run immediately on startup, then every interval
  setTimeout(async () => {
    try {
      await job.run();
    } catch (e) {
      console.error('[RpcAggregation] Initial run failed:', e.message);
    }
  }, 5000); // 5 second delay to let DB connections settle

  setInterval(async () => {
    try {
      await job.run();
    } catch (e) {
      console.error('[RpcAggregation] Scheduled run failed:', e.message);
    }
  }, intervalMs);

  console.log(`[RpcAggregation] Scheduler started — every ${intervalMinutes} minutes`);

  return {
    job,
    runNow: () => job.run(),
    getStatus: () => job.getStatus(),
  };
}
