import { logger } from '../monitoring/logger.js';
import { ethers } from 'ethers';

/**
 * Canonical Withdrawal Service
 * Single source of truth for all withdrawal creation.
 * Every withdrawal route MUST go through this service.
 */

// Polygon Mainnet USDT contract
const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const USDT_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)'
];

/**
 * Execute real USDT transfer on Polygon mainnet.
 * @param {string} toAddress - Destination wallet
 * @param {number} amountUsdt - Amount in USDT (decimal)
 * @returns {Promise<string>} Transaction hash
 */
async function executeUsdtTransfer(toAddress, amountUsdt) {
    const rpcUrl = process.env.POLYGON_RPC_URL ||
        'https://polygon-rpc.com';

    const signerKey = process.env.SETTLEMENT_EVM_SIGNER_PRIVATE_KEY;
    if (!signerKey) {
        throw new Error('SETTLEMENT_EVM_SIGNER_PRIVATE_KEY not configured');
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(signerKey, provider);
    const usdt = new ethers.Contract(USDT_ADDRESS, USDT_ABI, signer);

    // USDT on Polygon has 6 decimals
    const amount = ethers.parseUnits(amountUsdt.toFixed(6), 6);

    // Check balance first
    const balance = await usdt.balanceOf(signer.address);
    if (balance < amount) {
        throw new Error(`Insufficient USDT. Have: ${ethers.formatUnits(balance, 6)}, Need: ${amountUsdt}`);
    }

    logger.info({ toAddress, amountUsdt, signerBalance: ethers.formatUnits(balance, 6) },
        'USDT_TRANSFER: initiating on-chain transfer');

    const tx = await usdt.transfer(toAddress, amount, { gasLimit: 100000 });
    const receipt = await tx.wait();

    logger.info({ txHash: receipt.hash, toAddress, amountUsdt },
        'USDT_TRANSFER: completed successfully');

    return receipt.hash;
}

// In-memory per-wallet rate limit tracker
const withdrawRateMap = new Map(); // wallet -> [{ ts }]
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

/**
 * Check per-wallet withdrawal rate limit.
 * @param {string} wallet
 * @returns {{ allowed: boolean, remaining: number }}
 */
function checkRateLimit(wallet) {
    const now = Date.now();
    const key = wallet.toLowerCase();
    let entries = withdrawRateMap.get(key) || [];
    // Prune expired entries
    entries = entries.filter(e => now - e.ts < RATE_LIMIT_WINDOW_MS);
    withdrawRateMap.set(key, entries);
    return {
        allowed: entries.length < RATE_LIMIT_MAX,
        remaining: Math.max(0, RATE_LIMIT_MAX - entries.length)
    };
}

/**
 * Record a rate limit hit for a wallet.
 * @param {string} wallet
 */
function recordRateLimitHit(wallet) {
    const key = wallet.toLowerCase();
    const entries = withdrawRateMap.get(key) || [];
    entries.push({ ts: Date.now() });
    withdrawRateMap.set(key, entries);
}

/**
 * Execute a withdrawal through the canonical pipeline.
 *
 * @param {string} wallet - Destination wallet address
 * @param {number} amount - Amount in USDT
 * @param {object} opsEngine - OperationsEngine instance (has .db)
 * @param {object} [options]
 * @param {string} [options.sourceRoute] - The route that initiated this withdrawal
 * @returns {Promise<{ withdrawalId: number, status: string }>}
 */
export async function executeWithdrawal(wallet, amount, opsEngine, options = {}) {
    const sourceRoute = options.sourceRoute || 'unknown';

    // ── Validate wallet ──
    if (!wallet || typeof wallet !== 'string' || wallet.length < 10) {
        throw Object.assign(new Error('Invalid wallet address'), { statusCode: 400 });
    }

    // ── Validate amount ──
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0 || !Number.isFinite(numAmount)) {
        throw Object.assign(new Error('Amount must be a positive number'), { statusCode: 400 });
    }

    // ── Rate limit check ──
    const rateCheck = checkRateLimit(wallet);
    if (!rateCheck.allowed) {
        throw Object.assign(
            new Error('Too many withdrawal requests. Max 5 per hour per wallet.'),
            { statusCode: 429 }
        );
    }

    // ── Check withdrawals_paused flag ──
    try {
        const paused = await opsEngine.db.get(
            "SELECT value FROM system_config WHERE key = 'withdrawals_paused'"
        );
        if (paused && paused.value === '1') {
            throw Object.assign(new Error('Withdrawals are currently paused'), { statusCode: 503 });
        }
    } catch (e) {
        if (e.statusCode) throw e;
        // system_config table may not exist yet — allow withdrawal
    }

    // ── Check security_freeze flag ──
    try {
        const frozen = await opsEngine.db.get(
            "SELECT value FROM system_config WHERE key = 'security_freeze'"
        );
        if (frozen && frozen.value === '1') {
            throw Object.assign(new Error('System is in security freeze'), { statusCode: 503 });
        }
    } catch (e) {
        if (e.statusCode) throw e;
    }

    // ── Treasury consistency check (liquidity-aware) ──
    let status = 'PENDING';
    try {
        const treasuryRow = await opsEngine.db.get(
            "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM revenue_events_v2"
        );
        const completedRow = await opsEngine.db.get(
            "SELECT COALESCE(SUM(amount_usdt), 0) as total FROM withdrawals WHERE status = 'COMPLETED'"
        );
        const treasuryBalance = Number(treasuryRow?.total || 0);
        const completedWithdrawals = Number(completedRow?.total || 0);
        const availableLiquidity = treasuryBalance - completedWithdrawals;

        if (numAmount > availableLiquidity) {
            // Do NOT reject — mark as PENDING for manual review
            status = 'PENDING';
            logger.warn({
                wallet,
                amount: numAmount,
                availableLiquidity,
                sourceRoute
            }, 'WITHDRAW_LIQUIDITY_CHECK: requested amount exceeds available liquidity, marking PENDING');
        }
    } catch (e) {
        // Treasury check failed — default to PENDING (safe)
        status = 'PENDING';
    }

    // ── Insert withdrawal row ──
    const now = Math.floor(Date.now() / 1000);
    const r = await opsEngine.db.query(
        "INSERT INTO withdrawals (wallet, amount_usdt, status, created_at) VALUES (?,?,?,?)",
        [wallet, numAmount, status, now]
    );

    let withdrawalId = r.lastInsertRowid;
    if (!withdrawalId && r.length > 0) withdrawalId = r[0].id;
    withdrawalId = Number(withdrawalId) || 0;

    // ── Record rate limit hit ──
    recordRateLimitHit(wallet);

    // ── Execute real USDT transfer on Polygon mainnet ──
    let txHash = null;
    let polygonscanUrl = null;

    if (status !== 'PENDING') {
        try {
            txHash = await executeUsdtTransfer(wallet, numAmount);
            polygonscanUrl = `https://polygonscan.com/tx/${txHash}`;

            // Update withdrawal record with tx hash
            await opsEngine.db.query(
                "UPDATE withdrawals SET status = 'COMPLETED', tx_hash = ? WHERE id = ?",
                [txHash, withdrawalId]
            );
            status = 'COMPLETED';

            logger.info({
                wallet,
                amount: numAmount,
                withdrawalId,
                txHash,
                polygonscanUrl
            }, 'WITHDRAW_COMPLETED: on-chain USDT transfer successful');
        } catch (transferErr) {
            // Mark as FAILED, log the error
            await opsEngine.db.query(
                "UPDATE withdrawals SET status = 'FAILED', error_message = ? WHERE id = ?",
                [transferErr.message, withdrawalId]
            );
            status = 'FAILED';

            logger.error({
                wallet,
                amount: numAmount,
                withdrawalId,
                error: transferErr.message
            }, 'WITHDRAW_FAILED: on-chain transfer error');

            throw Object.assign(
                new Error(`USDT transfer failed: ${transferErr.message}`),
                { statusCode: 500, withdrawalId }
            );
        }
    }

    // ── Security logging ──
    logger.info({
        wallet,
        amount: numAmount,
        timestamp: now,
        withdrawalId,
        sourceRoute,
        status,
        txHash
    }, `WITHDRAW_REQUEST wallet=${wallet} amount=${numAmount} route=${sourceRoute}`);

    return { withdrawalId, status, txHash, polygonscanUrl };
}

/**
 * Rate-limit middleware for withdrawal endpoints.
 * Attach to any route that creates withdrawals.
 */
export function withdrawRateLimitMiddleware(req, res, next) {
    const wallet = req.body?.wallet;
    if (!wallet) return next(); // Let the handler return its own 400
    const rateCheck = checkRateLimit(wallet);
    if (!rateCheck.allowed) {
        return res.status(429).json({
            ok: false,
            error: 'Too many withdrawal requests. Max 5 per hour per wallet.',
            remaining: 0,
            retry_after_seconds: 3600
        });
    }
    next();
}
