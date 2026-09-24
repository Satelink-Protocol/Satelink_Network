// Leadership — consent-gated. An entry renders on /company/leadership ONLY
// when the founder sets `published: true` after the person has consented.
// Never add residential addresses, personal phone numbers, DIN or signatures.

export type Person = {
  name: string;
  role: string;
  bio?: string;
  published: boolean;
};

export const people: Person[] = [
  { name: "Jakuraa", role: "Founder", published: false },
  { name: "Ramasamy Balasubramanian Pradeep", role: "Director", published: false },
  { name: "Sivakumar Kuzhandaivelu", role: "Director", published: false },
];

export const publishedPeople = () => people.filter((p) => p.published);

// News — real, dated, sourced items only. Empty is a valid state.
export type NewsItem = {
  slug: string;
  date: string; // ISO
  title: string;
  summary: string;
  body: string[];
  source?: { label: string; href: string };
};

export const news: NewsItem[] = [
  {
    slug: "satelink-x402-machine-payments",
    date: "2026-07-09",
    title: "Satelink accepts machine payments over x402",
    summary:
      "Autonomous agents can now pay Satelink per request in USDC on Base, inside the HTTP request itself.",
    body: [
      "Satelink now answers unpaid requests with HTTP 402 and machine-readable payment requirements. A caller pays in USDC on Base and retries; no account or API key is needed.",
      "The rail was proven end to end with test settlements on Base mainnet in July 2026.",
    ],
    source: { label: "satelink.network", href: "https://satelink.network" },
  },
  {
    slug: "revenue-vault-v2",
    date: "2026-07-05",
    title: "Satelink moves prepaid credits to a new vault contract on Polygon",
    summary: "Prepaid USDT credits are now deposited to RevenueVaultV2, which accepts deposits from any wallet.",
    body: [
      "Satelink's prepaid-credit rail now uses RevenueVaultV2 on Polygon PoS. Deposits are permissionless: any wallet can fund credits without an allow-list.",
    ],
    source: {
      label: "Contract on Polygonscan",
      href: "https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF",
    },
  },
];

export const sortedNews = () => [...news].sort((a, b) => b.date.localeCompare(a.date));
export const getNews = (slug: string) => news.find((n) => n.slug === slug);

// Careers — open roles. Empty means the page shows its designed empty state.
export type Role = { slug: string; title: string; location: string; summary: string };
export const openRoles: Role[] = [];
