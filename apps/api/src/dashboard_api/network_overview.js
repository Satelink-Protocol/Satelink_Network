/**
 * Dashboard Query Layer — Network Overview
 *
 * READ-ONLY aggregated queries for the network overview dashboard.
 * This module NEVER mutates state. All queries are SELECT-only.
 *
 * Tables read: registered_nodes, node_uptime, revenue_events_v2, epochs
 */

/**
 * @param {object} db - Database connection (UniversalDB)
 * @param {object} [cache] - Optional cache adapter (future Redis)
 * @returns {object} Network overview data
 */
export async function getNetworkOverview(db, cache) {
    const cacheKey = 'dashboard:network_overview';

    // ── Cache check (future Redis) ──
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

    // ── Total nodes ──
    const totalNodesRow = await queryOne("SELECT COUNT(*) as count FROM registered_nodes");
    const totalNodes = parseInt(totalNodesRow?.count || 0);

    // ── Active nodes (heartbeat within last 5 minutes) ──
    const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;
    const activeNodesRow = await queryOne(
        "SELECT COUNT(*) as count FROM registered_nodes WHERE status = 'active' AND last_heartbeat_at > $1",
        [fiveMinAgo]
    );
    const activeNodes = parseInt(activeNodesRow?.count || 0);

    // ── Flagged / jailed nodes ──
    const flaggedNodesRow = await queryOne("SELECT COUNT(*) as count FROM registered_nodes WHERE is_flagged = true");
    const flaggedNodes = parseInt(flaggedNodesRow?.count || 0);

    // ── Current epoch ──
    const currentEpoch = await queryOne("SELECT id, status, total_revenue_usdt FROM epochs ORDER BY id DESC LIMIT 1")
        || { id: 0, status: 'UNKNOWN', total_revenue_usdt: 0 };

    // ── Total revenue (all time, aggregated) ──
    const totalRevenueRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE status = 'success' AND is_test_data = false"
    );
    const totalRevenue = parseFloat(totalRevenueRow?.total || 0);

    // ── Revenue last 24h ──
    const oneDayAgoMs = Date.now() - 86400000;
    const revenue24hRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE status = 'success' AND is_test_data = false AND created_at > $1",
        [oneDayAgoMs]
    );
    const revenue24h = parseFloat(revenue24hRow?.total || 0);

    // ── Ops count last 24h ──
    const ops24hRow = await queryOne(
        "SELECT COUNT(*) as count FROM revenue_events_v2 WHERE created_at > $1",
        [oneDayAgoMs]
    );
    const ops24h = parseInt(ops24hRow?.count || 0);

    // ── Node type distribution ──
    const nodeTypes = await query("SELECT node_type, COUNT(*) as count FROM registered_nodes GROUP BY node_type");

    // ── Network health score ──
    const healthPct = totalNodes > 0 ? Math.round((activeNodes / totalNodes) * 100) : 0;
    const networkHealth = healthPct >= 90 ? 'healthy' : healthPct >= 70 ? 'degraded' : 'critical';

    const result = {
        total_nodes: totalNodes,
        active_nodes: activeNodes,
        flagged_nodes: flaggedNodes,
        total_revenue: parseFloat(totalRevenue.toFixed(6)),
        revenue_24h: parseFloat(revenue24h.toFixed(6)),
        ops_24h: ops24h,
        epoch_id: currentEpoch.id,
        epoch_status: currentEpoch.status,
        network_health: networkHealth,
        health_pct: healthPct,
        node_types: nodeTypes,
    };

    // ── Cache set (future Redis, TTL 30s) ──
    if (cache?.set) {
        await cache.set(cacheKey, JSON.stringify(result), 'EX', 30);
    }

    return result;
}
