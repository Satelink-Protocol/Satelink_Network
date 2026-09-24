// Single source of truth for the product catalog surfaced across the public
// site (home grid, /product/overview + its interactive selector, the five
// /products/* pages, /platform/*, and /pricing). Every fact here is audited
// ground truth (CLAUDE.md 2026-07-16 + apps/api routes) — no invented numbers,
// no invented customers. Live per-call prices for Trading Intelligence come
// from getCatalog() at render; the flat machine-commerce rate and the x402
// bundle are documented constants (truth rule §2.1).
import { CANONICAL_URL, DISCOVERY, SITES } from "@satelink/content";

/** The flat machine-commerce rate, in USD per RPC call (CLAUDE.md verified). */
export const FLAT_RATE_USD = 0.00003;
/** The x402 discovery bundle: $0.10 buys 1,000 RPC calls. */
export const X402_BUNDLE = { priceUsd: 0.1, calls: 1000 } as const;
/** The one-time Trading-Intelligence starter pack (Dodo card/UPI). */
export const STARTER_PACK_USD = 9.99;

export type PaymentRailId = "credits" | "x402" | "usdt" | "dodo";

export type ProductSlug =
  | "machine-commerce"
  | "trading-intelligence"
  | "rpc"
  | "x402"
  | "metering";

export interface ProductRail {
  id: PaymentRailId;
  label: string;
  detail: string;
  /** Dodo (card/UPI) only appears on Trading Intelligence surfaces (§9). */
  dodo: boolean;
}

export interface ProductFacts {
  slug: ProductSlug;
  /** Canonical route (from @satelink/content CANONICAL_URL). */
  href: string;
  name: string;
  /** ≤50-word answer-first definition for the GEO entity block (§12). */
  definition: string;
  /** One-line tagline for cards/grids. */
  tagline: string;
  /** Whether this is a crypto rail vs. a commercial product line. */
  category: "product" | "rail" | "infrastructure";
  /** Real endpoint / discovery reference, when the product has one. */
  endpoint?: string;
  discovery?: string;
  docs: string;
  /** Auth mechanisms accepted. */
  auth: ("api_key" | "x402")[];
  rails: ProductRail[];
  /** Human-readable price line (live-catalog products override at render). */
  priceLine: string;
  /** Three answer-first value cards. */
  value: { title: string; body: string }[];
  /** Capability bullets. */
  capabilities: string[];
  /** A real, copyable example request. */
  exampleRequest: string;
  /** Grouped FAQ. */
  faq: { group: string; items: { q: string; a: string }[] }[];
}

const RAIL = {
  credits: { id: "credits", label: "Prepaid credits", detail: "Deposit USDT once; calls draw down a balance.", dodo: false },
  x402: { id: "x402", label: "x402 (pay-per-call)", detail: "USDC on Base (eip155:8453) — keyless, per request.", dodo: false },
  usdt: { id: "usdt", label: "USDT deposit", detail: "USDT on Polygon (137) into RevenueVaultV2.", dodo: false },
  dodo: { id: "dodo", label: "Card / UPI (Dodo)", detail: "One-time credit-pack purchase, processed by Dodo.", dodo: true },
} satisfies Record<PaymentRailId, ProductRail>;

