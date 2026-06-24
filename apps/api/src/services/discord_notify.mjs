/**
 * Discord Notification Service for Satelink MAL
 * Automated system notifications: revenue events, node health, claims, alerts.
 */

const ALERT_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const REVENUE_WEBHOOK = process.env.DISCORD_REVENUE_WEBHOOK_URL || ALERT_WEBHOOK;
const ENABLED = process.env.DISCORD_ALERTS_ENABLED === 'true';

const COLORS = {
  success: 0x408a71,
  warning: 0xa0a030,
  error: 0xc04040,
  info: 0x00d1ff,
  revenue: 0x00d1ff,
};

// Throttle: alert once per key per hour max
const alertThrottle = new Map();

function shouldSendAlert(key) {
  const last = alertThrottle.get(key) || 0;
  const now = Date.now();
  if (now - last < 3600000) return false;
  alertThrottle.set(key, now);
  return true;
}

async function sendEmbed(embed, webhook = ALERT_WEBHOOK) {
  if (!ENABLED || !webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Satelink MAL',
        avatar_url: 'https://app.satelink.network/favicon.ico',
        embeds: [embed],
      }),
    });
  } catch (e) {
    console.warn('[DISCORD] Notify failed:', e.message);
  }
}

export const discord = {
  async revenue(amountUsdt, method, chain) {
    await sendEmbed({
      title: '💰 Revenue Event',
      color: COLORS.revenue,
      fields: [
        { name: 'Amount', value: `$${parseFloat(amountUsdt).toFixed(6)} USDT`, inline: true },
        { name: 'Method', value: method || 'rpc', inline: true },
        { name: 'Chain', value: chain || 'polygon', inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Satelink Network · rpc.satelink.network' },
    }, REVENUE_WEBHOOK);
  },

  async claim(nodeId, amountUsdt, txHash) {
    await sendEmbed({
      title: '🎯 USDT Claim Processed',
      color: COLORS.success,
      description: `Node operator claimed **$${parseFloat(amountUsdt).toFixed(4)} USDT** on Polygon`,
      fields: [
        { name: 'Node', value: nodeId || 'unknown', inline: true },
        { name: 'Amount', value: `$${parseFloat(amountUsdt).toFixed(6)}`, inline: true },
        { name: 'TX', value: txHash ? `[View on Polygonscan](https://polygonscan.com/tx/${txHash})` : 'pending', inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Satelink Settlement · Polygon 137' },
    });
  },

  async deposit(apiKey, amountUsdt, tier) {
    await sendEmbed({
      title: '💳 Developer Deposit Received',
      color: COLORS.success,
      description: `New **${tier}** tier activation — $${parseFloat(amountUsdt).toFixed(2)} USDT deposited`,
      fields: [
        { name: 'Key', value: apiKey.slice(0, 16) + '...', inline: true },
        { name: 'Tier', value: tier, inline: true },
        { name: 'Amount', value: `$${parseFloat(amountUsdt).toFixed(2)} USDT`, inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'First revenue collected! 🚀' },
    });
  },

  async nodeStatus(nodeId, oldStatus, newStatus) {
    const isGood = newStatus === 'active';
    await sendEmbed({
      title: isGood ? '✅ Node Back Online' : '⚠️ Node Status Change',
      color: isGood ? COLORS.success : COLORS.warning,
      fields: [
        { name: 'Node', value: nodeId, inline: true },
        { name: 'From', value: oldStatus, inline: true },
        { name: 'To', value: newStatus, inline: true },
      ],
      timestamp: new Date().toISOString(),
    });
  },

  async rateLimitHit(ip, requestCount) {
    await sendEmbed({
      title: '🔄 Rate Limit Hit — Upgrade Opportunity',
      color: COLORS.info,
      description: 'Anonymous user hit the 500/day free limit. May upgrade to paid tier.',
      fields: [
        { name: 'IP Hash', value: ip.slice(0, 12) + '...', inline: true },
        { name: 'Requests', value: String(requestCount), inline: true },
        { name: 'Upgrade URL', value: 'https://app.satelink.network/satelink/os/plans', inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Potential paid conversion' },
    });
  },

  async dailySummary(stats) {
    await sendEmbed({
      title: '📊 Daily Satelink Summary',
      color: COLORS.info,
      fields: [
        { name: '📞 RPC Calls', value: (stats.calls || 0).toLocaleString(), inline: true },
        { name: '💰 Revenue', value: `$${parseFloat(stats.revenue || 0).toFixed(4)} USDT`, inline: true },
        { name: '🌐 Nodes', value: String(stats.nodes || 1), inline: true },
        { name: '🔑 API Keys', value: String(stats.apiKeys || 0), inline: true },
        { name: '⚡ Uptime', value: `${stats.uptime || 99.9}%`, inline: true },
        { name: '🏃 Rate Limits', value: String(stats.rateLimits || 0), inline: true },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Satelink MAL · Automated Daily Report' },
    });
  },

  async alert(title, message, severity = 'warning') {
    const key = `alert:${title}`;
    if (severity !== 'error' && !shouldSendAlert(key)) return;
    await sendEmbed({
      title: `${severity === 'error' ? '🚨' : '⚠️'} ${title}`,
      color: COLORS[severity] || COLORS.warning,
      description: message,
      timestamp: new Date().toISOString(),
      footer: { text: 'Satelink MAL Alert' },
    });
  },

  async rpcProviderAlert(provider, chain, errorRate, lastError) {
    const key = `provider:${provider}:${chain}`;
    if (!shouldSendAlert(key)) return;
    await sendEmbed({
      title: '🔴 RPC Provider Alert',
      color: COLORS.error,
      description: `**${provider}** (${chain}) has ${errorRate}% error rate`,
      fields: [
        { name: 'Last error', value: (lastError || 'unknown').slice(0, 100), inline: false },
        { name: 'Action', value: 'Provider automatically bypassed, using fallbacks', inline: false },
      ],
      timestamp: new Date().toISOString(),
    });
  },

  async test() {
    await sendEmbed({
      title: '🛰️ Satelink MAL Connected',
      color: COLORS.success,
      description: 'Discord notifications are working. System monitoring active.',
      fields: [
        { name: 'RPC', value: 'https://rpc.satelink.network', inline: false },
        { name: 'Dashboard', value: 'https://app.satelink.network', inline: false },
        { name: 'Status', value: 'All systems operational ✅', inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Machine Access Layer · Satelink Network' },
    });
  },

  isEnabled() {
    return ENABLED && !!ALERT_WEBHOOK;
  },
};

export default discord;
