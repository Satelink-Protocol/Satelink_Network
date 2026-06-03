/**
 * DataRetentionJob — Scheduled cleanup of old logs and metrics
 *
 * Retention policy:
 * - RPC request logs: 7 days
 * - Metrics/analytics tables: 30 days
 *
 * Runs daily at 3 AM UTC (configurable).
 * Executes VACUUM ANALYZE after cleanup to reclaim space.
 */

const RETENTION_RPC_LOGS_DAYS = 7;
const RETENTION_METRICS_DAYS = 30;

const RPC_LOG_TABLES = [
  { table: 'rpc_requests', timestampCol: 'created_at', isEpochMs: true },
  { table: 'rate_limit_windows', timestampCol: 'window_start', isEpochMs: false },
  { table: 'rpc_response_cache', timestampCol: 'created_at', isEpochMs: true },
];

const METRICS_TABLES = [
  { table: 'rpc_usage_hourly', timestampCol: 'hour_start', isEpochMs: false },
  { table: 'execution_metrics', timestampCol: 'updated_at', isEpochMs: true },
  { table: 'runtime_metrics', timestampCol: 'created_at', isEpochMs: true },
  { table: 'heartbeat_security_log', timestampCol: 'created_at', isEpochMs: true },
  { table: 'audit_logs', timestampCol: 'created_at', isEpochMs: true },
  { table: 'job_queue_log', timestampCol: 'created_at', isEpochMs: true },
  { table: 'backup_log', timestampCol: 'created_at', isEpochMs: true },
  { table: 'request_traces', timestampCol: 'created_at', isEpochMs: true },
  { table: 'ops_traces', timestampCol: 'created_at', isEpochMs: true },
  { table: 'stress_test_runs', timestampCol: 'created_at', isEpochMs: true },
  { table: 'self_test_runs', timestampCol: 'created_at', isEpochMs: true },
  { table: 'diagnostics_results', timestampCol: 'created_at', isEpochMs: true },
  { table: 'error_events', timestampCol: 'last_seen_at', isEpochMs: true },
  { table: 'api_usage', timestampCol: 'created_at', isEpochMs: true },
  { table: 'abuse_counters_5m', timestampCol: 'updated_at', isEpochMs: true },
  { table: 'slow_queries', timestampCol: 'last_seen_at', isEpochMs: true },
];

export class DataRetentionJob {
  constructor(pool) {
    this.pool = pool;
    this.running = false;
    this.lastRun = null;
    this.lastResult = null;
  }

  async run() {
    if (this.running) {
      console.log('[DataRetention] Already running, skipping');
      return { skipped: true };
    }

    this.running = true;
    const startTime = Date.now();
    console.log('[DataRetention] Starting cleanup...');

    const results = {
      rpcLogs: { deleted: 0, tables: [] },
      metrics: { deleted: 0, tables: [] },
      vacuumed: [],
      errors: [],
      durationMs: 0,
    };

    try {
      const nowMs = Date.now();
      const rpcCutoffMs = nowMs - (RETENTION_RPC_LOGS_DAYS * 24 * 60 * 60 * 1000);
      const metricsCutoffMs = nowMs - (RETENTION_METRICS_DAYS * 24 * 60 * 60 * 1000);
      const rpcCutoffSec = Math.floor(rpcCutoffMs / 1000);
      const metricsCutoffSec = Math.floor(metricsCutoffMs / 1000);

      for (const { table, timestampCol, isEpochMs } of RPC_LOG_TABLES) {
        const cutoff = isEpochMs ? rpcCutoffMs : rpcCutoffSec;
        const deleted = await this.deleteOldRecords(table, timestampCol, cutoff, results.errors);
        if (deleted > 0) {
          results.rpcLogs.deleted += deleted;
          results.rpcLogs.tables.push({ table, deleted });
          await this.vacuumTable(table, results);
        }
      }

      for (const { table, timestampCol, isEpochMs } of METRICS_TABLES) {
        const cutoff = isEpochMs ? metricsCutoffMs : metricsCutoffSec;
        const deleted = await this.deleteOldRecords(table, timestampCol, cutoff, results.errors);
        if (deleted > 0) {
          results.metrics.deleted += deleted;
          results.metrics.tables.push({ table, deleted });
          await this.vacuumTable(table, results);
        }
      }

      results.durationMs = Date.now() - startTime;
      this.lastRun = new Date().toISOString();
      this.lastResult = results;

      console.log(`[DataRetention] Cleanup complete in ${results.durationMs}ms`);
      console.log(`  → RPC logs: ${results.rpcLogs.deleted} rows deleted (${RETENTION_RPC_LOGS_DAYS}d retention)`);
      console.log(`  → Metrics: ${results.metrics.deleted} rows deleted (${RETENTION_METRICS_DAYS}d retention)`);
      console.log(`  → Vacuumed: ${results.vacuumed.length} tables`);

      if (results.errors.length > 0) {
        console.warn(`  → Errors: ${results.errors.length}`);
        results.errors.forEach(e => console.warn(`    - ${e}`));
      }

    } catch (e) {
      console.error('[DataRetention] Fatal error:', e.message);
      results.errors.push(`Fatal: ${e.message}`);
    } finally {
      this.running = false;
    }

    return results;
  }

  async deleteOldRecords(table, timestampCol, cutoff, errors) {
    try {
      const tableExists = await this.pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = $1
        )
      `, [table]);

      if (!tableExists.rows[0].exists) {
        return 0;
      }

      const result = await this.pool.query(`
        DELETE FROM ${table}
        WHERE ${timestampCol} < $1
      `, [cutoff]);

      return result.rowCount || 0;
    } catch (e) {
      errors.push(`${table}: ${e.message}`);
      return 0;
    }
  }

  async vacuumTable(table, results) {
    try {
      await this.pool.query(`VACUUM ANALYZE ${table}`);
      results.vacuumed.push(table);
    } catch (e) {
      results.errors.push(`VACUUM ${table}: ${e.message}`);
    }
  }

  getStatus() {
    return {
      running: this.running,
      lastRun: this.lastRun,
      lastResult: this.lastResult,
      config: {
        rpcLogsRetentionDays: RETENTION_RPC_LOGS_DAYS,
        metricsRetentionDays: RETENTION_METRICS_DAYS,
        rpcLogTables: RPC_LOG_TABLES.map(t => t.table),
        metricsTables: METRICS_TABLES.map(t => t.table),
      },
    };
  }
}

export function createDataRetentionJob(pool) {
  return new DataRetentionJob(pool);
}

export function startDataRetentionScheduler(pool, runAtHourUTC = 3) {
  const job = new DataRetentionJob(pool);

  const scheduleNextRun = () => {
    const now = new Date();
    const next = new Date();
    next.setUTCHours(runAtHourUTC, 0, 0, 0);

    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }

    const msToNext = next - now;

    console.log(`[DataRetention] Next run scheduled for ${next.toISOString()}`);

    setTimeout(async () => {
      try {
        await job.run();
      } catch (e) {
        console.error('[DataRetention] Scheduled run failed:', e.message);
      }
      scheduleNextRun();
    }, msToNext);
  };

  scheduleNextRun();

  console.log(`[DataRetention] Scheduler started — daily at ${runAtHourUTC}:00 UTC`);

  return {
    job,
    runNow: () => job.run(),
    getStatus: () => job.getStatus(),
  };
}
