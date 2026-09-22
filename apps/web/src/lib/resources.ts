// Resources content (§8 blog / news / changelog / customer-stories). STRICT
// truth rule: seed ONLY real, shipped milestones — no fabricated posts, no
// invented authors or people. Author is the organization ("Satelink"), never a
// made-up person. Empty sections (customer-stories, and any with no entries)
// render an EmptyState and stay hidden from nav (§7). When the CMS is wired,
// these become the fallback and the CMS supplies the live set.
export type ResourceSection = "blog" | "news" | "changelog";

export interface ResourcePost {
  slug: string;
  section: ResourceSection;
  /** Blog category (§8 tabs). */
  category?: string;
  title: string;
  subtitle: string;
  /** ISO date. */
  date: string;
  /** Organization byline — never an invented individual. */
  author: string;
  /** Plain-text body paragraphs. */
  body: string[];
  /** Real external references for the claim. */
  links?: { label: string; href: string }[];
}

// Every entry below corresponds to a real shipped artifact (CLAUDE.md verified
// state, on-chain, or the public GitHub repo). Nothing here is invented.
export const POSTS: ResourcePost[] = [
  {
    slug: "x402-kit-open-source",
    section: "blog",
    category: "x402",
    title: "x402-kit: open-source payments for the machine economy",
    subtitle: "An MIT-licensed toolkit that implements the HTTP 402 handshake against the live mainnet rail.",
    date: "2026-07-14",
    author: "Satelink",
    body: [
      "x402-kit is a small, MIT-licensed toolkit that implements both sides of the HTTP 402 payment handshake: a service that answers unpaid requests with machine-readable payment requirements, and a client that reads those requirements and pays.",
      "It settles in USDC on Base (eip155:8453) and has proven mainnet transactions. Because payment travels in the HTTP request itself, a caller needs no account — a wallet is the only identity.",
      "The repository is public on GitHub. It is the same handshake Satelink's own endpoints use, so anything you build against it works against the live rail.",
    ],
    links: [
      { label: "x402-kit on GitHub", href: "https://github.com/Satelink-Protocol/x402-kit" },
      { label: "About x402", href: "/products/x402" },
    ],
  },
  {
    slug: "revenue-vault-v2-live",
    section: "news",
    title: "RevenueVaultV2 is live on Polygon",
    subtitle: "Per-call revenue now settles to a permissionless vault on Polygon mainnet.",
    date: "2026-07-11",
    author: "Satelink",
    body: [
      "Settlement now lands in RevenueVaultV2 at 0x577D3716d6Ad5b676d230f5409deF9838FABaCEF on Polygon (chain 137). It is permissionless and verifiable on Polygonscan.",
      "Revenue is aggregated per epoch and split 50% to node operators, 30% to the platform, and 20% to the distribution pool.",
    ],
    links: [
      { label: "RevenueVaultV2 on Polygonscan", href: "https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF" },
      { label: "Settlement", href: "/platform/settlement" },
    ],
  },
  {
    slug: "x402-rail-live",
    section: "changelog",
    title: "x402 payment rail live",
    subtitle: "Keyless pay-per-call in USDC on Base is enabled across the API.",
    date: "2026-07-10",
    author: "Satelink",
    body: [
      "The x402 rail is enabled: unpaid metered calls return HTTP 402 with machine-readable requirements, and callers pay keylessly in USDC on Base.",
    ],
    links: [{ label: "x402", href: "/platform/x402" }],
  },
  {
    slug: "x402-bundle-pricing",
    section: "changelog",
    title: "x402 bundle pricing",
    subtitle: "$0.10 buys 1,000 RPC calls with no account.",
    date: "2026-07-12",
    author: "Satelink",
    body: [
      "A discovery bundle lets a caller pre-buy RPC calls: $0.10 for 1,000 calls, paid keylessly over x402.",
    ],
    links: [{ label: "Pricing", href: "/pricing" }],
  },
  {
    slug: "revenue-vault-v2",
    section: "changelog",
    title: "RevenueVaultV2 deployed",
    subtitle: "New permissionless settlement vault on Polygon (chain 137).",
    date: "2026-07-11",
    author: "Satelink",
    body: [
      "RevenueVaultV2 (0x577D…BaCEF) replaces the legacy vault as the settlement target. Deposits are permissionless and settlement is verifiable on-chain.",
    ],
    links: [{ label: "Settlement", href: "/platform/settlement" }],
  },
];

export function postsBySection(section: ResourceSection): ResourcePost[] {
  return POSTS.filter((p) => p.section === section).sort((a, b) => b.date.localeCompare(a.date));
}

export function blogCategories(): string[] {
  return [...new Set(postsBySection("blog").map((p) => p.category).filter(Boolean) as string[])];
}

export function getPost(section: ResourceSection, slug: string): ResourcePost | undefined {
  return POSTS.find((p) => p.section === section && p.slug === slug);
}

// Customer stories: none published yet — the collection is intentionally empty
// so it stays hidden from nav until a real, permissioned story exists (§7).
export const CUSTOMER_STORIES: ResourcePost[] = [];
