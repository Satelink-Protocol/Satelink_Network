/**
 * Dashboard Query Layer — Admin System Health
 *
 * READ-ONLY aggregated queries for admin system health dashboard.
 * This module NEVER mutates state. All queries are SELECT-only.
 *
 * Tables read: system_flags, registered_nodes, revenue_events_v2,
 *              epochs, users, error_events
 */

/**
 * Get system health overview for admin dashboard.
 *
 * @param {object} db - Database connection
 * @param {object} [cache] - Optional cache adapter
 * @returns {object} System health data
 */
export async function getSystemHealth(db, cache) {
    const cacheKey = 'dashboard:admin_system_health';

    if (cache?.get) {
        const cached = await cache.get(cacheKey);
        if (cached) return JSON.parse(cached);
    }

    // Helper for async queries (supports both pg Pool and PgDatabase adapter)
    const query = async (sql, params = []) => {
        if (db.query) {
            const result = await db.query(sql, params);
            return result.rows || result;
        }
        if (db.prepare) {
            return await db.prepare(sql).all(params);
        }
        return [];
    };

    const queryOne = async (sql, params = []) => {
        if (db.query) {
            const result = await db.query(sql, params);
            return result.rows?.[0] || null;
        }
        if (db.prepare) {
            return await db.prepare(sql).get(params);
        }
        return null;
    };

    const now = Math.floor(Date.now() / 1000);
    const fiveMinAgo = now - 300;
    const oneHourAgo = now - 3600;
    const fiveMinAgoMs = Date.now() - 300000;
    const oneHourAgoMs = Date.now() - 3600000;
    const oneDayAgoMs = Date.now() - 86400000;

    // ── System flags ──
    const flags = {};
    try {
        const flagRows = await query(
            "SELECT key, value FROM system_flags WHERE key IN ('system_state', 'withdrawals_paused', 'security_freeze', 'revenue_mode', 'beta_gate_enabled')"
        );
        for (const row of flagRows) {
            flags[row.key] = row.value;
        }
    } catch { /* table may not exist */ }

    // ── Active nodes (5 min) ──
    const activeNodesRow = await queryOne(
        "SELECT COUNT(*) as count FROM registered_nodes WHERE status = 'active' AND last_heartbeat_at > $1",
        [fiveMinAgo]
    );
    const activeNodes = parseInt(activeNodesRow?.count || 0);

    // ── Ops last 5 min ──
    const ops5mRow = await queryOne(
        "SELECT COUNT(*) as count FROM revenue_events_v2 WHERE created_at > $1",
        [fiveMinAgoMs]
    );
    const ops5m = parseInt(ops5mRow?.count || 0);

    // ── Success rate last 5 min ──
    const successCountRow = await queryOne(
        "SELECT COUNT(*) as count FROM revenue_events_v2 WHERE created_at > $1 AND status = 'success'",
        [fiveMinAgoMs]
    );
    const successCount = parseInt(successCountRow?.count || 0);
    const successRate = ops5m > 0 ? parseFloat(((successCount / ops5m) * 100).toFixed(1)) : 100;

    // ── Revenue last 24h ──
    const revenue24hRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE status = 'success' AND is_test_data = false AND created_at > $1",
        [oneDayAgoMs]
    );
    const revenue24h = parseFloat(revenue24hRow?.total || 0);

    // ── Error count last hour ──
    let errors1h = 0;
    try {
        const errors1hRow = await queryOne(
            "SELECT COUNT(*) as count FROM revenue_events_v2 WHERE created_at > $1 AND status != 'success'",
            [oneHourAgoMs]
        );
        errors1h = parseInt(errors1hRow?.count || 0);
    } catch { /* table may not exist */ }

    // ── User counts by role ──
    let usersByRole = [];
    try {
        usersByRole = await query("SELECT role, COUNT(*) as count FROM users GROUP BY role");
    } catch { /* table may not exist */ }

    // ── Current epoch ──
    const currentEpoch = await queryOne("SELECT id, status FROM epochs ORDER BY id DESC LIMIT 1")
        || { id: 0, status: 'UNKNOWN' };

    // ── Total epochs closed ──
    const epochsClosedRow = await queryOne("SELECT COUNT(*) as count FROM epochs WHERE status = 'CLOSED'");
    const epochsClosed = parseInt(epochsClosedRow?.count || 0);

    const result = {
        system_state: flags['system_state'] || 'UNKNOWN',
        withdrawals_paused: flags['withdrawals_paused'] === 'true',
        security_freeze: flags['security_freeze'] === 'true',
        revenue_mode: flags['revenue_mode'] || 'UNKNOWN',
        beta_gate_enabled: flags['beta_gate_enabled'] === 'true',
        kpis: {
            active_nodes_5m: activeNodes,
            ops_5m: ops5m,
            success_rate_5m: successRate,
            revenue_24h_usdt: parseFloat(revenue24h.toFixed(6)),
            errors_1h: errors1h,
        },
        current_epoch: currentEpoch,
        epochs_closed: epochsClosed,
        users_by_role: usersByRole,
        uptime_seconds: Math.floor(process.uptime()),
    };

    if (cache?.set) {
        await cache.set(cacheKey, JSON.stringify(result), 'EX', 15);
    }

    return result;
}
