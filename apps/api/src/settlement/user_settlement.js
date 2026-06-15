import express from 'express';
import { logger } from '../monitoring/logger.js';
import { executeWithdrawal, withdrawRateLimitMiddleware } from './withdraw_service.js';
import { generateClaimsForUnpaidEarnings } from './claim_generator.js';

function resolvePool(dbOrPool) {
    if (dbOrPool?.connect && dbOrPool?.query) return dbOrPool;
    if (dbOrPool?.pool?.connect && dbOrPool?.pool?.query) return dbOrPool.pool;
    throw new Error('A PostgreSQL pool or PgDatabase instance is required');
}

/**
 * User Settlement Router
 * Handles Node Operator claims and USDT withdrawals.
 * Withdrawals route through canonical withdraw_service.js pipeline.
 */
export function createSettlementRouter(db, opsEngine) {
    const router = express.Router();

    // PART 8: CLAIM EARNINGS
    // Materializes UNPAID epoch_earnings into UNCLAIMED epoch_claims rows
    // (with Merkle leaf hashes) via the real claim generator, then returns
    // this operator's claims — epochs, amounts, and leaf hashes.
    router.post('/claim', async (req, res) => {
        try {
            const { node_id, wallet } = req.body;
            if (!node_id || !wallet) {
                return res.status(400).json({ ok: false, error: 'Missing node_id or wallet' });
            }

            // Generate claims for all unpaid earnings (idempotent — ON CONFLICT
            // DO NOTHING). Converts epoch_earnings rows into epoch_claims with
            // leaf hashes and marks the earnings CLAIMED.
            const genResult = await generateClaimsForUnpaidEarnings(db);

            // Read back this operator's claims. epoch_earnings keys on
            // wallet_or_node_id, so match against either the wallet or node_id.
            const pool = resolvePool(db);
            const { rows } = await pool.query(
                `SELECT epoch_id, operator_wallet, amount_usdt, leaf_hash,
                        status, claimed_tx_hash, claimed_at
                 FROM epoch_claims
                 WHERE operator_wallet IN ($1, $2)
                 ORDER BY epoch_id ASC`,
                [wallet, node_id]
            );

            const claims = rows.map((r) => ({
                epoch_id: Number(r.epoch_id),
                operator_wallet: r.operator_wallet,
                amount_usdt: r.amount_usdt,
                leaf_hash: r.leaf_hash,
                status: r.status,
                claimed_tx_hash: r.claimed_tx_hash,
                claimed_at: r.claimed_at
            }));

            const totalUnclaimedUsdt = claims
                .filter((c) => c.status === 'UNCLAIMED')
                .reduce((sum, c) => sum + Number(c.amount_usdt || 0), 0);

            logger.info(
                `[Settlement] Node ${node_id} (${wallet}) — ${claims.length} claims, ` +
                `${totalUnclaimedUsdt} USDT unclaimed (${genResult.claims_created} new this run)`
            );

            return res.json({
                ok: true,
                node_id,
                wallet,
                scanned: genResult.scanned,
                claims_created: genResult.claims_created,
                earnings_updated: genResult.earnings_updated,
                total_unclaimed_usdt: totalUnclaimedUsdt,
                claims
            });
        } catch (e) {
            logger.error(`[Settlement] Claim failed for ${req.body?.node_id}: ${e.message}`);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // PART 8: WITHDRAW USDT — routed through canonical withdrawal service
    router.post('/withdraw', withdrawRateLimitMiddleware, async (req, res) => {
        try {
            const { wallet, amount } = req.body;
            if (!wallet || !amount) {
                return res.status(400).json({ ok: false, error: 'Missing wallet or amount' });
            }

            const result = await executeWithdrawal(wallet, amount, opsEngine, {
                sourceRoute: '/v1/settlement/withdraw'
            });

            return res.json({
                ok: true,
                withdrawalId: result.withdrawalId,
                amount,
                destination: wallet,
                status: result.status
            });
        } catch (e) {
            const status = e.statusCode || 500;
            res.status(status).json({ ok: false, error: e.message });
        }
    });

    return router;
}
