/**
 * SettlementAnchorJob — Anchors closed epochs to Polygon blockchain.
 *
 * Pipeline:
 * 1. Query closed epochs without matching settlement_batches row
 * 2. Create settlement_batches row with status=pending
 * 3. Submit on-chain tx (USDT transfer or anchor proof)
 * 4. Update tx_hash, confirmed_at, status=confirmed
 *
 * Config (env):
 *   POLYGON_RPC_URL        - Polygon RPC (Amoy: https://rpc-amoy.polygon.technology)
 *   POLYGON_SIGNER_KEY     - Hot wallet private key
 *   POLYGON_USDT_ADDRESS   - USDT contract on target chain
 *   POLYGON_CHAIN_ID       - Chain ID (80002 = Amoy, 137 = Mainnet)
 *   TREASURY_ADDRESS       - Destination for platform share transfers
 *   SETTLEMENT_DRY_RUN     - Set to '1' to simulate without sending tx
 */

import { ethers } from 'ethers';
import crypto from 'crypto';

const ERC20_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
];

// Epochs below this revenue are skipped — anchoring dust epochs costs more
// in gas than the revenue being anchored.
//
// Default lowered 1.0 -> 0.01 (audit 2026-06-13): at 1.0, no epoch ever
// qualified (epochs run ~0.0025 USDT each) so settlement never fired. Override
// via the MIN_ANCHOR_REVENUE_USDT Railway env var:
//   - testing: set 0.0001 to force settlement on a single paid call
//   - at scale: raise to 0.50+ once gas-per-tx exceeds the per-epoch revenue
// NOTE: 0.01 still will not catch today's ~0.0025 USDT phantom epochs; it only
// fires once a paying wallet pushes an epoch's real revenue >= 0.01 USDT.
const MIN_ANCHOR_REVENUE_USDT = parseFloat(process.env.MIN_ANCHOR_REVENUE_USDT || '0.01');

// ── Carry-forward rollup (Customer Zero P0-5) ────────────────────────────────
// Per-epoch revenue (~0.0017 USDT) is permanently below any gas-economical
// anchor threshold, so individual anchoring NEVER fires (0 on-chain settlements
// ever). The rollup AGGREGATES consecutive sub-threshold epochs into ONE batch
// and anchors once the cumulative revenue crosses SETTLEMENT_BATCH_MIN_USDT —
// amortizing gas over many epochs. Gated by SETTLEMENT_ROLLUP so it ships dark
// and is reversible by unsetting the flag.
const ROLLUP_ENABLED = () => process.env.SETTLEMENT_ROLLUP === '1';
const BATCH_MIN_USDT = parseFloat(process.env.SETTLEMENT_BATCH_MIN_USDT || '0.50');
// Native-coin (MATIC/POL) floor the signer must hold before we broadcast — a
// funding precheck so we never broadcast a tx that will revert for gas.
const SIGNER_MIN_NATIVE = parseFloat(process.env.SETTLEMENT_SIGNER_MIN_NATIVE || '0.05');
// Hard cap on epochs per batch so a single rollup can't build an unbounded tx.
const BATCH_MAX_EPOCHS = parseInt(process.env.SETTLEMENT_BATCH_MAX_EPOCHS || '5000', 10);

export class SettlementAnchorJob {
    constructor(pool) {
        this.pool = pool;
        this.provider = null;
        this.wallet = null;
        this.contract = null;
        this.configured = false;

        this._init();
    }

    _init() {
        const rpcUrl = process.env.POLYGON_RPC_URL;
        const signerKey = process.env.POLYGON_SIGNER_KEY;
        const usdtAddress = process.env.POLYGON_USDT_ADDRESS;

        if (rpcUrl && signerKey && usdtAddress) {
            try {
                this.provider = new ethers.JsonRpcProvider(rpcUrl);
                this.wallet = new ethers.Wallet(signerKey, this.provider);
                this.contract = new ethers.Contract(usdtAddress, ERC20_ABI, this.wallet);
                this.configured = true;
                console.log(`[SettlementAnchor] Configured — signer: ${this.wallet.address.substring(0, 10)}...`);
            } catch (e) {
                console.warn(`[SettlementAnchor] Init failed: ${e.message}`);
            }
        } else {
            console.log('[SettlementAnchor] Not configured — running in simulation mode');
        }
    }

