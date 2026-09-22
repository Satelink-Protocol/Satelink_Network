// Academy content (§8): tutorials, use cases, courses. Rule: a tutorial is
// Published only if a LIVE endpoint backs it; anything else is Draft
// ("Available soon"). Courses: none real yet → empty (EmptyState). No invented
// people or fabricated lesson counts.
import { SITES } from "@satelink/content";

const API = SITES.api.origin;

export interface Tutorial {
  slug: string;
  product: string;
  title: string;
  summary: string;
  prereqs: string[];
  /** Ordered steps; each may carry a runnable command. */
  steps: { heading: string; body: string; code?: string; illustrative?: boolean }[];
  built: string; // "what you built"
  next?: { slug: string; label: string };
  /** False when no live endpoint backs it — renders "Available soon". */
  live: boolean;
}

export const TUTORIALS: Tutorial[] = [
  {
    slug: "discover-the-catalog",
    product: "Machine Commerce",
    title: "Discover services with no signup",
    summary: "Read the public discovery document and the Trading Intelligence catalog.",
    prereqs: ["curl or any HTTP client"],
    steps: [
      { heading: "Read discovery", body: "The well-known document lists services and where to find pricing.", code: `curl ${API}/.well-known/satelink.json` },
      { heading: "Read the catalog", body: "The intelligence catalog lists each metric and its per-call price.", code: `curl ${API}/v1/intelligence` },
    ],
    built: "You listed every service and price without an account.",
    next: { slug: "call-a-metric", label: "Call a derived metric" },
    live: true,
  },
  {
    slug: "call-a-metric",
    product: "Trading Intelligence",
    title: "Call a derived metric with an API key",
    summary: "Make your first metered call to a Trading Intelligence metric.",
    prereqs: ["A funded API key", "curl"],
    steps: [
      { heading: "Set your key", body: "Export the key issued in the console.", code: `export SATELINK_KEY=sk_...` },
      { heading: "Call the metric", body: "Metered calls draw from your balance at the per-call price.", code: `curl -H "X-API-Key: $SATELINK_KEY" \\\n  ${API}/v1/intelligence/funding-rate-heatmap` },
    ],
    built: "You bought one derived market statistic per call.",
    next: { slug: "make-an-rpc-call", label: "Make a Polygon RPC call" },
    live: true,
  },
  {
    slug: "make-an-rpc-call",
    product: "RPC",
    title: "Make a Polygon RPC call",
    summary: "Read chain state over the metered RPC gateway.",
    prereqs: ["A funded API key or x402 wallet", "curl"],
    steps: [
      { heading: "Send a JSON-RPC request", body: "Standard Ethereum JSON-RPC, proxied to Polygon PoS.", code: `curl -X POST ${API}/rpc/polygon \\\n  -H 'content-type: application/json' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'` },
    ],
    built: "You read Polygon chain state at the flat per-call rate.",
    next: { slug: "pay-with-x402", label: "Pay keylessly with x402" },
    live: true,
  },
  {
    slug: "pay-with-x402",
    product: "x402",
    title: "Pay keylessly with x402",
    summary: "Complete the HTTP 402 handshake and pay in USDC on Base.",
    prereqs: ["A wallet with USDC on Base"],
    steps: [
      { heading: "Trigger a 402", body: "An unpaid metered call returns the price in machine-readable form.", code: `HTTP/1.1 402 Payment Required\n{ "accepts": [{ "scheme": "x402", "network": "eip155:8453",\n    "maxAmountRequired": "0.01", "asset": "USDC" }] }`, illustrative: true },
      { heading: "Pay and retry", body: "Sign the payment and retry with an X-Payment header. The x402-kit does this for you.", code: `# with @satelink x402-kit client\nawait x402fetch("${API}/rpc/polygon", { method: "POST", body });`, illustrative: true },
    ],
    built: "You paid for a call with no account, using only a wallet.",
    live: true,
  },
];

export interface UseCase {
  slug: string;
  title: string;
  scenario: string;
  flow: string[];
  products: { label: string; href: string }[];
  tutorials: string[]; // tutorial slugs
}

export const USE_CASES: UseCase[] = [
  { slug: "ai-agent-purchasing", title: "AI agent purchasing infrastructure", scenario: "An autonomous agent needs to buy data and compute on its own.", flow: ["Discover a priced service", "Pay keylessly with x402", "Consume the result", "Verify the on-chain receipt"], products: [{ label: "Machine Commerce", href: "/products/machine-commerce" }, { label: "x402", href: "/products/x402" }], tutorials: ["discover-the-catalog", "pay-with-x402"] },
  { slug: "trading-agent-intelligence", title: "Trading agent consuming market intelligence", scenario: "A strategy buys derived market statistics per decision.", flow: ["Read the metric catalog", "Call a metric per decision", "Pay per call"], products: [{ label: "Trading Intelligence", href: "/products/trading-intelligence" }], tutorials: ["call-a-metric"] },
  { slug: "m2m-api-payments", title: "Machine-to-machine API payments", scenario: "One service pays another per request with no human.", flow: ["Expose a priced endpoint", "Answer with 402", "Collect payment", "Settle on-chain"], products: [{ label: "x402", href: "/products/x402" }, { label: "Metering", href: "/products/metering" }], tutorials: ["pay-with-x402"] },
  { slug: "usage-based-saas", title: "Usage-based SaaS", scenario: "A product bills customers by the call from a prepaid balance.", flow: ["Fund a balance", "Meter each call", "Attribute usage per key"], products: [{ label: "Metering", href: "/products/metering" }], tutorials: ["make-an-rpc-call"] },
  { slug: "api-monetization", title: "API monetization", scenario: "You charge machines for your API without building billing.", flow: ["Price an endpoint", "Answer with 402", "Get paid per call"], products: [{ label: "Metering", href: "/products/metering" }, { label: "x402", href: "/products/x402" }], tutorials: ["pay-with-x402"] },
  { slug: "enterprise-procurement", title: "Enterprise machine procurement", scenario: "A team buys machine access with bounded, auditable spend.", flow: ["Issue scoped keys", "Set per-key limits", "Attribute usage", "Settle transparently"], products: [{ label: "Enterprise", href: "/solutions/enterprise" }, { label: "Metering", href: "/products/metering" }], tutorials: ["call-a-metric"] },
];

// No structured courses exist yet — the section renders an EmptyState.
export const COURSES: { slug: string; title: string }[] = [];

export function getTutorial(slug: string) {
  return TUTORIALS.find((t) => t.slug === slug);
}
export function getUseCase(slug: string) {
  return USE_CASES.find((u) => u.slug === slug);
}
export function tutorialsByProduct(): Record<string, Tutorial[]> {
  const out: Record<string, Tutorial[]> = {};
  for (const t of TUTORIALS) (out[t.product] ??= []).push(t);
  return out;
}
