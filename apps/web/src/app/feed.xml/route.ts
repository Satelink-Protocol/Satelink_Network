// RSS feed of notable platform changes — mirrors docs/changelog content.
// Static entries by design: each release edits this list alongside the
// changelog page, so the feed never claims anything the docs don't.

const BASE = "https://satelink.network";

const ENTRIES = [
  {
    title: "Data truth & public platform overhaul",
    date: "2026-07-07T00:00:00Z",
    link: `${BASE}/docs/changelog`,
    description:
      "Every dashboard metric audited against production and corrected at the API layer; documentation portal launched at docs.satelink.network; homepage refreshed to verified-only claims.",
  },
  {
    title: "RevenueVault V2 + frictionless onboarding",
    date: "2026-07-05T00:00:00Z",
    link: `${BASE}/docs/changelog`,
    description:
      "Permissionless USDT deposits on RevenueVault V2, one-click MetaMask API keys, self-contained HTTP 402 machine onboarding, native eRPC provider adapter.",
  },
  {
    title: "Admin command center & observer API",
    date: "2026-06-26T00:00:00Z",
    link: `${BASE}/docs/changelog`,
    description:
      "18 read-only observer endpoints powering the operator NOC: executive summary, revenue, demand radar, network health, treasury, customers, observability.",
  },
  {
    title: "Machine access foundation",
    date: "2026-05-14T00:00:00Z",
    link: `${BASE}/docs/changelog`,
    description:
      "Machine Access control plane: hashed token storage, scoped auth, audit chaining, replay protection.",
  },
];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function GET() {
  const items = ENTRIES.map(
    (e) => `    <item>
      <title>${escapeXml(e.title)}</title>
      <link>${e.link}</link>
      <guid isPermaLink="false">${e.link}#${e.date}</guid>
      <pubDate>${new Date(e.date).toUTCString()}</pubDate>
      <description>${escapeXml(e.description)}</description>
    </item>`
  ).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Satelink Network — Changelog</title>
    <link>${BASE}/docs/changelog</link>
    <description>Notable changes to the Satelink DePIN RPC network.</description>
    <language>en</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
