/**
 * Dashboard Query Layer — Earnings Overview
 *
 * READ-ONLY aggregated queries for revenue and earnings dashboards.
 * This module NEVER mutates state. All queries are SELECT-only.
 *
 * Tables read: revenue_events_v2, epoch_earnings, epochs
 */

/**
 * Get aggregated earnings overview for dashboards.
 *
 * @param {object} db - Database connection
 * @param {object} [cache] - Optional cache adapter
 * @returns {object} Earnings overview
 */
export async function getEarningsOverview(db, cache) {
    const cacheKey = 'dashboard:earnings_overview';

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

    const now = Date.now();
    const oneDayAgo = now - 86400000;
    const sevenDaysAgo = now - 604800000;
    const thirtyDaysAgo = now - 2592000000;

    // ── Total revenue (all time) ──
    const totalRevenueRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE status = 'success'"
    );
    const totalRevenue = parseFloat(totalRevenueRow?.total || 0);

    // ── Revenue by time window ──
    const revenue24hRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE status = 'success' AND created_at > $1",
        [oneDayAgo]
    );
    const revenue24h = parseFloat(revenue24hRow?.total || 0);

    const revenue7dRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE status = 'success' AND created_at > $1",
        [sevenDaysAgo]
    );
    const revenue7d = parseFloat(revenue7dRow?.total || 0);

    const revenue30dRow = await queryOne(
        "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE status = 'success' AND created_at > $1",
        [thirtyDaysAgo]
    );
    const revenue30d = parseFloat(revenue30dRow?.total || 0);

    // ── Revenue split (50/30/20) from epoch_earnings ──
    const splitTotals = await query(
        `SELECT role, COALESCE(SUM(amount_usdt), 0) as total
         FROM epoch_earnings
         GROUP BY role`
    );

    const splitMap = {};
    for (const row of splitTotals) {
        splitMap[row.role] = parseFloat(parseFloat(row.total || 0).toFixed(6));
    }

    // ── Revenue by operation type (top 10) ──
    const byOpType = await query(
        `SELECT op_type, COUNT(*) as count, COALESCE(SUM(amount_usdt), 0) as total
         FROM revenue_events_v2
         WHERE status = 'success'
         GROUP BY op_type
         ORDER BY total DESC
         LIMIT 10`
    );

    // ── Epoch history (last 10 completed epochs) ──
    const recentEpochs = await query(
        `SELECT id, status, total_revenue_usdt, node_pool_usdt, platform_share_usdt, distributor_share_usdt
         FROM epochs
         ORDER BY id DESC
         LIMIT 10`
    );

    // ── Payout status distribution ──
    const payoutStatus = await query(
        `SELECT status, COUNT(*) as count, COALESCE(SUM(amount_usdt), 0) as total
         FROM epoch_earnings
         GROUP BY status`
    );

    const result = {
        total_revenue: parseFloat(totalRevenue.toFixed(6)),
        revenue_24h: parseFloat(revenue24h.toFixed(6)),
        revenue_7d: parseFloat(revenue7d.toFixed(6)),
        revenue_30d: parseFloat(revenue30d.toFixed(6)),
        split: {
            node_operator: splitMap['node_operator'] || 0,
            platform: splitMap['platform'] || 0,
            distribution_pool: splitMap['distribution_pool'] || 0,
        },
        by_op_type: byOpType.map(r => ({
            op_type: r.op_type,
            count: parseInt(r.count || 0),
            total_usdt: parseFloat(parseFloat(r.total || 0).toFixed(6)),
        })),
        recent_epochs: recentEpochs,
        payout_status: payoutStatus.map(r => ({
            status: r.status,
            count: parseInt(r.count || 0),
            total_usdt: parseFloat(parseFloat(r.total || 0).toFixed(6)),
        })),
    };

    if (cache?.set) {
        await cache.set(cacheKey, JSON.stringify(result), 'EX', 30);
    }

    return result;
}
