/**
 * DB Cleanup Job — runs daily at 3:00 AM UTC
 * Prunes old rows from high-volume tables to control Postgres volume growth.
 * Protected tables (never touched): credit_deposits, credit_balances,
 * auth_nonces, auth_users, epoch_earnings, registered_nodes.
 */

export async function runDbCleanup(pool) {
  const client = await pool.connect();
  const deleted = {};

  try {
    // revenue_events_v2 — keep 30 days
    const rev = await client.query(
      `DELETE FROM revenue_events_v2
       WHERE created_at < NOW() - INTERVAL '30 days'`
    );
    deleted.revenue_events_v2 = rev.rowCount;

    // api_usage_daily — keep 30 days
    let usageRows = 0;
    try {
      const usage = await client.query(
        `DELETE FROM api_usage_daily
         WHERE date < NOW() - INTERVAL '30 days'`
      );
      usageRows = usage.rowCount;
    } catch (e) {
      // table may not exist
    }
    deleted.api_usage_daily = usageRows;

    // epochs — keep 90 days of closed epochs; open epochs and recent closed ones are retained
    const ep = await client.query(
      `DELETE FROM epochs
       WHERE ends_at < EXTRACT(EPOCH FROM NOW()) - 7776000
         AND status = 'CLOSED'`
    );
    deleted.epochs = ep.rowCount;

    // epoch_ledger — prune entries whose epoch is gone
    let ledgerRows = 0;
    try {
      const led = await client.query(
        `DELETE FROM epoch_ledger
         WHERE epoch_id < (
           SELECT MIN(id) FROM epochs
           WHERE status = 'OPEN'
              OR starts_at > EXTRACT(EPOCH FROM NOW()) - 7776000
         )`
      );
      ledgerRows = led.rowCount;
    } catch (e) {
      // table may not exist
    }
    deleted.epoch_ledger = ledgerRows;

    // node_health_logs — keep 7 days
    let healthRows = 0;
    try {
      const health = await client.query(
        `DELETE FROM node_health_logs
         WHERE created_at < NOW() - INTERVAL '7 days'`
      );
      healthRows = health.rowCount;
    } catch (e) {
      // table may not exist
    }
    deleted.node_health_logs = healthRows;

    // VACUUM ANALYZE each pruned table (outside transaction — VACUUM can't run inside one)
    const tables = [
      'revenue_events_v2',
      'api_usage_daily',
      'epochs',
      'epoch_ledger',
      'node_health_logs'
    ];
    for (const table of tables) {
      try {
        await client.query(`VACUUM ANALYZE ${table}`);
      } catch (e) {
        // table may not exist or VACUUM may be restricted
      }
    }

    console.log('[DB Cleanup] Deleted rows:', deleted);
    return { ok: true, deleted };
  } catch (err) {
    console.error('[DB Cleanup] Failed:', err.message);
    return { ok: false, error: err.message, deleted };
  } finally {
    client.release();
  }
}

/**
 * Schedule the cleanup job to run daily at 3:00 AM UTC.
 * @param {import('pg').Pool} pool
 */
export function startDbCleanupScheduler(pool) {
  const runCleanup = async () => {
    console.log('[DB Cleanup Scheduler] Running scheduled cleanup');
    await runDbCleanup(pool);
  };

  const now = new Date();
  const next3am = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + (now.getUTCHours() >= 3 ? 1 : 0),
    3, 0, 0, 0
  ));
  const msUntil3am = next3am.getTime() - now.getTime();

  setTimeout(() => {
    runCleanup();
    setInterval(runCleanup, 24 * 60 * 60 * 1000);
  }, msUntil3am);

  console.log('[DB Cleanup Scheduler] Started, first run at', next3am.toISOString());
  return { runNow: runCleanup, nextRunAt: next3am };
}
