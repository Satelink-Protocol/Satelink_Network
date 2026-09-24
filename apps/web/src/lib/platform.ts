// Platform surface content (§7 PlatformTemplate / §8). One entry per
// /platform/* page. Facts only — capabilities describe what exists; anything
// not live is labelled "Draft"/"Planned" so the auto-hide + truth rules hold.
// The console maps to the real /satelink/os screens (no invented screenshots).
import { SITES, DISCOVERY } from "@satelink/content";

export type PlatformSlug =
  | "api"
  | "x402"
  | "machine-identity"
  | "metering"
  | "payments"
  | "settlement"
  | "integrations";

export interface PlatformSection {
  title: string;
  body: string;
  /** Optional status pill — "Draft"/"Planned" for surfaces not yet live. */
  status?: "Draft" | "Planned";
}

export interface PlatformFacts {
  slug: PlatformSlug;
  href: string;
  name: string;
  /** ≤50-word answer-first definition. */
  definition: string;
  tagline: string;
  sections: PlatformSection[];
  /** "Control cost" bullets — how spend is bounded. */
  controlCost: string[];
  resources: { label: string; href: string }[];
}

const DOCS = SITES.docs.origin;

export const PLATFORM: Record<PlatformSlug, PlatformFacts> = {
  api: {
    slug: "api",
    href: "/platform/api",
    name: "API",
    definition:
      "The Satelink API is a single REST surface for machine commerce: authenticate, register a machine, discover products, pay via credits or x402, call metered endpoints, and read usage — all over HTTPS.",
    tagline: "One REST API for discovery, payment, and metered calls.",
    sections: [
      { title: "Authentication & API keys", body: "Requests carry an API key, or stay keyless on the x402 rail. Keys are issued and rotated from the console." },
      { title: "Machine registration (HTTP 402)", body: "An unpaid call returns HTTP 402 with machine-readable payment requirements a caller can satisfy programmatically." },
      { title: "Products on the API", body: "Trading Intelligence (/v1/intelligence) and RPC (/rpc/polygon) are the metered products exposed today." },
      { title: "Credits & usage", body: "A USDT deposit funds a balance; every paid call draws down at the flat per-call rate, attributed per key." },
      { title: "x402", body: "Pay per request in USDC on Base with no account — the price arrives in the 402 response." },
      { title: "Webhooks", body: "Event delivery for usage and settlement is planned; the shape is not finalized.", status: "Draft" },
      { title: "Errors & rate limits", body: "Standard HTTP status codes; 402 for payment required, 429 for rate limits. See the docs for exact values." },
    ],
    controlCost: [
      "Spend is bounded by a prepaid balance — you cannot exceed what you deposit.",
      "Per-key attribution shows exactly where calls go.",
      "The flat per-call rate makes cost linear and predictable.",
    ],
    resources: [
      { label: "API reference", href: DOCS },
      { label: "Discovery", href: DISCOVERY.wellKnown },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  x402: {
    slug: "x402",
    href: "/platform/x402",
    name: "x402",
    definition:
      "x402 is the keyless payment rail: a service answers an unpaid request with HTTP 402 and requirements, the caller pays in USDC on Base, and the request completes — no account, no checkout.",
    tagline: "HTTP-native, keyless payments in USDC on Base.",
    sections: [
      { title: "The 402 handshake", body: "The service states what to pay, in what asset, to which address. The caller signs and retries with an X-Payment header." },
      { title: "USDC on Base", body: "Settlement is USDC on Base (eip155:8453). RPC revenue then settles downstream to the Polygon vault." },
      { title: "x402-kit", body: "The MIT-licensed middleware and client implement both sides of the handshake against the live mainnet rail." },
    ],
    controlCost: [
      "You pay exactly the amount quoted in the 402 — never more.",
      "No account means no standing balance to drain.",
      "Bundle pricing lets you pre-buy calls at a fixed cost.",
    ],
    resources: [
      { label: "x402-kit (GitHub)", href: "https://github.com/Satelink-Protocol/x402-kit" },
      { label: "x402 product", href: "/products/x402" },
      { label: "Docs", href: DOCS },
    ],
  },
  "machine-identity": {
    slug: "machine-identity",
    href: "/platform/machine-identity",
    name: "Machine Identity",
    definition:
      "Machine identity is how a caller proves who it is: an API key for account-based access, or a wallet address on the keyless x402 rail. Identity binds usage and spend limits to the caller.",
    tagline: "API keys and wallet identity for autonomous callers.",
    sections: [
      { title: "API keys", body: "Account callers present a key. Keys are scoped, rotatable, and attributed in usage." },
      { title: "Wallet identity (x402)", body: "On the keyless rail, the paying wallet is the identity — no key to store or leak." },
      { title: "Per-key limits", body: "Spending limits and rate limits attach to the identity so a compromised key is bounded." },
    ],
    controlCost: [
      "Per-key spend limits cap exposure.",
      "Rotate or revoke a key without touching the balance.",
      "Usage is attributed per identity for clean accounting.",
    ],
    resources: [
      { label: "Console", href: "/satelink/os/mission-control" },
      { label: "API", href: "/platform/api" },
      { label: "Docs", href: DOCS },
    ],
  },
  metering: {
    slug: "metering",
    href: "/platform/metering",
    name: "Metering & credits",
    definition:
      "Metering counts every paid call at a flat rate and draws it from a prepaid credit balance funded by a USDT deposit — so spend is predictable and auditable per key.",
    tagline: "Prepaid credits and per-call usage metering.",
    sections: [
      { title: "Deposit → balance", body: "A USDT deposit into RevenueVaultV2 credits your balance. Calls draw down from it." },
      { title: "Per-call metering", body: "Each completed paid call deducts the flat rate; when the balance is empty, paid calls return 402." },
      { title: "Usage attribution", body: "Balance and usage are visible per key in the console." },
    ],
    controlCost: [
      "You spend only what you deposit — no post-paid overage.",
      "The flat rate keeps per-call cost constant.",
      "Top up on your own schedule.",
    ],
    resources: [
      { label: "Metering product", href: "/products/metering" },
      { label: "Pricing", href: "/pricing" },
      { label: "Docs", href: DOCS },
    ],
  },
  payments: {
    slug: "payments",
    href: "/platform/payments",
    name: "Payments",
    definition:
      "Payments are the rails a caller uses to fund calls: prepaid credits (USDT deposit), keyless x402 (USDC on Base), and — for Trading Intelligence only — a one-time card/UPI Starter Pack via Dodo.",
    tagline: "Credits, x402, and the Trading-Intelligence Starter Pack.",
    sections: [
      { title: "Prepaid credits", body: "Deposit USDT once; every metered product draws from the same balance." },
      { title: "x402 (keyless)", body: "Pay per request in USDC on Base with no account." },
      { title: "Starter Pack (Dodo)", body: "A one-time card/UPI credit purchase — Trading Intelligence only. x402 and USDT are a separate crypto rail Dodo never processes.", status: "Draft" },
    ],
    controlCost: [
      "Every rail is pay-per-use or prepaid — no subscription.",
      "Balances cap total spend.",
      "Crypto rails and the card rail are kept strictly separate.",
    ],
    resources: [
      { label: "Pricing", href: "/pricing" },
      { label: "x402", href: "/platform/x402" },
      { label: "Metering", href: "/platform/metering" },
    ],
  },
  settlement: {
    slug: "settlement",
    href: "/platform/settlement",
    name: "Settlement",
    definition:
      "Settlement is how per-call revenue reaches operators on-chain: usage aggregates per epoch and settles to RevenueVaultV2 on Polygon (chain 137), split 50% operators / 30% platform / 20% distribution.",
    tagline: "Per-epoch, on-chain settlement to a verifiable vault.",
    sections: [
      { title: "Epoch aggregation", body: "Metered revenue is aggregated per epoch rather than paid per call, to keep on-chain costs bounded." },
      { title: "RevenueVaultV2", body: "Settlement lands in a permissionless vault on Polygon (chain 137) anyone can verify on Polygonscan." },
      { title: "The split", body: "50% to node operators, 30% to the platform, 20% to the distribution pool." },
    ],
    controlCost: [
      "Settlement is aggregated, not per-call, so overhead stays low.",
      "The vault address is public and verifiable.",
      "The split is fixed and transparent.",
    ],
    resources: [
      { label: "RevenueVaultV2 on Polygonscan", href: "https://polygonscan.com/address/0x577D3716d6Ad5b676d230f5409deF9838FABaCEF" },
      { label: "Network", href: "/network" },
      { label: "Docs", href: DOCS },
    ],
  },
  integrations: {
    slug: "integrations",
    href: "/platform/integrations",
    name: "Integrations",
    definition:
      "Integrations are the ways you build on Satelink: the direct REST API, the MIT-licensed x402-kit middleware, and — planned — a typed SDK and an MCP server for agents.",
    tagline: "Choose how you build: REST, x402-kit, SDK, or MCP.",
    sections: [
      { title: "Direct REST", body: "Call the API over HTTPS with an API key or x402 — no dependency required." },
      { title: "x402-kit (MIT)", body: "Drop-in middleware and client that implement the 402 handshake." },
      { title: "SDK", body: "A typed client library.", status: "Planned" },
      { title: "MCP / agent server", body: "An MCP server so agents can discover and pay for Satelink tools.", status: "Planned" },
    ],
    controlCost: [
      "Start with plain HTTP — no lock-in.",
      "The x402-kit is open source and self-hostable.",
      "Every path bills through the same metered balance.",
    ],
    resources: [
      { label: "x402-kit (GitHub)", href: "https://github.com/Satelink-Protocol/x402-kit" },
      { label: "API", href: "/platform/api" },
      { label: "Docs", href: DOCS },
    ],
  },
};

export const PLATFORM_ORDER: PlatformSlug[] = [
  "api",
  "x402",
  "machine-identity",
  "metering",
  "payments",
  "settlement",
  "integrations",
];

/** The console screens (real /satelink/os routes) mapped to the §7 verbs. */
export const CONSOLE_MAP = [
  { verb: "Build", body: "Create keys and projects.", href: "/satelink/os/keys" },
  { verb: "Deploy", body: "Fund a balance and go live.", href: "/satelink/os/deposit" },
  { verb: "Monitor", body: "Watch usage and health.", href: "/satelink/os/monitoring" },
  { verb: "Manage", body: "Track spend and settlement.", href: "/satelink/os/usage" },
];

export function getPlatform(slug: string): PlatformFacts | undefined {
  return (PLATFORM as Record<string, PlatformFacts>)[slug];
}
