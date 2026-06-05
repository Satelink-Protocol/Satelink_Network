#!/usr/bin/env node
/**
 * SAT-6: Free-tier conversion tracker
 *
 * Fetches /system/free-tier, writes CONVERSIONS.md, and appends a
 * timestamped row to agent/memory/REVENUE_LOG.md for trend tracking.
 *
 * Usage:
 *   node scripts/track_conversions.mjs [--api-url <url>]
 *
 * Run daily (e.g. via cron or Paperclip routine) to build a trend log.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONVERSIONS_FILE = path.join(ROOT, 'CONVERSIONS.md');
const REVENUE_LOG_FILE = path.join(ROOT, 'agent', 'memory', 'REVENUE_LOG.md');

const API_URL =
  process.env.API_URL ||
  process.argv.find(a => a.startsWith('--api-url='))?.split('=')[1] ||
  'https://rpc.satelink.network';

async function main() {
  console.log(`[SAT-6] Fetching ${API_URL}/system/free-tier`);

  const res = await fetch(`${API_URL}/system/free-tier`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

  const data = await res.json();
  const targets = data.conversion_targets ?? [];
  const exceeded = targets.filter(t => t.exceeded);
  const near = targets.filter(t => !t.exceeded);
  const stats = {
    activeIPs: data.activeIPs ?? 0,
    totalCalls: data.totalCalls ?? 0,
    nearLimitIPs: data.nearLimitIPs ?? 0,
    limit: data.limit ?? 500,
  };

  const now = new Date().toISOString();
  const date = now.slice(0, 10);

  const totalBlockedCalls = exceeded.reduce(
    (sum, t) => sum + Math.max(0, t.calls_today - stats.limit),
    0
  );
  const revenuePotential = (totalBlockedCalls * 0.00003).toFixed(2);

  const tier1 = exceeded.filter(t => t.calls_today > 10000);
  const tier2 = exceeded.filter(t => t.calls_today >= 2000 && t.calls_today <= 10000);
  const tier3 = exceeded.filter(t => t.calls_today < 2000);

  // ── Write CONVERSIONS.md ──────────────────────────────────────────────────

  const rows = targets
    .slice()
    .sort((a, b) => b.calls_today - a.calls_today)
    .map(t => {
      const label = t.exceeded ? 'BLOCKED' : 'NEAR-LIMIT';
      const dailyValue = (t.calls_today * 0.00003).toFixed(3);
      const action = t.exceeded
        ? 'Receiving 402 inline calldata — awaiting wallet deposit'
        : 'Monitor — approaching limit';
      return `| ${t.client_id} | ${t.calls_today.toLocaleString()} (${label}) | $${dailyValue} | ${action} |`;
    })
    .join('\n');

  const md = `# Conversion Targets Report

**Generated:** ${now} (SAT-6 daily tracker)
**API:** ${API_URL}/system/free-tier
**n8n:** Not configured — outreach list written here

## Summary

- **Date:** ${date}
- **Active IPs today:** ${stats.activeIPs.toLocaleString()}
- **Total RPC calls today:** ${stats.totalCalls.toLocaleString()}
- **IPs blocked (exceeded ${stats.limit}-call limit):** ${exceeded.length}
- **IPs near limit (>=90%):** ${near.length}
- **Total blocked calls (lost revenue):** ${totalBlockedCalls.toLocaleString()}
- **Potential daily revenue if converted:** $${revenuePotential}

## Revenue Potential by Tier

| Tier | Count | Daily calls | Daily revenue if converted |
|------|-------|-------------|----------------------------|
| Power (>10k/day) | ${tier1.length} | ${tier1.reduce((s, t) => s + t.calls_today, 0).toLocaleString()} | $${(tier1.reduce((s, t) => s + t.calls_today, 0) * 0.00003).toFixed(2)} |
| Heavy (2k-10k/day) | ${tier2.length} | ${tier2.reduce((s, t) => s + t.calls_today, 0).toLocaleString()} | $${(tier2.reduce((s, t) => s + t.calls_today, 0) * 0.00003).toFixed(2)} |
| Standard (<2k/day) | ${tier3.length} | ${tier3.reduce((s, t) => s + t.calls_today, 0).toLocaleString()} | $${(tier3.reduce((s, t) => s + t.calls_today, 0) * 0.00003).toFixed(2)} |

## Deposit Instructions for Outreach

IPs receive 402 responses with inline \`transactions[]\` calldata (SAT-237 deployed).

\`\`\`
You have exceeded the Satelink free tier (500 RPC calls/day).
To continue, deposit USDT to your account:

  1. GET https://rpc.satelink.network/credits/deposit/initiate?amount=1
     Returns ready-to-sign approve + deposit calldata for Polygon Mainnet

  2. Sign and broadcast both transactions (approve USDT, then deposit)

  3. Add header X-Wallet-Address: <your-wallet> to RPC requests

Cost: $0.00003/call  |  $1 min deposit = ~33,333 calls
Network: Polygon Mainnet (chainId: 137)
RevenueVault: 0x80AFEaC3B77CbeC1f7B9f24a50319DC72785DdA3
\`\`\`

## All Conversion Targets (${targets.length} total)

| Client ID | Calls Today | Daily Value | Action |
|-----------|-------------|-------------|--------|
${rows}

## Conversion Funnel Status

| Stage | Count | Notes |
|-------|-------|-------|
| Free-tier active | ${stats.activeIPs.toLocaleString()} | Making RPC calls today |
| Near limit (>=90%) | ${near.length} | Approaching ceiling |
| Blocked (402) | ${exceeded.length} | Hot leads — receiving inline calldata |
| Deposited wallet linked | 0 | Customer Zero not yet acquired |
| Paying (credits deducted) | 0 | No confirmed paid calls |

## Infrastructure Status

- **SAT-237**: 402 responses inline \`transactions[]\` — deployed
- **SAT-240**: Deposit flow verified end-to-end on Polygon Mainnet (2026-06-05)
- **deposit endpoint**: LIVE at \`GET /credits/deposit/initiate?amount=1\`
`;

  fs.writeFileSync(CONVERSIONS_FILE, md);
  console.log(`[SAT-6] CONVERSIONS.md written (${targets.length} targets)`);

  // ── Append trend row to REVENUE_LOG.md ───────────────────────────────────

  const trendRow = `\n${date} ${now.slice(11, 16)} | IPs:${stats.activeIPs} | NearLimit:${near.length} | Blocked:${exceeded.length} | PotentialRev/day:$${revenuePotential} | Source:track_conversions.mjs`;
  fs.appendFileSync(REVENUE_LOG_FILE, trendRow);
  console.log(`[SAT-6] Trend row appended to REVENUE_LOG.md`);

  // ── Console summary ───────────────────────────────────────────────────────

  console.log(`\n── Funnel snapshot ${date} ──`);
  console.log(`  Active IPs:      ${stats.activeIPs.toLocaleString()}`);
  console.log(`  Near-limit IPs:  ${near.length}`);
  console.log(`  Blocked IPs:     ${exceeded.length}`);
  console.log(`  Blocked calls:   ${totalBlockedCalls.toLocaleString()}`);
  console.log(`  Revenue/day if converted: $${revenuePotential}`);
  if (tier1.length) {
    console.log(`\n  Top blocked IP: ${tier1[0].client_id} — ${tier1[0].calls_today.toLocaleString()} calls/day`);
  }
}

main().catch(err => {
  console.error('[SAT-6] Fatal:', err.message);
  process.exit(1);
});
