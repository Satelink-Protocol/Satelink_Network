/**
 * ConversionMonitorJob — autonomous developer-lead detector.
 *
 * Every 6 hours (and once immediately on start):
 *   1. GET /system/free-tier (10s timeout)
 *   2. Filter conversion_targets where exceeded=true AND classification='developer'
 *   3. Dedupe against an in-memory Map keyed by client_id (skip if alerted <24h ago)
 *   4. For each new lead, POST a Discord embed to DISCORD_WEBHOOK_URL
 *   5. Mark the client_id as alerted with a timestamp
 *
 * These are developer-classified IPs that have already hit the 402 free-tier
 * wall — the warmest conversion leads the network produces. Surfacing them
 * to Discord lets a human (or the growth loop) reach out before they churn to
 * a centralized provider.
 *
 * Config (env):
 *   DISCORD_WEBHOOK_URL  - Discord webhook for lead alerts (optional; logs only if unset)
 *   FREE_TIER_URL        - Override the source endpoint (default production)
 *
 * Never throws out of a scheduled run — everything is wrapped so the server
 * stays up even if the feed or Discord is down.
 */

const FREE_TIER_URL =
    process.env.FREE_TIER_URL || 'https://rpc.satelink.network/system/free-tier';
const FETCH_TIMEOUT_MS = 10_000;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

// Priority user-agent fragments — these clients are erpc / web3 SDK traffic,
// the highest-intent developer leads on the network.
const PRIORITY_AGENTS = ['erpc', 'web3.py', 'ethers', 'viem', 'wagmi'];
// Green for first-party web3 tooling, amber for everything else.
const PRIORITY_COLOR = 0x00ff88;
const STANDARD_COLOR = 0xffaa00;

export const conversionMonitorStatus = {
    started: false,
    interval_minutes: 360,
    last_run_time: null,
    last_leads_detected: 0,
    last_new_alerts: 0,
    last_error: null
};

// In-memory dedupe: client_id -> timestamp(ms) of last alert.
const alertedClients = new Map();

function isPriorityAgent(userAgent) {
    if (!userAgent) return false;
    const ua = String(userAgent).toLowerCase();
    return PRIORITY_AGENTS.some((frag) => ua.includes(frag));
}

async function fetchFreeTier() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(FREE_TIER_URL, { signal: controller.signal });
        if (!res.ok) {
            throw new Error(`free-tier endpoint returned ${res.status}`);
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function postDiscordLead(webhookUrl, lead) {
    const priority = isPriorityAgent(lead.user_agent);
    const embed = {
        title: '🎯 Developer Lead Detected',
        color: priority ? PRIORITY_COLOR : STANDARD_COLOR,
        fields: [
            { name: 'client_id', value: String(lead.client_id ?? 'unknown'), inline: true },
            { name: 'calls_today', value: String(lead.calls_today ?? 0), inline: true },
            { name: 'user_agent', value: String(lead.user_agent ?? 'unknown'), inline: true },
            { name: 'classification', value: String(lead.classification ?? 'unknown'), inline: true }
        ],
        footer: { text: 'Satelink Conversion Monitor' }
    };

    const body = {
        content: priority ? '**PRIORITY** — web3 SDK developer hit the 402 wall' : undefined,
        embeds: [embed]
    };

    const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        throw new Error(`Discord webhook returned ${res.status}`);
    }
}

/**
 * Run a single monitor cycle. Returns a result object; never throws.
 */
export async function runConversionMonitorCycle() {
    const now = Date.now();
    conversionMonitorStatus.last_run_time = now;
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    let leads = [];
    try {
        const data = await fetchFreeTier();
        const targets = Array.isArray(data?.conversion_targets) ? data.conversion_targets : [];
        leads = targets.filter(
            (t) => t && t.exceeded === true && t.classification === 'developer'
        );
    } catch (e) {
        conversionMonitorStatus.last_error = e.message;
        console.error(`[ConversionMonitor] Failed to fetch free-tier feed: ${e.message}`);
        return { ok: false, leads_detected: 0, new_alerts: 0, error: e.message };
    }

    let newAlerts = 0;
    for (const lead of leads) {
        const clientId = lead.client_id;
        if (!clientId) continue;

        const lastAlerted = alertedClients.get(clientId);
        if (lastAlerted && now - lastAlerted < DEDUPE_WINDOW_MS) {
            continue; // already alerted within the 24h window
        }

        if (webhookUrl) {
            try {
                await postDiscordLead(webhookUrl, lead);
            } catch (e) {
                console.error(`[ConversionMonitor] Discord alert failed for ${clientId}: ${e.message}`);
                continue; // don't mark as alerted if the post failed
            }
        } else {
            console.warn(
                `[ConversionMonitor] DISCORD_WEBHOOK_URL not set — lead logged only: ` +
                `${clientId} (${lead.calls_today} calls, ua=${lead.user_agent})`
            );
        }

        alertedClients.set(clientId, now);
        newAlerts++;
    }

    conversionMonitorStatus.last_leads_detected = leads.length;
    conversionMonitorStatus.last_new_alerts = newAlerts;
    conversionMonitorStatus.last_error = null;

    console.log(
        `[ConversionMonitor] Cycle complete: ${leads.length} leads detected, ${newAlerts} new alerts sent`
    );
    return { ok: true, leads_detected: leads.length, new_alerts: newAlerts };
}

/**
 * Start the periodic conversion monitor. Runs once immediately, then every
 * 6 hours. The interval is unref'd so it does not keep the process alive on
 * its own. Wrapped so a thrown error never crashes the server.
 *
 * @param {object} pool - pg pool (reserved for future persistence; unused today)
 */
export function startConversionMonitorScheduler(pool) {
    const runJob = () => {
        runConversionMonitorCycle().catch((e) => {
            conversionMonitorStatus.last_error = e.message;
            console.error('[ConversionMonitor] Scheduled run failed:', e.message);
        });
    };

    try {
        runJob(); // immediate first run
        const interval = setInterval(runJob, SIX_HOURS_MS);
        interval.unref?.();
        conversionMonitorStatus.started = true;
        console.log('[ConversionMonitor] Scheduler started — every 6 hours');
        return { started: true, runNow: runJob, stop: () => clearInterval(interval) };
    } catch (e) {
        conversionMonitorStatus.last_error = e.message;
        console.error('[ConversionMonitor] Failed to start scheduler:', e.message);
        return { started: false, stop: () => {} };
    }
}
