/**
 * x402_upgrade_alert.js — M7 (T-29): Discord alert on any 402-upgrade
 * failure, rate-limited to 1/hour.
 *
 * "402-upgrade failure" = the exact catch block in
 * src/payments/x402/middleware.js that fails OPEN to the legacy (non-x402)
 * 402 body when the payable-402 upgrade throws — the 2026-08-20 outage class
 * (T-04) that went unnoticed for weeks precisely because nothing alerted on
 * it. That fail-open behavior is correct and untouched by this file; this
 * module only ever OBSERVES the failure, on its own timer, and never affects
 * what gets served — same "must never throw, never block serving" discipline
 * as every other fire-and-forget call in this codebase (shadow ledger
 * writes, usage tracking, etc.).
 *
 * Fire-and-forget by design: call `alertX402UpgradeFailure(message)` from
 * the catch block and never await it inline (a webhook call must never
 * delay a 402 response). Rate limit is in-process (one instance, matches
 * health_monitor.js's own in-memory cooldown pattern) — acceptable for an
 * alert whose purpose is "a human should look at this soon", not exactly-once
 * delivery guarantees.
 */

const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
let lastAlertAt = 0;
let suppressedSinceLastAlert = 0;

async function sendDiscordAlert(message) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Satelink x402 Monitor',
        embeds: [
          {
            title: '🚨 x402 402-upgrade failure',
            description: message,
            color: 0xff6600,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (err) {
    console.error('[x402UpgradeAlert] Discord webhook call failed:', err.message);
  }
}

/**
 * Record a 402-upgrade failure and, at most once per hour, send a Discord
 * alert. Never throws — a monitoring failure must never surface to the
 * request that triggered it (see middleware.js's own fail-open comment).
 */
export function alertX402UpgradeFailure(errorMessage) {
  try {
    const now = Date.now();
    if (now - lastAlertAt < ALERT_COOLDOWN_MS) {
      suppressedSinceLastAlert += 1;
      return;
    }
    const suppressedNote =
      suppressedSinceLastAlert > 0
        ? `\n(${suppressedSinceLastAlert} more occurrence(s) suppressed in the last hour)`
        : '';
    lastAlertAt = now;
    suppressedSinceLastAlert = 0;
    sendDiscordAlert(`Error: ${errorMessage}${suppressedNote}`).catch(() => {});
  } catch {
    /* never let alerting break the caller */
  }
}

// Exposed for tests only.
export const __internal = {
  reset() {
    lastAlertAt = 0;
    suppressedSinceLastAlert = 0;
  },
};
