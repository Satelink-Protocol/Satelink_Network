/**
 * GasManagerJob — watches the settlement signer's POL (gas) balance.
 *
 * Every 30 minutes:
 *   1. Derive the signer address from POLYGON_SIGNER_KEY
 *   2. Read its native POL balance via POLYGON_RPC_URL
 *   3. If balance < threshold (default 1.0 POL): POST an alert to
 *      DISCORD_WEBHOOK_URL showing the address, current balance, and shortfall
 *   4. Log the result either way
 *   5. Record the check in the gas_alerts table
 *
 * If the signer is low on POL the settlement anchor cannot pay gas to submit
 * epoch settlement txs on-chain — this job is the early-warning for that.
 *
 * Config (env):
 *   POLYGON_SIGNER_KEY   - Hot wallet private key (signer that pays gas)
 *   POLYGON_RPC_URL      - Polygon RPC endpoint
 *   DISCORD_WEBHOOK_URL  - Discord webhook for low-balance alerts
 *   GAS_MIN_POL          - Alert threshold in POL (default 1.0)
 */

import { ethers } from 'ethers';

const DEFAULT_THRESHOLD_POL = parseFloat(process.env.GAS_MIN_POL || '1.0');

export const gasManagerStatus = {
    started: false,
    configured: false,
    interval_minutes: null,
    threshold_pol: DEFAULT_THRESHOLD_POL,
    signer_address: null,
    last_run_time: null,
    last_balance_pol: null,
    last_alerted: false,
    last_error: null
};

async function ensureGasAlertsTable(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS gas_alerts (
            id SERIAL PRIMARY KEY,
            signer_address TEXT NOT NULL,
            balance_pol NUMERIC NOT NULL,
            threshold_pol NUMERIC NOT NULL,
            alerted_at TIMESTAMPTZ DEFAULT now()
        )
    `);
}

async function postDiscordAlert(webhookUrl, { address, balancePol, thresholdPol }) {
    const shortfall = Math.max(0, thresholdPol - balancePol);
    const content =
        `⛽ **Satelink gas alert — settlement signer low on POL**\n` +
        `• Signer: \`${address}\`\n` +
        `• Balance: **${balancePol.toFixed(4)} POL**\n` +
        `• Threshold: ${thresholdPol.toFixed(4)} POL\n` +
        `• Shortfall: **${shortfall.toFixed(4)} POL**\n` +
        `Top up the signer or epoch settlement txs will fail to submit on-chain.`;

    const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
    });
    if (!res.ok) {
        throw new Error(`Discord webhook returned ${res.status}`);
    }
}

/**
 * Run a single gas check. Returns a result object; never throws on a
 * recoverable condition (it records the error and returns it).
 */
export async function runGasCheck(pool, options = {}) {
    const thresholdPol = options.thresholdPol ?? DEFAULT_THRESHOLD_POL;
    const signerKey = process.env.POLYGON_SIGNER_KEY;
    const rpcUrl = process.env.POLYGON_RPC_URL;
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    gasManagerStatus.last_run_time = Date.now();

    if (!signerKey || !rpcUrl) {
        const msg = 'POLYGON_SIGNER_KEY and POLYGON_RPC_URL must be set';
        gasManagerStatus.last_error = msg;
        console.warn(`[GasManager] Skipping check — ${msg}`);
        return { ok: false, configured: false, error: msg };
    }

    let address;
    try {
        address = new ethers.Wallet(signerKey).address;
    } catch (e) {
        const msg = `Invalid POLYGON_SIGNER_KEY: ${e.message}`;
        gasManagerStatus.last_error = msg;
        console.error(`[GasManager] ${msg}`);
        return { ok: false, configured: false, error: msg };
    }

    gasManagerStatus.signer_address = address;

    try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const balanceWei = await provider.getBalance(address);
        const balancePol = parseFloat(ethers.formatEther(balanceWei));
        const belowThreshold = balancePol < thresholdPol;

        gasManagerStatus.last_balance_pol = balancePol;
        gasManagerStatus.last_alerted = belowThreshold;
        gasManagerStatus.last_error = null;

        // Record the check, deduped: at most one gas_alerts row per signer per hour.
        await ensureGasAlertsTable(pool);
        const recent = await pool.query(
            `SELECT 1 FROM gas_alerts
             WHERE signer_address = $1 AND alerted_at >= now() - interval '1 hour'
             LIMIT 1`,
            [address]
        );
        if (recent.rowCount === 0) {
            await pool.query(
                `INSERT INTO gas_alerts (signer_address, balance_pol, threshold_pol)
                 VALUES ($1, $2, $3)`,
                [address, balancePol, thresholdPol]
            );
        }

        if (belowThreshold) {
            const shortfall = thresholdPol - balancePol;
            console.warn(
                `[GasManager] LOW BALANCE — signer ${address} has ${balancePol.toFixed(4)} POL ` +
                `(threshold ${thresholdPol} POL, shortfall ${shortfall.toFixed(4)} POL)`
            );
            if (webhookUrl) {
                try {
                    await postDiscordAlert(webhookUrl, { address, balancePol, thresholdPol });
                    console.warn('[GasManager] Discord alert sent');
                } catch (e) {
                    console.error(`[GasManager] Discord alert failed: ${e.message}`);
                }
            } else {
                console.warn('[GasManager] DISCORD_WEBHOOK_URL not set — alert not sent');
            }
        } else {
            console.log(
                `[GasManager] OK — signer ${address} has ${balancePol.toFixed(4)} POL ` +
                `(threshold ${thresholdPol} POL)`
            );
        }

        return {
            ok: true,
            configured: true,
            signer_address: address,
            balance_pol: balancePol,
            threshold_pol: thresholdPol,
            below_threshold: belowThreshold
        };
    } catch (e) {
        gasManagerStatus.last_error = e.message;
        console.error(`[GasManager] Check failed: ${e.message}`);
        return { ok: false, configured: true, signer_address: address, error: e.message };
    }
}

/**
 * Start the periodic gas-balance scheduler. Runs once immediately, then
 * every `intervalMinutes` (default 30). The interval is unref'd so it does
 * not keep the process alive on its own.
 */
export function startGasManagerScheduler(pool, intervalMinutes = 30) {
    const signerKey = process.env.POLYGON_SIGNER_KEY;
    const rpcUrl = process.env.POLYGON_RPC_URL;

    gasManagerStatus.interval_minutes = intervalMinutes;
    gasManagerStatus.configured = !!(signerKey && rpcUrl);

    if (!gasManagerStatus.configured) {
        console.warn('[GasManager] NOT STARTED — set POLYGON_SIGNER_KEY and POLYGON_RPC_URL to enable gas monitoring');
        return { started: false, stop: () => {} };
    }

    const runJob = () => {
        runGasCheck(pool).catch((e) => {
            gasManagerStatus.last_error = e.message;
            console.error('[GasManager] Scheduled run failed:', e.message);
        });
    };

    runJob();
    const interval = setInterval(runJob, intervalMinutes * 60 * 1000);
    interval.unref?.();
    gasManagerStatus.started = true;

    console.log(`[GasManager] Scheduler started — every ${intervalMinutes} minutes (threshold ${DEFAULT_THRESHOLD_POL} POL)`);
    return { started: true, runNow: runJob, stop: () => clearInterval(interval) };
}
