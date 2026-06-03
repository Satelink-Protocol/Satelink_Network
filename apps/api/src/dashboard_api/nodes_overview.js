/**
 * Dashboard Query Layer — Nodes Overview
 *
 * READ-ONLY aggregated queries for node dashboards.
 * This module NEVER mutates state. All queries are SELECT-only.
 *
 * Tables read: registered_nodes, node_uptime, epoch_earnings
 */

/**
 * Get summary for a specific node operator wallet.
 *
 * @param {object} db - Database connection
 * @param {string} wallet - Node operator wallet address
 * @param {object} [cache] - Optional cache adapter
 * @returns {object} Node summary
 */
export async function getNodeSummary(db, wallet, cache) {
    const cacheKey = `dashboard:node_summary:${wallet}`;

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

    // ── Node registration status ──
    const node = await queryOne(
        "SELECT wallet, node_type, status, is_flagged, last_heartbeat_at, latency_ms, bandwidth FROM registered_nodes WHERE wallet = $1",
        [wallet]
    );

    if (!node) {
        return { found: false, wallet };
    }

    // ── Total earnings (aggregated) ──
    const totalEarnedRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM epoch_earnings WHERE wallet_or_node_id = $1 AND role = 'node_operator'",
        [wallet]
    );
    const totalEarned = parseFloat(totalEarnedRow?.total || 0);

    // ── Claimable earnings ──
    const claimableRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM epoch_earnings WHERE wallet_or_node_id = $1 AND role = 'node_operator' AND status = 'UNPAID'",
        [wallet]
    );
    const claimable = parseFloat(claimableRow?.total || 0);

    // ── Withdrawn earnings ──
    const withdrawnRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM epoch_earnings WHERE wallet_or_node_id = $1 AND role = 'node_operator' AND status = 'PAID'",
        [wallet]
    );
    const withdrawn = parseFloat(withdrawnRow?.total || 0);

    // ── Recent uptime (last 10 epochs) ──
    const uptime = await query(
        "SELECT epoch_id, uptime_seconds, score FROM node_uptime WHERE node_wallet = $1 ORDER BY epoch_id DESC LIMIT 10",
        [wallet]
    );

    // ── Recent earnings by epoch (last 10) ──
    const earnings = await query(
        "SELECT epoch_id, amount_usdt, status FROM epoch_earnings WHERE wallet_or_node_id = $1 AND role = 'node_operator' ORDER BY epoch_id DESC LIMIT 10",
        [wallet]
    );

    // ── Ops count for this node ──
    const opsCountRow = await queryOne(
        "SELECT COUNT(*) as count FROM revenue_events_v2 WHERE node_id = $1",
        [wallet]
    );
    const opsCount = parseInt(opsCountRow?.count || 0);

    const result = {
        found: true,
        wallet: node.wallet,
        node_type: node.node_type,
        active: node.status === 'active',
        is_flagged: !!node.is_flagged,
        last_heartbeat: node.last_heartbeat_at,
        latency: node.latency_ms,
        bandwidth: node.bandwidth,
        total_earned: parseFloat(totalEarned.toFixed(6)),
        claimable: parseFloat(claimable.toFixed(6)),
        withdrawn: parseFloat(withdrawn.toFixed(6)),
        ops_count: opsCount,
        uptime,
        earnings,
    };

    if (cache?.set) {
        await cache.set(cacheKey, JSON.stringify(result), 'EX', 15);
    }

    return result;
}

/**
 * Get aggregated admin nodes overview.
 *
 * @param {object} db - Database connection
 * @param {object} [cache] - Optional cache adapter
 * @returns {object} Admin nodes overview
 */
export async function getAdminNodesOverview(db, cache) {
    const cacheKey = 'dashboard:admin_nodes_overview';

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

    const fiveMinAgo = Math.floor(Date.now() / 1000) - 300;

    // ── Counts by status ──
    const totalRow = await queryOne("SELECT COUNT(*) as count FROM registered_nodes");
    const total = parseInt(totalRow?.count || 0);

    const activeRow = await queryOne(
        "SELECT COUNT(*) as count FROM registered_nodes WHERE status = 'active' AND last_heartbeat_at > $1",
        [fiveMinAgo]
    );
    const active = parseInt(activeRow?.count || 0);

    const flaggedRow = await queryOne("SELECT COUNT(*) as count FROM registered_nodes WHERE is_flagged = true");
    const flagged = parseInt(flaggedRow?.count || 0);

    const inactiveRow = await queryOne(
        "SELECT COUNT(*) as count FROM registered_nodes WHERE status != 'active' OR last_heartbeat_at <= $1",
        [fiveMinAgo]
    );
    const inactive = parseInt(inactiveRow?.count || 0);

    // ── Type distribution ──
    const byType = await query("SELECT node_type, COUNT(*) as count FROM registered_nodes GROUP BY node_type");

    // ── Top 20 nodes by earnings (lightweight) ──
    const topEarners = await query(
        `SELECT wallet_or_node_id as wallet, COALESCE(SUM(amount_usdt), 0) as total_earned
         FROM epoch_earnings
         WHERE role = 'node_operator'
         GROUP BY wallet_or_node_id
         ORDER BY total_earned DESC
         LIMIT 20`
    );

    // ── Average latency ──
    const avgLatencyRow = await queryOne(
        "SELECT COALESCE(AVG(latency_ms), 0) as avg FROM registered_nodes WHERE status = 'active' AND latency_ms > 0"
    );
    const avgLatency = parseFloat(avgLatencyRow?.avg || 0);

    const result = {
        total,
        active,
        inactive,
        flagged,
        by_type: byType,
        top_earners: topEarners,
        avg_latency_ms: Math.round(avgLatency),
    };

    if (cache?.set) {
        await cache.set(cacheKey, JSON.stringify(result), 'EX', 30);
    }

    return result;
}
