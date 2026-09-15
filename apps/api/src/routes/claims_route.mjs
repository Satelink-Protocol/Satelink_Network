import { Router } from 'express';
import { verifyJWT } from '../gateway/routes/auth_v2.js';
import { generateClaimSignature } from '../services/claims/claim_processor.js';
import { broadcaster } from '../realtime/broadcaster-instance.js';
import { discord } from '../services/discord_notify.mjs';

export function createClaimsRouter(pool) {
  const router = Router();

  // Admin endpoint: backfill orphaned revenue events with node_id
  router.post('/admin/backfill-revenue', verifyJWT, async (req, res) => {
    try {
      const { nodeId, adminSecret } = req.body;

      // T-02: no hard-coded fallback. ADMIN_BACKFILL_SECRET must be set in
      // env, or every request is refused as misconfigured (never silently
      // accepted via a literal — see 02_INVENTORY.md §4 B6).
      if (!process.env.ADMIN_BACKFILL_SECRET) {
        return res.status(503).json({ success: false, error: 'ADMIN_BACKFILL_SECRET not configured' });
      }
      if (adminSecret !== process.env.ADMIN_BACKFILL_SECRET) {
        return res.status(403).json({ success: false, error: 'Invalid admin secret' });
      }

      if (!nodeId) {
        return res.status(400).json({ success: false, error: 'nodeId required' });
      }

      // Verify node exists (check both tables for compatibility)
      let nodeResult = await pool.query(
        'SELECT node_id, wallet FROM registered_nodes WHERE node_id = $1',
        [nodeId]
      );
      if (nodeResult.rows.length === 0) {
        nodeResult = await pool.query(
          'SELECT node_id, wallet FROM nodes WHERE node_id = $1',
          [nodeId]
        );
      }

      if (nodeResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Node not found' });
      }

      const targetNodeId = nodeResult.rows[0].node_id;

      // Count orphaned revenue events
      const orphanCount = await pool.query(
        'SELECT COUNT(*) as count, COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE node_id IS NULL'
      );

      // Backfill orphaned revenue events with the node_id string
      const backfillResult = await pool.query(
        'UPDATE revenue_events_v2 SET node_id = $1 WHERE node_id IS NULL RETURNING id',
        [targetNodeId]
      );

      console.log(`[BACKFILL] Backfilled ${backfillResult.rowCount} orphaned revenue events to node ${nodeId}`);

      res.json({
        success: true,
        backfilled: backfillResult.rowCount,
        orphanedTotal: parseFloat(orphanCount.rows[0]?.total || 0),
        targetNodeId: targetNodeId
      });

    } catch (err) {
      console.error('[Backfill] Failed:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin endpoint: directly allocate earnings to a node based on revenue
  router.post('/admin/allocate-earnings', verifyJWT, async (req, res) => {
    try {
      const { nodeId, walletAddress, adminSecret } = req.body;

      // T-02: no hard-coded fallback (see backfill-revenue above).
      if (!process.env.ADMIN_BACKFILL_SECRET) {
        return res.status(503).json({ success: false, error: 'ADMIN_BACKFILL_SECRET not configured' });
      }
      if (adminSecret !== process.env.ADMIN_BACKFILL_SECRET) {
        return res.status(403).json({ success: false, error: 'Invalid admin secret' });
      }

      if (!nodeId) {
        return res.status(400).json({ success: false, error: 'nodeId required' });
      }

      const client = await pool.connect();
      try {
        // Ensure epoch_earnings table exists
        await client.query(`
          CREATE TABLE IF NOT EXISTS epoch_earnings (
            id SERIAL PRIMARY KEY,
            epoch_id INTEGER,
            role TEXT DEFAULT 'node_operator',
            wallet_or_node_id TEXT NOT NULL,
            amount_usdt NUMERIC(18,8) NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'UNPAID',
            created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())
          )
        `);

        // Calculate total revenue attributed to this node
        const revenueResult = await client.query(
          `SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE node_id = $1`,
          [nodeId]
        );
        const totalRevenue = parseFloat(revenueResult.rows[0]?.total || 0);

        if (totalRevenue === 0) {
          return res.json({ success: true, message: 'No revenue attributed to this node', allocated: 0 });
        }

        // Calculate node's share (50%)
        const nodeShare = totalRevenue * 0.50;

        // Check if earnings already exist for this node
        const existingResult = await client.query(
          `SELECT COALESCE(SUM(amount_usdt), 0) as existing FROM epoch_earnings WHERE wallet_or_node_id = $1 AND status = 'UNPAID'`,
          [nodeId]
        );
        const existingEarnings = parseFloat(existingResult.rows[0]?.existing || 0);

        // Only allocate if not already allocated
        const toAllocate = nodeShare - existingEarnings;

        if (toAllocate > 0) {
          // Use wallet address if provided, otherwise use nodeId
          const earningsId = walletAddress || nodeId;

          await client.query(
            `INSERT INTO epoch_earnings (epoch_id, role, wallet_or_node_id, amount_usdt, status, created_at)
             VALUES (1, 'node_operator', $1, $2, 'UNPAID', $3)`,
            [earningsId, toAllocate, Math.floor(Date.now() / 1000)]
          );

          console.log(`[ALLOCATE] Allocated $${toAllocate.toFixed(6)} to ${earningsId}`);
        }

        res.json({
          success: true,
          totalRevenue,
          nodeShare,
          existingEarnings,
          allocated: toAllocate,
          claimableTotal: nodeShare
        });

      } finally {
        client.release();
      }

    } catch (err) {
      console.error('[Allocate] Failed:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Admin endpoint: trigger epoch close and distribute rewards (legacy)
  router.post('/admin/close-epoch', verifyJWT, async (req, res) => {
    try {
      const { adminSecret } = req.body;

      // T-02: no hard-coded fallback (see backfill-revenue above).
      if (!process.env.ADMIN_BACKFILL_SECRET) {
        return res.status(503).json({ success: false, error: 'ADMIN_BACKFILL_SECRET not configured' });
      }
      if (adminSecret !== process.env.ADMIN_BACKFILL_SECRET) {
        return res.status(403).json({ success: false, error: 'Invalid admin secret' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Ensure epoch_ledger table exists
        await client.query(`
          CREATE TABLE IF NOT EXISTS epoch_ledger (
            id SERIAL PRIMARY KEY,
            epoch_id TEXT UNIQUE,
            status TEXT NOT NULL DEFAULT 'OPEN',
            started_at BIGINT NOT NULL,
            closed_at BIGINT,
            total_revenue NUMERIC(18,8) DEFAULT 0,
            node_pool NUMERIC(18,8) DEFAULT 0,
            platform_fee NUMERIC(18,8) DEFAULT 0,
            distribution_pool NUMERIC(18,8) DEFAULT 0,
            merkle_root TEXT,
            tx_hash TEXT,
            created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
          )
        `);

        // Ensure epoch_earnings table exists
        await client.query(`
          CREATE TABLE IF NOT EXISTS epoch_earnings (
            epoch_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'node_operator',
            wallet_or_node_id TEXT NOT NULL,
            amount_usdt NUMERIC(18,8) NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'UNPAID',
            created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()),
            PRIMARY KEY (epoch_id, wallet_or_node_id)
          )
        `);

        // Get current epoch
        const epochResult = await client.query(
          `SELECT id, epoch_id FROM epoch_ledger WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1`
        );

        let epochDbId, epochTextId;
        if (epochResult.rows.length === 0) {
          // Create first epoch
          const newEpoch = await client.query(
            `INSERT INTO epoch_ledger (epoch_id, status, started_at)
             VALUES ('epoch-1', 'OPEN', $1) RETURNING id, epoch_id`,
            [Date.now()]
          );
          epochDbId = newEpoch.rows[0].id;
          epochTextId = newEpoch.rows[0].epoch_id;
        } else {
          epochDbId = epochResult.rows[0].id;
          epochTextId = epochResult.rows[0].epoch_id || `epoch-${epochResult.rows[0].id}`;
        }

        // Calculate total unallocated revenue
        const revenueResult = await client.query(
          `SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2 WHERE epoch_id IS NULL`
        );
        const totalRevenue = parseFloat(revenueResult.rows[0].total || 0);

        if (totalRevenue === 0) {
          await client.query('ROLLBACK');
          return res.json({ success: true, message: 'No unallocated revenue to distribute', totalRevenue: 0 });
        }

        // Apply 50/30/20 split
        const nodePool = totalRevenue * 0.50;
        const platformFee = totalRevenue * 0.30;
        const distributionPool = totalRevenue * 0.20;

        // Get active nodes and their request counts (check registered_nodes first)
        let nodesResult = await client.query(
          `SELECT wallet, node_id,
                  (SELECT COUNT(*) FROM revenue_events_v2 WHERE node_id = registered_nodes.node_id AND epoch_id IS NULL) as request_count
           FROM registered_nodes WHERE status = 'active'`
        );
        if (nodesResult.rows.length === 0) {
          nodesResult = await client.query(
            `SELECT wallet, node_id,
                    (SELECT COUNT(*) FROM revenue_events_v2 WHERE node_id = nodes.node_id AND epoch_id IS NULL) as request_count
             FROM nodes WHERE status = 'active'`
          );
        }

        const activeNodes = nodesResult.rows;
        const totalRequests = activeNodes.reduce((sum, n) => sum + parseInt(n.request_count || 0), 0);

        // Distribute to nodes
        let distributed = 0;
        for (const node of activeNodes) {
          const requestCount = parseInt(node.request_count || 0);
          const nodeShare = totalRequests > 0 ? (requestCount / totalRequests) * nodePool : nodePool / Math.max(activeNodes.length, 1);

          if (nodeShare > 0 && node.wallet) {
            await client.query(
              `INSERT INTO epoch_earnings (epoch_id, wallet_or_node_id, amount_usdt, status, role, created_at)
               VALUES ($1, $2, $3, 'UNPAID', 'node_operator', $4)`,
              [epochDbId, node.wallet, nodeShare, Math.floor(Date.now() / 1000)]
            );
            distributed += nodeShare;
            console.log(`[EPOCH_CLOSE] Allocated $${nodeShare.toFixed(6)} to ${node.node_id}`);
          }
        }

        // Assign epoch_id to revenue events (use numeric db id)
        await client.query(
          `UPDATE revenue_events_v2 SET epoch_id = $1 WHERE epoch_id IS NULL`,
          [epochDbId]
        );

        // Close epoch
        await client.query(
          `UPDATE epoch_ledger SET status = 'CLOSED', closed_at = $1,
           total_revenue = $2, node_pool = $3, platform_fee = $4, distribution_pool = $5
           WHERE id = $6`,
          [Date.now(), totalRevenue, nodePool, platformFee, distributionPool, epochDbId]
        );

        // Create new open epoch
        const nextEpochNum = parseInt((epochTextId || '').replace('epoch-', '')) + 1 || epochDbId + 1;
        await client.query(
          `INSERT INTO epoch_ledger (epoch_id, status, started_at)
           VALUES ($1, 'OPEN', $2)`,
          [`epoch-${nextEpochNum}`, Date.now()]
        );

        await client.query('COMMIT');

        res.json({
          success: true,
          epochClosed: epochTextId,
          totalRevenue,
          nodePool,
          platformFee,
          distributionPool,
          nodesRewarded: activeNodes.filter(n => parseInt(n.request_count || 0) > 0).length,
          distributed
        });

      } finally {
        client.release();
      }

    } catch (err) {
      console.error('[EpochClose] Failed:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/:nodeId/claim', verifyJWT, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const { walletAddress } = req.body;

      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: 'walletAddress is required in request body'
        });
      }

      const result = await generateClaimSignature(nodeId, walletAddress, pool);

      broadcaster.publish('claim:generated', {
        node_id: nodeId,
        amount_usdt: result.amount_usdt || 0,
        wallet: walletAddress,
        timestamp: new Date().toISOString()
      });

      discord.claim(nodeId, result.amount_usdt || 0, null).catch(() => {});

      res.json({
        success: true,
        signature: result
      });

    } catch (err) {
      console.error('[Claims] Signature generation failed:', err.message);
      res.status(500).json({
        success: false,
        error: err.message
      });
    }
  });

  return router;
}