    async ensureTable() {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS settlement_batches (
                id SERIAL PRIMARY KEY,
                batch_id TEXT UNIQUE NOT NULL,
                epoch_id INTEGER,
                chain_id INTEGER,
                adapter_type TEXT,
                total_amount_usdt NUMERIC,
                item_count INTEGER,
                status TEXT DEFAULT 'pending',
                tx_hash TEXT,
                submitted_at BIGINT,
                confirmed_at BIGINT,
                error_message TEXT,
                created_at BIGINT NOT NULL
            )
        `);
        await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_settlement_batches_epoch ON settlement_batches(epoch_id)`).catch(() => {});
        await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_settlement_batches_status ON settlement_batches(status)`).catch(() => {});
        // Rollup columns (additive; a batch spans an epoch RANGE, not one epoch).
        for (const col of [
            'epoch_lo INTEGER', 'epoch_hi INTEGER', 'epoch_count INTEGER',
            'merkle_root TEXT', 'is_rollup BOOLEAN DEFAULT FALSE'
        ]) {
            await this.pool.query(`ALTER TABLE settlement_batches ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
        }
    }

    /**
     * PURE READ — build carry-forward rollup candidates without writing anything.
     * Walks closed, unanchored, revenue-bearing epochs in id order, accumulating
     * until the running total crosses BATCH_MIN_USDT → one candidate batch per
     * crossing. Remaining epochs below the next crossing are the carry-forward.
     */
    async buildCandidates() {
        const { rows } = await this.pool.query(`
            SELECT e.id,
                   COALESCE(e.total_revenue, 0)::numeric AS total_revenue,
                   COALESCE(e.platform_fee, 0)::numeric  AS platform_fee
            FROM epoch_ledger e
            LEFT JOIN settlement_batches sb ON sb.epoch_id = e.id
            WHERE e.status = 'CLOSED'
              AND sb.id IS NULL
              AND (e.tx_hash IS NULL OR e.tx_hash = '')
              AND COALESCE(e.total_revenue, 0) > 0
            ORDER BY e.id ASC
        `);

        const candidates = [];
        let acc = { ids: [], revenue: 0, platform: 0 };
        for (const r of rows) {
            acc.ids.push(r.id);
            acc.revenue += parseFloat(r.total_revenue);
            acc.platform += parseFloat(r.platform_fee);
            const full = acc.revenue >= BATCH_MIN_USDT || acc.ids.length >= BATCH_MAX_EPOCHS;
            if (full) {
                candidates.push(this._finalizeCandidate(acc));
                acc = { ids: [], revenue: 0, platform: 0 };
            }
        }
        // Leftover that did not reach the threshold = carry-forward to next run.
        const carryForward = {
            epoch_count: acc.ids.length,
            epoch_lo: acc.ids[0] ?? null,
            epoch_hi: acc.ids[acc.ids.length - 1] ?? null,
            total_revenue: +acc.revenue.toFixed(6),
            needed_to_anchor: +Math.max(0, BATCH_MIN_USDT - acc.revenue).toFixed(6),
        };
        return { candidates, carryForward, threshold_usdt: BATCH_MIN_USDT, total_unanchored_epochs: rows.length };
    }

    _finalizeCandidate(acc) {
        const lo = acc.ids[0], hi = acc.ids[acc.ids.length - 1];
        // Deterministic anchor proof over the included epochs.
        const leaves = acc.ids.map((id) => `${id}`).join(',');
        const merkle_root = ethers.keccak256(ethers.toUtf8Bytes(`SATELINK_ROLLUP:${lo}-${hi}:${leaves}`));
        return {
            epoch_lo: lo, epoch_hi: hi, epoch_ids: acc.ids,
            epoch_count: acc.ids.length,
            total_revenue: +acc.revenue.toFixed(6),
            platform_share: +acc.platform.toFixed(6),
            merkle_root,
        };
    }

    /**
     * Hot-wallet funding precheck — never broadcast a tx that will revert. Checks
     * native gas floor and (for value transfers) USDT balance. PURE READ.
     */
    async fundingPrecheck(platformShareUsdt = 0) {
        const reasons = [];
        if (!this.configured) {
            return { ok: false, configured: false, reasons: ['signer_not_configured'] };
        }
        let nativeBalance = null, usdtBalance = null;
        try {
            const wei = await this.provider.getBalance(this.wallet.address);
            nativeBalance = parseFloat(ethers.formatEther(wei));
            if (nativeBalance < SIGNER_MIN_NATIVE) reasons.push(`native_below_floor(${nativeBalance}<${SIGNER_MIN_NATIVE})`);
        } catch (e) { reasons.push(`native_balance_check_failed:${e.message}`); }

        if (platformShareUsdt > 0 && this.contract) {
            try {
                const decimals = parseInt(process.env.POLYGON_USDT_DECIMALS || '6', 10);
                const bal = await this.contract.balanceOf(this.wallet.address);
                usdtBalance = parseFloat(ethers.formatUnits(bal, decimals));
                if (usdtBalance < platformShareUsdt) reasons.push(`usdt_below_required(${usdtBalance}<${platformShareUsdt})`);
            } catch (e) { reasons.push(`usdt_balance_check_failed:${e.message}`); }
        }
        return { ok: reasons.length === 0, configured: true, signer: this.wallet.address, nativeBalance, usdtBalance, min_native: SIGNER_MIN_NATIVE, reasons };
    }

    /**
     * Anchor ONE rollup candidate. Funding-prechecked. In dry-run (or when
     * unconfigured) it records a simulated batch (status='simulated') and does
     * NOT broadcast. Real broadcast only when configured + funded + DRY_RUN off.
     */
    async anchorBatch(candidate, { dryRun } = {}) {
        const isDryRun = dryRun ?? (process.env.SETTLEMENT_DRY_RUN === '1');
        const batchId = `rollup_${candidate.epoch_lo}-${candidate.epoch_hi}_${crypto.randomBytes(4).toString('hex')}`;
        const chainId = parseInt(process.env.POLYGON_CHAIN_ID || '80002', 10);
        const now = Math.floor(Date.now() / 1000);

        await this.pool.query(`
            INSERT INTO settlement_batches
            (batch_id, epoch_id, epoch_lo, epoch_hi, epoch_count, chain_id, adapter_type,
             total_amount_usdt, item_count, merkle_root, is_rollup, status, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,'polygon_rollup',$7,$5,$8,TRUE,'pending',$9)
        `, [batchId, candidate.epoch_hi, candidate.epoch_lo, candidate.epoch_hi,
            candidate.epoch_count, chainId, candidate.platform_share, candidate.merkle_root, now]);

        // The rollup anchor is a 0-value data tx (merkle proof), so it needs only
        // native gas — not USDT. Operator USDT payout is a separate claims path.
        const funding = await this.fundingPrecheck(0);
        let txHash = null, errorMessage = null, status;

        if (isDryRun || !this.configured) {
            txHash = `0xSIM_${candidate.merkle_root.slice(2, 18)}`;
            status = 'simulated';
            console.log(`[SettlementRollup] DRY-RUN batch ${batchId} (${candidate.epoch_count} epochs, ${candidate.total_revenue} USDT) — would anchor root ${candidate.merkle_root.slice(0, 18)}…`);
        } else if (!funding.ok) {
            // RISK GATE: do not broadcast if the signer can't fund the tx.
            errorMessage = `funding_precheck_failed: ${funding.reasons.join(',')}`;
            status = 'blocked_unfunded';
            console.warn(`[SettlementRollup] ${batchId} BLOCKED — ${errorMessage}`);
        } else {
            try {
                const anchorData = ethers.toUtf8Bytes(`SATELINK_ROLLUP_${candidate.epoch_lo}_${candidate.epoch_hi}_${candidate.merkle_root}`);
                const tx = await this.wallet.sendTransaction({ to: this.wallet.address, value: 0, data: ethers.hexlify(anchorData) });
                const receipt = await tx.wait(1);
                if (!receipt || receipt.status !== 1) throw new Error('rollup anchor reverted');
                txHash = tx.hash;
                status = 'confirmed';
            } catch (e) {
                errorMessage = e.message;
                status = 'failed';
            }
        }

        const confirmedAt = status === 'confirmed' ? now : null;
        await this.pool.query(`
            UPDATE settlement_batches SET tx_hash=$1, submitted_at=$2, confirmed_at=$3, status=$4, error_message=$5 WHERE batch_id=$6
        `, [txHash, now, confirmedAt, status, errorMessage, batchId]);

        // Only a CONFIRMED real anchor marks the epoch range as settled on-chain.
        if (status === 'confirmed' && txHash) {
            await this.pool.query(
                `UPDATE epoch_ledger SET tx_hash=$1 WHERE id = ANY($2::int[])`,
                [txHash, candidate.epoch_ids]
            ).catch(e => console.warn(`[SettlementRollup] epoch_ledger sync failed: ${e.message}`));
        }
        return { batch_id: batchId, status, tx_hash: txHash, funding, epoch_count: candidate.epoch_count, total_revenue: candidate.total_revenue, error: errorMessage };
    }

    /** Rollup entry point — build candidates then anchor each. */
    async runRollup({ dryRun } = {}) {
        await this.ensureTable();
        const { candidates, carryForward, threshold_usdt, total_unanchored_epochs } = await this.buildCandidates();
        console.log(`[SettlementRollup] ${total_unanchored_epochs} unanchored epochs → ${candidates.length} batch candidate(s) @ ${threshold_usdt} USDT; carry-forward ${carryForward.total_revenue} USDT (${carryForward.epoch_count} epochs)`);
        const results = [];
        for (const c of candidates) results.push(await this.anchorBatch(c, { dryRun }));
        return { candidates: candidates.length, carryForward, results };
    }

    /**
     * Rollback path — re-open a batch's epochs for re-settlement (accounting
     * reversal; an on-chain tx itself is immutable). Sets epoch_ledger.tx_hash
     * NULL for the range and marks the batch 'reverted'.
     */
    async revertBatch(batchId) {
        const { rows } = await this.pool.query(`SELECT epoch_lo, epoch_hi, status FROM settlement_batches WHERE batch_id=$1`, [batchId]);
        if (!rows[0]) throw new Error(`batch ${batchId} not found`);
        const { epoch_lo, epoch_hi } = rows[0];
        await this.pool.query(`UPDATE epoch_ledger SET tx_hash=NULL WHERE id BETWEEN $1 AND $2`, [epoch_lo, epoch_hi]);
        await this.pool.query(`UPDATE settlement_batches SET status='reverted' WHERE batch_id=$1`, [batchId]);
        return { batch_id: batchId, reverted_range: [epoch_lo, epoch_hi] };
    }

    /**
     * Main entry point — find unanchored epochs and anchor them.
     */
    async run() {
        console.log('[SettlementAnchor] Running...');

        await this.ensureTable();

        // 1. Find closed epochs without settlement_batches
        const result = await this.pool.query(`
            SELECT e.id,
                   e.total_revenue    AS total_revenue_usdt,
                   e.platform_fee     AS platform_share_usdt,
                   e.closed_at        AS ends_at
            FROM epoch_ledger e
            LEFT JOIN settlement_batches sb ON sb.epoch_id = e.id
            WHERE e.status = 'CLOSED'
              AND sb.id IS NULL
              AND (e.tx_hash IS NULL OR e.tx_hash = '')
              AND e.total_revenue >= $1
            ORDER BY e.id ASC
            LIMIT 10
        `, [MIN_ANCHOR_REVENUE_USDT]);
        const unanchored = result.rows;

        // Report dust epochs explicitly so "0 anchored" is never silent
        const dustResult = await this.pool.query(`
            SELECT COUNT(*)::integer AS cnt
            FROM epoch_ledger e
            LEFT JOIN settlement_batches sb ON sb.epoch_id = e.id
            WHERE e.status = 'CLOSED'
              AND sb.id IS NULL
              AND e.total_revenue > 0
              AND e.total_revenue < $1
        `, [MIN_ANCHOR_REVENUE_USDT]);
        const dustCount = dustResult.rows[0]?.cnt || 0;
        if (dustCount > 0) {
            console.log(`[SettlementAnchor] ${dustCount} closed epochs below ${MIN_ANCHOR_REVENUE_USDT} USDT threshold — not worth gas, skipping`);
        }

        if (unanchored.length === 0) {
            console.log('[SettlementAnchor] No anchorable epochs found');
            return { processed: 0, skipped_below_threshold: dustCount };
        }

        console.log(`[SettlementAnchor] Found ${unanchored.length} unanchored epochs`);

        let processed = 0;
        for (const epoch of unanchored) {
            try {
                await this.anchorEpoch(epoch);
                processed++;
            } catch (e) {
                console.error(`[SettlementAnchor] Failed to anchor epoch ${epoch.id}:`, e.message);
            }
        }

        return { processed, skipped_below_threshold: dustCount };
    }

    /**
     * Anchor a single epoch to blockchain.
     */
    async anchorEpoch(epoch) {
        const batchId = `epoch_${epoch.id}_anchor_${crypto.randomBytes(4).toString('hex')}`;
        const chainId = parseInt(process.env.POLYGON_CHAIN_ID || '80002', 10);
        const now = Math.floor(Date.now() / 1000);
        const treasuryAddress = process.env.TREASURY_ADDRESS;

        // 2. Create pending settlement_batches row
        await this.pool.query(`
            INSERT INTO settlement_batches
            (batch_id, epoch_id, chain_id, adapter_type, total_amount_usdt, item_count, status, created_at)
            VALUES ($1, $2, $3, 'polygon_anchor', $4, 1, 'pending', $5)
        `, [batchId, epoch.id, chainId, epoch.platform_share_usdt || 0, now]);

        console.log(`[SettlementAnchor] Created batch ${batchId} for epoch ${epoch.id}`);

        // 3. Submit on-chain transaction
        const isDryRun = process.env.SETTLEMENT_DRY_RUN === '1';
        let txHash = null;
        let errorMessage = null;

        if (isDryRun || !this.configured) {
            // Simulation mode
            txHash = `0xSIM_${crypto.randomBytes(32).toString('hex')}`;
            console.log(`[SettlementAnchor] SIMULATION — would send ${epoch.platform_share_usdt} USDT to ${treasuryAddress}`);
        } else {
            // Real transaction
            try {
                const amount = epoch.platform_share_usdt || 0;
                const targetAddress = treasuryAddress && ethers.isAddress(treasuryAddress)
                    ? treasuryAddress
                    : this.wallet.address; // Fallback: self-transfer for testing

                // Try USDT transfer first, fallback to native MATIC anchor
                let usdtSuccess = false;
                if (amount > 0 && this.contract) {
                    try {
                        const decimals = parseInt(process.env.POLYGON_USDT_DECIMALS || '6', 10);
                        const roundedAmount = Math.floor(amount * 10 ** decimals) / 10 ** decimals;
                        const amountUnits = ethers.parseUnits(roundedAmount.toFixed(decimals), decimals);

                        const balance = await this.contract.balanceOf(this.wallet.address);
                        if (balance >= amountUnits) {
                            console.log(`[SettlementAnchor] Sending ${roundedAmount} USDT to ${targetAddress}`);
                            const tx = await this.contract.transfer(targetAddress, amountUnits);
                            const receipt = await tx.wait(1);
                            if (receipt && receipt.status === 1) {
                                txHash = tx.hash;
                                usdtSuccess = true;
                                console.log(`[SettlementAnchor] USDT TX confirmed: ${tx.hash}`);
                            }
                        }
                    } catch (usdtErr) {
                        console.warn(`[SettlementAnchor] USDT transfer failed: ${usdtErr.message}, falling back to MATIC anchor`);
                    }
                }

                // Fallback: send 0-value native tx as on-chain anchor proof
                if (!usdtSuccess) {
                    console.log(`[SettlementAnchor] Sending MATIC anchor tx for epoch ${epoch.id}`);
                    const anchorData = ethers.toUtf8Bytes(`SATELINK_EPOCH_${epoch.id}_${epoch.platform_share_usdt}`);
                    const tx = await this.wallet.sendTransaction({
                        to: targetAddress,
                        value: 0,
                        data: ethers.hexlify(anchorData)
                    });
                    console.log(`[SettlementAnchor] Anchor TX sent: ${tx.hash}`);
                    const receipt = await tx.wait(1);
                    if (!receipt || receipt.status !== 1) {
                        throw new Error('Anchor transaction reverted');
                    }
                    txHash = tx.hash;
                    console.log(`[SettlementAnchor] Anchor TX confirmed in block ${receipt.blockNumber}`);
                }
            } catch (e) {
                errorMessage = e.message;
                console.error(`[SettlementAnchor] TX failed: ${e.message}`);
            }
        }

        // 4. Update settlement_batches with result
        const confirmedAt = txHash && !errorMessage ? now : null;
        const status = errorMessage ? 'failed' : (txHash ? 'confirmed' : 'pending');

        await this.pool.query(`
            UPDATE settlement_batches
            SET tx_hash = $1, submitted_at = $2, confirmed_at = $3, status = $4, error_message = $5
            WHERE batch_id = $6
        `, [txHash, now, confirmedAt, status, errorMessage, batchId]);

        // Mirror the tx_hash into epoch_ledger so /api/settlement/history
        // (which reads epoch_ledger) shows the epoch as settled on-chain.
        if (status === 'confirmed' && txHash) {
            await this.pool.query(
                `UPDATE epoch_ledger SET tx_hash = $1 WHERE id = $2`,
                [txHash, epoch.id]
            ).catch(e => console.warn(`[SettlementAnchor] epoch_ledger sync failed: ${e.message}`));
        }

        console.log(`[SettlementAnchor] Epoch ${epoch.id} anchored — status: ${status}, tx: ${txHash?.substring(0, 20)}...`);

        return { epoch_id: epoch.id, batch_id: batchId, tx_hash: txHash, status };
    }

    /**
     * Manually anchor a specific epoch (for testing/admin).
     */
    async anchorEpochById(epochId) {
        const epochResult = await this.pool.query(`
            SELECT id,
                   total_revenue  AS total_revenue_usdt,
                   platform_fee   AS platform_share_usdt,
                   closed_at      AS ends_at
            FROM epoch_ledger WHERE id = $1 AND status = 'CLOSED'
        `, [epochId]);
        const epoch = epochResult.rows[0];

        if (!epoch) {
            throw new Error(`Epoch ${epochId} not found or not closed`);
        }

        // Check if already anchored
        const existingResult = await this.pool.query(
            "SELECT batch_id FROM settlement_batches WHERE epoch_id = $1",
            [epochId]
        );
        const existing = existingResult.rows[0];

        if (existing) {
            throw new Error(`Epoch ${epochId} already has settlement batch: ${existing.batch_id}`);
        }

        return this.anchorEpoch(epoch);
    }
}

