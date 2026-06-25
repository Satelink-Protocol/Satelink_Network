import express from "express";

export default function revenueRoutes(pool) {
  const router = express.Router();

  router.get("/revenue", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT COALESCE(SUM(amount_usdt), 0) AS total
        FROM revenue_events_v2
      `);

      res.json({ ok: true, total: result.rows[0].total });
    } catch (err) {
      console.error("Revenue error:", err);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/revenue/events", async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT id, amount_usdt, created_at
        FROM revenue_events_v2
        ORDER BY created_at DESC
        LIMIT 50
      `);

      res.json({ ok: true, events: result.rows });
    } catch (err) {
      console.error("Events error:", err);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/epochs", async (req, res) => {
    try {
      // Query actual epochs table (status is 'OPEN' or 'CLOSED')
      const result = await pool.query(`
        SELECT
          e.id AS epoch_id,
          e.status,
          e.starts_at,
          e.ends_at,
          e.total_revenue_usdt AS total,
          e.node_pool_usdt,
          e.platform_share_usdt,
          e.distributor_share_usdt,
          COALESCE(r.request_count, 0) AS requests
        FROM epochs e
        LEFT JOIN (
          SELECT epoch_id, COUNT(*) AS request_count
          FROM revenue_events_v2
          WHERE epoch_id IS NOT NULL
          GROUP BY epoch_id
        ) r ON r.epoch_id = e.id
        ORDER BY e.id DESC
        LIMIT 20
      `);

      res.json({ ok: true, epochs: result.rows });
    } catch (err) {
      console.error("Epoch error:", err);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  router.get("/economics/summary", async (req, res) => {
    try {
      // 1. Total Allocations (All Closed/Finalized Epochs)
      const totalsResult = await pool.query(`
        SELECT
          SUM(total_revenue_usdt) as totalrevenueusdt,
          SUM(node_pool_usdt) as totalnodepoolusdt,
          SUM(platform_share_usdt) as totalplatformshareusdt,
          SUM(distributor_share_usdt) as totaldistributorshareusdt
        FROM epochs
        WHERE status IN ('CLOSED', 'FINALIZED')
      `);
      const totals = totalsResult.rows[0] || {};

      const coalesce = (val) => val === null || val === undefined ? 0 : Number(val);

      const totalRevenueUsdt = coalesce(totals.totalrevenueusdt);
      const totalNodePoolUsdt = coalesce(totals.totalnodepoolusdt);
      const totalPlatformShareUsdt = coalesce(totals.totalplatformshareusdt);
      const totalDistributorShareUsdt = coalesce(totals.totaldistributorshareusdt);

      // 2. Last Closed Epoch Properties
      const lastEpochResult = await pool.query(`
        SELECT id, total_revenue_usdt, closed_at
        FROM epochs
        WHERE status IN ('CLOSED', 'FINALIZED')
        ORDER BY id DESC
        LIMIT 1
      `);
      const lastEpoch = lastEpochResult.rows[0] || { id: 0, total_revenue_usdt: 0, closed_at: null };

      res.json({
        ok: true,
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
      });
    } catch (err) {
      console.error("Economics summary error:", err);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  return router;
}
