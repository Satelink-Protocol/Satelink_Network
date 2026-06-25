/**
 * Aggregates Economics Revenue Split information directly from the database schema.
 * Operates on `epochs` where `status = 'CLOSED'` (canonical) or 'FINALIZED' (legacy).
 */
export async function getEconomicsSummary(db) {
    // 1. Total Allocations (All Closed/Finalized Epochs)
    const totals = await db.prepare(`
        SELECT
            SUM(total_revenue_usdt) as totalrevenueusdt,
            SUM(node_pool_usdt) as totalnodepoolusdt,
            SUM(platform_share_usdt) as totalplatformshareusdt,
            SUM(distributor_share_usdt) as totaldistributorshareusdt
        FROM epochs
        WHERE status IN ('CLOSED', 'FINALIZED') AND (is_phantom = false OR is_phantom IS NULL)
    `).get() || {};

    const coalesce = (val) => val === null || val === undefined ? 0 : Number(val);

    // PostgreSQL lowercases unquoted column aliases
    const totalRevenueUsdt = coalesce(totals.totalrevenueusdt);
    const totalNodePoolUsdt = coalesce(totals.totalnodepoolusdt);
    const totalPlatformShareUsdt = coalesce(totals.totalplatformshareusdt);
    const totalDistributorShareUsdt = coalesce(totals.totaldistributorshareusdt);

    // 2. Last Closed Epoch Properties
    const lastEpoch = await db.prepare(`
        SELECT id, total_revenue_usdt, closed_at
        FROM epochs
        WHERE status IN ('CLOSED', 'FINALIZED') AND (is_phantom = false OR is_phantom IS NULL)
        ORDER BY id DESC
        LIMIT 1
    `).get() || { id: 0, total_revenue_usdt: 0, closed_at: null };

    return {
        totalRevenueUsdt,
        totalNodePoolUsdt,
        totalPlatformShareUsdt,
        totalDistributorShareUsdt,
        splitRatio: {
            nodeOperators: 50,
            platform: 30,
            distributors: 20
        },
        lastEpochId: lastEpoch.id || 0,
        lastEpochRevenueUsdt: coalesce(lastEpoch.total_revenue_usdt),
        lastEpochClosedAt: lastEpoch.closed_at || null
    };
}
