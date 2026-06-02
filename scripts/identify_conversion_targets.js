#!/usr/bin/env node
/**
 * Identify Conversion Targets
 *
 * Fetches free tier usage from /system/free-tier and identifies
 * IPs/clients at >=90% of the daily limit — prime conversion targets.
 *
 * Usage:
 *   node scripts/identify_conversion_targets.js [--api-url <url>]
 *
 * Outputs to agent/memory/CONVERSIONS.md
 */

const fs = require('fs');
const path = require('path');

const API_URL = process.env.API_URL || process.argv.find(a => a.startsWith('--api-url='))?.split('=')[1] || 'http://localhost:8080';

async function main() {
  console.log(`[ConversionTargets] Fetching from ${API_URL}/system/free-tier`);

  try {
    const res = await fetch(`${API_URL}/system/free-tier`);
    if (!res.ok) {
      console.error(`[ConversionTargets] HTTP ${res.status}: ${res.statusText}`);
      process.exit(1);
    }

    const data = await res.json();
    if (!data.ok) {
      console.error(`[ConversionTargets] API error:`, data.error);
      process.exit(1);
    }

    const targets = data.conversion_targets || [];
    const stats = {
      activeIPs: data.activeIPs || 0,
      totalCalls: data.totalCalls || 0,
      nearLimitIPs: data.nearLimitIPs || 0,
      limit: data.limit || 500
    };

    console.log(`[ConversionTargets] Stats: ${stats.activeIPs} active IPs, ${stats.totalCalls} total calls today`);
    console.log(`[ConversionTargets] Found ${targets.length} conversion targets (>=90% usage)`);

    // Generate markdown report
    const now = new Date().toISOString();
    let md = `# Conversion Targets Report\n\n`;
    md += `**Generated:** ${now}\n`;
    md += `**API:** ${API_URL}\n\n`;
    md += `## Summary\n\n`;
    md += `- Active IPs today: ${stats.activeIPs}\n`;
    md += `- Total RPC calls today: ${stats.totalCalls.toLocaleString()}\n`;
    md += `- IPs near limit (>80%): ${stats.nearLimitIPs}\n`;
    md += `- Conversion targets (>=90%): ${targets.length}\n`;
    md += `- Daily free tier limit: ${stats.limit} calls\n\n`;

    if (targets.length === 0) {
      md += `## Targets\n\n`;
      md += `_No clients at >=90% of free tier limit._\n`;
    } else {
      md += `## Targets\n\n`;
      md += `| Client ID | Calls Today | % Used | Status | Action |\n`;
      md += `|-----------|-------------|--------|--------|--------|\n`;

      for (const t of targets) {
        const status = t.exceeded ? '🔴 EXCEEDED' : t.threshold_pct >= 95 ? '🟡 CRITICAL' : '🟢 HIGH';
        const action = t.exceeded
          ? 'Blocked — send upgrade email'
          : t.threshold_pct >= 95
            ? 'Immediate outreach'
            : 'Queue for batch outreach';
        md += `| ${t.client_id} | ${t.calls_today.toLocaleString()} | ${t.threshold_pct}% | ${status} | ${action} |\n`;
      }
    }

    md += `\n---\n\n`;
    md += `## Next Steps\n\n`;
    md += `1. **Exceeded users**: Send 402 response with deposit instructions (automatic)\n`;
    md += `2. **Critical (95%+)**: Proactive outreach before they hit limit\n`;
    md += `3. **High (90-95%)**: Include in weekly conversion campaign\n\n`;
    md += `## How to Convert\n\n`;
    md += `Users can upgrade by:\n`;
    md += `1. Depositing USDT to RevenueVault on Polygon Mainnet\n`;
    md += `2. Adding \`X-Wallet-Address\` header to RPC requests\n`;
    md += `3. Cost: $0.00003 per RPC call, minimum deposit $1.00\n`;

    // Write to CONVERSIONS.md
    const outputPath = path.join(__dirname, '..', 'agent', 'memory', 'CONVERSIONS.md');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, md);
    console.log(`[ConversionTargets] Written to ${outputPath}`);

    // Exit with count of targets
    process.exit(targets.length > 0 ? 0 : 0);

  } catch (err) {
    console.error(`[ConversionTargets] Error:`, err.message);
    process.exit(1);
  }
}

main();
