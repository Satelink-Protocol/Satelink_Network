// Shared search index (§14). Phase 5: a static index of real, published routes.
// Phase 13 swaps searchIndex() for Postgres FTS over the CMS index. Only real
// destinations — no fabricated results.
export type Hit = { title: string; href: string; type: string; excerpt?: string };

export const SEARCH_INDEX: Hit[] = [
  { title: "Machine Commerce", href: "/products/machine-commerce", type: "product", excerpt: "Infrastructure for software to discover, pay for, and settle machine-native services." },
  { title: "Trading Intelligence", href: "/products/trading-intelligence", type: "product", excerpt: "Derived statistics from public market data (SaaS analytics)." },
  { title: "RPC Infrastructure", href: "/products/rpc", type: "product" },
  { title: "x402 Machine Payments", href: "/products/x402", type: "product" },
  { title: "API Metering", href: "/products/metering", type: "product" },
  { title: "Pricing", href: "/pricing", type: "page" },
  { title: "Platform API", href: "/platform/api", type: "platform" },
  { title: "Enterprise", href: "/solutions/enterprise", type: "solution" },
  { title: "Commerce", href: "/solutions/commerce", type: "solution" },
  { title: "Developer quickstart", href: "/developers/quickstart", type: "developers" },
  { title: "Academy", href: "/academy", type: "learn" },
  { title: "Support center", href: "/support", type: "support" },
  { title: "Status", href: "/status", type: "page" },
  { title: "Documentation", href: "https://docs.satelink.network", type: "docs" },
];

export function searchIndex(query: string, limit = 8): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SEARCH_INDEX.map((h) => {
    const t = h.title.toLowerCase();
    let score = 0;
    if (t === q) score = 100;
    else if (t.startsWith(q)) score = 60;
    else if (t.includes(q)) score = 40;
    else if ((h.excerpt ?? "").toLowerCase().includes(q)) score = 20;
    else if (h.type.includes(q)) score = 10;
    return { h, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.h);
}