export const PRODUCTS: Record<ProductSlug, ProductFacts> = {
  "machine-commerce": {
    slug: "machine-commerce",
    href: CANONICAL_URL.machineCommerce,
    name: "Machine Commerce",
    category: "product",
    definition:
      "Machine commerce is software paying software for services. Satelink is the infrastructure a machine uses to discover a priced API, pay for it without a human, call it, and settle the payment on-chain.",
    tagline: "The full discover → pay → call → settle loop for autonomous buyers.",
    endpoint: `${SITES.api.origin}/rpc/polygon`,
    discovery: DISCOVERY.wellKnown,
    docs: `${SITES.docs.origin}`,
    auth: ["api_key", "x402"],
    rails: [RAIL.credits, RAIL.x402, RAIL.usdt],
    priceLine: `$${FLAT_RATE_USD} per call (flat)`,
    value: [
      { title: "Discover without a signup", body: "Agents read a public JSON catalog and machine-readable pricing before they ever authenticate." },
      { title: "Pay without a human", body: "A 402 response quotes the price; the machine pays with x402, a USDT deposit, or a prepaid balance." },
      { title: "Settle transparently", body: "Revenue aggregates per epoch and settles on-chain to a verifiable Polygon vault." },
    ],
    capabilities: [
      "Public discovery via /.well-known/satelink.json",
      "HTTP 402 payment-required flow with machine-readable requirements",
      "Per-call metering at a flat rate",
      "On-chain settlement to RevenueVaultV2 (Polygon 137)",
      "API-key and keyless x402 authentication",
    ],
    exampleRequest: `curl ${SITES.api.origin}/.well-known/satelink.json`,
    faq: [
      { group: "About the offering", items: [
        { q: "What is machine commerce?", a: "It is software buying services from other software: a machine discovers a priced API, pays for it programmatically, calls it, and the payment settles on-chain — no human in the loop." },
        { q: "Do I need an account to start?", a: "No. Discovery and pricing are public JSON. You need a key or an x402 wallet only when you make a paid call." },
      ] },
      { group: "Trust and safety", items: [
        { q: "What stops an agent from paying a price that isn't real?", a: "The price is quoted by the service in a signed 402 response, per-key spending limits apply, and every settled call produces an on-chain-verifiable receipt." },
      ] },
    ],
  },

  "trading-intelligence": {
    slug: "trading-intelligence",
    href: CANONICAL_URL.tradingIntelligence,
    name: "Trading Intelligence",
    category: "product",
    definition:
      "Trading Intelligence is a metered analytics API returning derived statistics from public market data — funding-rate, open-interest, liquidation-cluster and microstructure metrics. It is a research input, not investment advice.",
    tagline: "Derived market analytics that agents and teams buy per call.",
    endpoint: DISCOVERY.catalog,
    discovery: DISCOVERY.catalog,
    docs: `${SITES.docs.origin}`,
    auth: ["api_key", "x402"],
    rails: [RAIL.dodo, RAIL.x402, RAIL.usdt],
    priceLine: `$0.01 per call · Starter Pack $${STARTER_PACK_USD}`,
    value: [
      { title: "Derived, not directional", body: "Every metric is a statistic computed from public market data — never a buy or sell instruction." },
      { title: "Buy the way you build", body: "A one-time Starter Pack over card/UPI, or pay per call on the crypto rail — your choice." },
      { title: "Read before you rely", body: "Model/proxy metrics carry explicit limitations so you know what the number is and isn't." },
    ],
    capabilities: [
      "Four derived metrics from the live catalog",
      "Sample responses for every metric",
      "Model-vs-derived labelling and limitations",
      "Per-call pricing on the crypto rail",
      "One-time Starter Pack via card/UPI",
    ],
    exampleRequest: `curl ${DISCOVERY.catalog}`,
    faq: [
      { group: "About the offering", items: [
        { q: "Is this investment advice?", a: "No. Trading Intelligence returns derived statistics from public market data. It is a research input and Satelink never takes custody of funds." },
        { q: "What is the difference between a derived and a model metric?", a: "Derived metrics are computed directly from observed public data. Model/proxy metrics (e.g. liquidation clusters) infer a likely value and carry explicit limitations." },
      ] },
      { group: "Billing and payments", items: [
        { q: "How is the Starter Pack processed?", a: `The $${STARTER_PACK_USD} Starter Pack is a one-time purchase processed by Dodo (card/UPI). x402 and USDT are a separate crypto rail that Dodo never processes.` },
      ] },
    ],
  },

  rpc: {
    slug: "rpc",
    href: CANONICAL_URL.rpc,
    name: "RPC Infrastructure",
    category: "infrastructure",
    definition:
      "Satelink RPC is a metered gateway to blockchain RPC methods (eth_getBalance, eth_call, …) on Polygon PoS. Machines and agents pay per call over a crypto rail — no subscription, no seat.",
    tagline: "Metered blockchain RPC that machines pay for per call.",
    endpoint: `${SITES.api.origin}/rpc/polygon`,
    discovery: DISCOVERY.wellKnown,
    docs: `${SITES.docs.origin}`,
    auth: ["api_key", "x402"],
    rails: [RAIL.credits, RAIL.x402, RAIL.usdt],
    priceLine: `$${FLAT_RATE_USD} per call · $${X402_BUNDLE.priceUsd} = ${X402_BUNDLE.calls.toLocaleString()} calls (x402)`,
    value: [
      { title: "Pay per call", body: "A flat per-call rate — no monthly minimum, no seat licence, no commitment." },
      { title: "Keyless with x402", body: "One x402 bundle buys 1,000 calls with no account: discover, pay, call." },
      { title: "On Polygon PoS", body: "Standard JSON-RPC methods proxied to Polygon mainnet (chain 137)." },
    ],
    capabilities: [
      "Standard Ethereum JSON-RPC methods on Polygon PoS",
      "Flat per-call metering",
      "Keyless x402 bundle purchase",
      "API-key access for accounts",
      "Public discovery and machine-readable pricing",
    ],
    exampleRequest: `curl -X POST ${SITES.api.origin}/rpc/polygon \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'`,
    faq: [
      { group: "About the offering", items: [
        { q: "Which chain is supported?", a: "Polygon PoS mainnet (chainId 137). Requests are standard Ethereum JSON-RPC." },
        { q: "Is there a subscription?", a: "No. RPC is billed per call. You can pay from a prepaid balance or keylessly with an x402 bundle." },
      ] },
      { group: "Getting started", items: [
        { q: "Can I try it without an account?", a: "Yes — pay for one x402 bundle and call the endpoint; no signup is required." },
      ] },
    ],
  },

  x402: {
    slug: "x402",
    href: CANONICAL_URL.x402,
    name: "x402 Machine Payments",
    category: "rail",
    definition:
      "x402 is the keyless payment rail behind Satelink: a service answers an unpaid request with HTTP 402 and machine-readable requirements, the caller pays in USDC on Base, and the request completes — no account, no checkout.",
    tagline: "HTTP-native, keyless payments in USDC on Base.",
    endpoint: `${SITES.api.origin}/rpc/polygon`,
    discovery: DISCOVERY.wellKnown,
    docs: "https://github.com/Satelink-Protocol/x402-kit",
    auth: ["x402"],
    rails: [RAIL.x402],
    priceLine: `USDC on Base (eip155:8453) · $${X402_BUNDLE.priceUsd} = ${X402_BUNDLE.calls.toLocaleString()} calls`,
    value: [
      { title: "No account required", body: "Payment travels in the HTTP request itself — a wallet is the only identity." },
      { title: "Machine-readable price", body: "The 402 response states exactly what to pay, in what asset, to which address." },
      { title: "Open source", body: "The x402-kit toolkit is MIT-licensed and runs against the live mainnet rail." },
    ],
    capabilities: [
      "HTTP 402 Payment Required with signed requirements",
      "USDC settlement on Base (eip155:8453)",
      "MIT-licensed x402-kit middleware and client",
      "Proven mainnet settlements",
      "Works with the RPC and Trading Intelligence endpoints",
    ],
    exampleRequest: `# The service answers an unpaid call with the price:
HTTP/1.1 402 Payment Required
{ "accepts": [{ "scheme": "x402", "network": "eip155:8453",
    "maxAmountRequired": "0.01", "asset": "USDC" }] }`,
    faq: [
      { group: "About the offering", items: [
        { q: "What network does x402 settle on?", a: "USDC on Base (eip155:8453). The settlement of RPC revenue to the Polygon vault is a separate, downstream step." },
        { q: "Is x402-kit open source?", a: "Yes — it is MIT-licensed and published on GitHub with mainnet transaction references." },
      ] },
    ],
  },

  metering: {
    slug: "metering",
    href: CANONICAL_URL.metering,
    name: "API Metering",
    category: "infrastructure",
    definition:
      "Metering is how Satelink counts and bills usage: every paid call is measured at a flat rate and drawn down from a prepaid balance, so spend is predictable and auditable per key.",
    tagline: "Credits and per-call usage metering you can audit.",
    endpoint: `${SITES.api.origin}/credits/deposit/initiate`,
    docs: `${SITES.docs.origin}`,
    auth: ["api_key"],
    rails: [RAIL.credits, RAIL.usdt],
    priceLine: `$${FLAT_RATE_USD} per call, drawn from a prepaid balance`,
    value: [
      { title: "Prepaid balance", body: "Deposit once in USDT; every call draws down at the flat per-call rate." },
      { title: "Per-key accounting", body: "Usage is attributed per key so you can see exactly where spend goes." },
      { title: "No surprise invoices", body: "You spend only what you deposit — there is no post-paid overage bill." },
    ],
    capabilities: [
      "USDT deposit → credit balance",
      "Flat per-call metering",
      "Per-key usage attribution",
      "Balance and usage visible in the console",
      "Draws down across every metered product",
    ],
    exampleRequest: `curl "${SITES.api.origin}/credits/deposit/initiate?amount=10"`,
    faq: [
      { group: "About the offering", items: [
        { q: "How do credits work?", a: "You deposit USDT once and every paid call draws down from that balance at the flat per-call rate. Credits are shared across the metered products you call." },
        { q: "Can I run out mid-call?", a: "Metering deducts per completed call; when the balance is exhausted, further paid calls return a 402 until you top up." },
      ] },
    ],
  },
};

/** The 5 products in the order the home grid + overview render them. */
export const PRODUCT_ORDER: ProductSlug[] = [
  "machine-commerce",
  "trading-intelligence",
  "rpc",
  "x402",
  "metering",
];

export function getProduct(slug: string): ProductFacts | undefined {
  return (PRODUCTS as Record<string, ProductFacts>)[slug];
}

/** The other products, as related-link cards (name/href/tagline). */
export function relatedFor(slug: ProductSlug, limit = 3): { name: string; href: string; tagline: string }[] {
  return PRODUCT_ORDER.filter((s) => s !== slug)
    .slice(0, limit)
    .map((s) => ({ name: PRODUCTS[s].name, href: PRODUCTS[s].href, tagline: PRODUCTS[s].tagline }));
}