/**
 * Factory for use in server.js or scheduler
 */
export function createSettlementAnchorJob(pool) {
    return new SettlementAnchorJob(pool);
}

export const anchorSchedulerStatus = {
    started: false,
    configured: false,
    interval_minutes: null,
    last_run_time: null,
    last_result: null,
    last_error: null,
    mode: null,
    min_anchor_revenue_usdt: MIN_ANCHOR_REVENUE_USDT,
    rollup_enabled: ROLLUP_ENABLED(),
    rollup_batch_min_usdt: BATCH_MIN_USDT,
    signer_min_native: SIGNER_MIN_NATIVE
};

/**
 * Periodic scheduler — the missing registration that left 1457 closed
 * epochs with tx_hash NULL. Refuses to run unconfigured rather than
 * writing simulated 0xSIM hashes into production tables.
 */
export function startSettlementAnchorScheduler(pool, intervalMinutes = 10) {
    const job = new SettlementAnchorJob(pool);
    anchorSchedulerStatus.configured = job.configured;
    anchorSchedulerStatus.interval_minutes = intervalMinutes;

    const dryRun = process.env.SETTLEMENT_DRY_RUN === '1';
    if (!job.configured && !dryRun) {
        console.warn('[SettlementAnchor] NOT STARTED — set POLYGON_RPC_URL, POLYGON_SIGNER_KEY and POLYGON_USDT_ADDRESS to enable on-chain epoch anchoring');
        return { job, started: false, stop: () => {} };
    }

    const runJob = async () => {
        anchorSchedulerStatus.last_run_time = Date.now();
        try {
            // Rollup path (carry-forward) when enabled; else legacy per-epoch anchor.
            const result = ROLLUP_ENABLED() ? await job.runRollup() : await job.run();
            anchorSchedulerStatus.last_result = result;
            anchorSchedulerStatus.mode = ROLLUP_ENABLED() ? 'rollup' : 'per_epoch';
            anchorSchedulerStatus.last_error = null;
        } catch (e) {
            anchorSchedulerStatus.last_error = e.message;
            console.error('[SettlementAnchor] Scheduled run failed:', e.message);
        }
    };

    runJob();
    const interval = setInterval(runJob, intervalMinutes * 60 * 1000);
    interval.unref?.();
    anchorSchedulerStatus.started = true;

    console.log(`[SettlementAnchor] Scheduler started — every ${intervalMinutes} minutes (min revenue: ${MIN_ANCHOR_REVENUE_USDT} USDT)`);
    return { job, started: true, runNow: runJob, stop: () => clearInterval(interval) };
}
