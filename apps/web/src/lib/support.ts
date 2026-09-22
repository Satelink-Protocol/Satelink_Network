// Support content (§8). Collections + articles seeded from real docs/FAQ facts
// only. Empty collections are hidden (§8). No fabricated articles or metrics;
// bodies restate established, verifiable facts.
export interface SupportCollection {
  slug: string;
  name: string;
  description: string;
}

export interface SupportArticle {
  slug: string;
  collection: string;
  title: string;
  body: string[];
  related?: { label: string; href: string }[];
}

export const COLLECTIONS: SupportCollection[] = [
  { slug: "getting-started", name: "Getting started", description: "Discover services and make your first call." },
  { slug: "api", name: "API", description: "Authentication, endpoints, and errors." },
  { slug: "payments", name: "Payments", description: "How the payment rails work." },
  { slug: "x402", name: "x402", description: "The keyless payment handshake." },
  { slug: "credits", name: "Credits", description: "Prepaid balances and metering." },
  { slug: "trading-intelligence", name: "Trading Intelligence", description: "Derived metrics and their limitations." },
  { slug: "rpc", name: "RPC", description: "The metered Polygon RPC gateway." },
  { slug: "security", name: "Security", description: "Keys, limits, and settlement." },
];

export const ARTICLES: SupportArticle[] = [
  { slug: "do-i-need-an-account", collection: "getting-started", title: "Do I need an account to start?", body: ["No. Discovery and pricing are public JSON — read the catalog with no signup.", "You need an API key or an x402 wallet only when you make a paid call."], related: [{ label: "Quickstart", href: "/developers/quickstart" }] },
  { slug: "how-discovery-works", collection: "getting-started", title: "How discovery works", body: ["Every service is listed in /.well-known/satelink.json, which points to the machine-readable pricing. The Trading Intelligence catalog at /v1/intelligence lists each metric and its per-call price."], related: [{ label: "API surface", href: "/developers/api" }] },
  { slug: "authentication", collection: "api", title: "How do I authenticate?", body: ["Account callers present an API key in the X-API-Key header. Machine callers can stay keyless on the x402 rail, where the payment itself carries the identity via an X-Payment header."], related: [{ label: "Machine identity", href: "/platform/machine-identity" }] },
  { slug: "errors-and-limits", collection: "api", title: "Errors and rate limits", body: ["The API uses standard HTTP status codes. A metered call that has not been paid returns 402 Payment Required with machine-readable requirements; 429 indicates a rate limit. Exact values are in the API reference."] },
  { slug: "payment-rails", collection: "payments", title: "Which payment rails are supported?", body: ["Three rails: prepaid credits (a USDT deposit), keyless x402 (USDC on Base), and — for Trading Intelligence only — a one-time card/UPI Starter Pack processed by Dodo. x402 and USDT are a separate crypto rail Dodo never processes."], related: [{ label: "Pricing", href: "/pricing" }] },
  { slug: "what-is-x402", collection: "x402", title: "What is x402?", body: ["x402 is a keyless payment handshake over HTTP. A service answers an unpaid request with 402 and machine-readable requirements; the caller pays in USDC on Base and retries. No account is needed — the wallet is the identity."], related: [{ label: "x402", href: "/products/x402" }] },
  { slug: "how-credits-work", collection: "credits", title: "How do credits work?", body: ["You deposit USDT once and every paid call draws down from that balance at the flat per-call rate. Credits are shared across the metered products you call. When the balance is exhausted, further paid calls return 402 until you top up."], related: [{ label: "Metering", href: "/products/metering" }] },
  { slug: "derived-vs-model", collection: "trading-intelligence", title: "Derived vs. model metrics", body: ["Derived metrics are computed directly from public market data. A model/proxy metric — such as liquidation clusters — infers a likely value from public data and carries explicit limitations. Trading Intelligence is a research input, not investment advice."], related: [{ label: "Trading Intelligence", href: "/products/trading-intelligence" }] },
  { slug: "which-chain", collection: "rpc", title: "Which chain does RPC support?", body: ["Polygon PoS mainnet (chainId 137). Requests are standard Ethereum JSON-RPC, billed per call with no subscription."], related: [{ label: "RPC", href: "/products/rpc" }] },
  { slug: "spend-controls", collection: "security", title: "How is spend bounded?", body: ["Spend cannot exceed your prepaid balance, and per-key limits cap exposure further. Every settled call produces an on-chain-verifiable receipt; settlement lands in a permissionless Polygon vault."], related: [{ label: "Settlement", href: "/platform/settlement" }] },
];

export function articlesInCollection(slug: string): SupportArticle[] {
  return ARTICLES.filter((a) => a.collection === slug);
}
/** Collections that actually have ≥1 article (empty ones are hidden). */
export function nonEmptyCollections(): SupportCollection[] {
  return COLLECTIONS.filter((c) => articlesInCollection(c.slug).length > 0);
}
export function getCollection(slug: string): SupportCollection | undefined {
  return COLLECTIONS.find((c) => c.slug === slug);
}
export function getArticle(collection: string, slug: string): SupportArticle | undefined {
  return ARTICLES.find((a) => a.collection === collection && a.slug === slug);
}
export function searchArticles(q: string): SupportArticle[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  return ARTICLES.filter((a) => (a.title + " " + a.body.join(" ")).toLowerCase().includes(t));
}
