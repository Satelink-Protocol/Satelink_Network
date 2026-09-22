// Solutions content (§7 SolutionTemplate / §8). Company-size and use-case
// solutions, plus the industries layer. Facts only — no invented customers,
// logos, testimonials, metrics, or people (§2). Anything not live is labelled
// "Planned". Security sections describe only what exists; no certifications are
// claimed. Solutions never mention Dodo (that stays on TI surfaces only).
import type { ProductSlug } from "./products";

export type SolutionKind = "company" | "usecase";

export interface SolutionFacts {
  slug: string;
  kind: SolutionKind;
  name: string;
  /** ≤50-word answer-first definition. */
  definition: string;
  /** The problem this audience faces. */
  problem: string;
  /** Why the shift is happening now (optional). */
  whyNow?: string;
  /** How Satelink works for them — ordered steps. */
  how: string[];
  /** Two-sided framing (machine buyers / sellers), where relevant. */
  twoSided?: { buyers: string; sellers: string };
  capabilities: string[];
  /** "Choose how you build" — implementation paths; status marks non-live. */
  implementation: { title: string; body: string; status?: "Planned" }[];
  useCases: string[];
  faq: { group: string; items: [string, string][] }[];
  relatedProducts: ProductSlug[];
}

const IMPLEMENTATION_COMMON: SolutionFacts["implementation"] = [
  { title: "Direct REST", body: "Call the API over HTTPS with an API key or keyless x402 — no dependency required." },
  { title: "x402-kit (MIT)", body: "Drop-in middleware and client that implement the HTTP 402 handshake." },
  { title: "SDK", body: "A typed client library.", status: "Planned" },
  { title: "MCP / agent server", body: "An MCP server so agents can discover and pay for Satelink tools.", status: "Planned" },
];

export const SOLUTIONS: Record<string, SolutionFacts> = {
  // ---- By company size ----
  enterprise: {
    slug: "enterprise", kind: "company", name: "Enterprise",
    definition: "Satelink for enterprise gives teams dedicated keys, spend and usage controls, per-key observability, and transparent on-chain settlement — either self-serve on the platform or through a corporate engagement.",
    problem: "Enterprises need machine access to priced APIs with clear cost controls, attribution, and auditability — not an unbounded post-paid bill.",
    how: [
      "Access & identity — dedicated, rotatable API keys scoped per team.",
      "Spend & usage controls — a prepaid balance and per-key limits cap exposure.",
      "Observability & audit — usage is attributed per key and visible in the console.",
      "Transparent settlement — revenue settles on-chain to a verifiable Polygon vault.",
    ],
    capabilities: ["Dedicated API keys", "Per-key spend & rate limits", "Usage attribution", "On-chain settlement receipts", "Consolidated invoicing via corporate engagement"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Machine procurement of data and RPC", "Cost-controlled agent fleets", "Auditable per-team usage"],
    faq: [
      { group: "Security & compliance", items: [
        ["What certifications do you hold?", "We do not claim certifications we do not hold. Settlement is on-chain and verifiable; per-key controls and attribution are built in. Ask us about your specific requirements."],
      ] },
      { group: "Products & capabilities", items: [
        ["Which products are available?", "Trading Intelligence and RPC today, over the same metered platform."],
      ] },
      { group: "Getting started", items: [
        ["How does invoicing work?", "Self-serve uses a prepaid balance; consolidated invoicing is available through a corporate engagement — contact sales."],
      ] },
    ],
    relatedProducts: ["machine-commerce", "metering", "rpc"],
  },
  startups: {
    slug: "startups", kind: "company", name: "Startups",
    definition: "Satelink for startups is pay-per-call from day one: no seat licences, no minimums, and free discovery so you can evaluate before you spend a cent.",
    problem: "Early teams can't justify enterprise minimums or annual commitments just to call an API a few thousand times.",
    how: [
      "Start on free discovery — read the catalog and response shapes with no signup.",
      "Fund a small balance and pay only for the calls you make.",
      "Scale spend linearly at a flat per-call rate as you grow.",
    ],
    capabilities: ["Free discovery", "Flat per-call pricing", "No minimums or seats", "Keyless x402 for prototypes"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Prototyping an agent", "A metered data feature", "Usage-based product without billing infra"],
    faq: [
      { group: "Getting started", items: [
        ["Is there a free tier?", "Discovery is free and unauthenticated. Metered calls draw from a prepaid balance you top up."],
        ["Do I need a contract?", "No — it is pay-per-call with no commitment."],
      ] },
    ],
    relatedProducts: ["rpc", "trading-intelligence", "x402"],
  },
  developers: {
    slug: "developers", kind: "company", name: "Developers",
    definition: "Satelink for developers is a REST API with keyless x402, an MIT x402-kit, and free discovery — pay per call, no seat licence, no commitment.",
    problem: "Developers want to call a priced API without provisioning accounts, negotiating contracts, or standing up billing.",
    how: [
      "Read the public catalog and pricing.",
      "Call with an API key, or keyless with x402.",
      "Pay per call from a prepaid balance or an x402 bundle.",
    ],
    capabilities: ["REST API", "Keyless x402", "MIT x402-kit", "Free discovery", "Flat per-call pricing"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Scripts and bots", "Backend integrations", "Agent tooling"],
    faq: [
      { group: "Getting started", items: [
        ["Where are the docs?", "At docs.satelink.network — the API reference, the x402 client, and quickstarts."],
      ] },
    ],
    relatedProducts: ["rpc", "x402", "metering"],
  },
  "ai-native": {
    slug: "ai-native", kind: "company", name: "AI-native companies",
    definition: "Satelink for AI-native companies is infrastructure for autonomous buyers: public discovery, machine-readable pricing, and a keyless 402 flow an agent can complete without a human.",
    problem: "Agent-first products need their software to buy services on its own — discovering, pricing, and paying without a person in the loop.",
    whyNow: "As agents take real actions, they increasingly need to pay for the services they call. Machine commerce is the rail for that spend.",
    how: [
      "Agents discover services from public JSON — no signup.",
      "A 402 response quotes the price in a machine-readable form.",
      "The agent pays keylessly with x402 and the call completes.",
    ],
    capabilities: ["Public discovery", "Machine-readable 402 pricing", "Keyless x402 payments", "Per-agent spend limits", "On-chain receipts"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Autonomous data purchasing", "Agent fleets with bounded spend", "MCP-connected tools"],
    faq: [
      { group: "About the offering", items: [
        ["How does an agent pay without an account?", "On the x402 rail the payment travels in the HTTP request; the wallet is the identity, so no account is needed."],
      ] },
    ],
    relatedProducts: ["machine-commerce", "x402", "trading-intelligence"],
  },

  // ---- By use case ----
  "ai-agents": {
    slug: "ai-agents", kind: "usecase", name: "AI agents",
    definition: "Satelink lets AI agents buy the services they call: discover a priced API, pay with keyless x402, and get an on-chain-verifiable receipt — all without a human.",
    problem: "Agents can reason and act, but they can't transact — most APIs assume a human set up an account and a card.",
    how: [
      "The agent reads the public catalog and pricing.",
      "It pays the quoted 402 price in USDC on Base.",
      "The call runs and a verifiable receipt is issued.",
    ],
    twoSided: {
      buyers: "Agents that need data, RPC, or compute pay per call with no standing account.",
      sellers: "Services expose a priced endpoint and get paid automatically per call.",
    },
    capabilities: ["Keyless x402", "Machine-readable pricing", "Per-key spend limits", "On-chain receipts"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Research agents buying data", "Trading agents consuming market intelligence", "Tool-using agents paying per call"],
    faq: [
      { group: "Trust and safety", items: [
        ["What stops an agent from paying a price that isn't real?", "The price is quoted by the service in a signed 402 response, per-key limits bound spend, and every settled call produces an on-chain receipt."],
      ] },
    ],
    relatedProducts: ["machine-commerce", "x402", "trading-intelligence"],
  },
  commerce: {
    slug: "commerce", kind: "usecase", name: "Commerce",
    definition: "Commerce infrastructure for machines: the rails software uses to buy services from other software — discover, pay, call, and settle — without a checkout or a human.",
    problem: "Humans buy products at a checkout. Software increasingly buys services — an RPC call, a data query — thousands of times an hour, with no way to pay for them.",
    how: [
      "A service publishes a machine-readable catalog and price.",
      "A machine buyer pays with x402, USDT, or a prepaid balance.",
      "Revenue settles on-chain per epoch.",
    ],
    twoSided: {
      buyers: "Machine buyers discover and pay for services programmatically.",
      sellers: "Machine sellers expose a priced endpoint and get paid per call.",
    },
    capabilities: ["Public discovery", "HTTP 402 pricing", "Three payment rails", "On-chain settlement"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Data marketplaces", "API monetization", "Agent-to-service payments"],
    faq: [
      { group: "About the offering", items: [
        ["Is this a marketplace?", "It is the payment and discovery rail underneath one. Services list a priced endpoint; buyers pay per call."],
      ] },
      { group: "Trust and safety", items: [
        ["What stops an agent from paying a price that isn't real?", "Prices are quoted in signed 402 requirements, per-key limits apply, and receipts are on-chain."],
      ] },
    ],
    relatedProducts: ["machine-commerce", "x402", "metering"],
  },
  "machine-commerce": {
    slug: "machine-commerce", kind: "usecase", name: "Machine commerce",
    definition: "The machine-commerce solution is the end-to-end loop for software that pays software: discover, identify, pay, execute, meter, and settle on-chain.",
    problem: "There is no default way for one piece of software to pay another for a service call.",
    how: [
      "Discover a priced service from public JSON.",
      "Pay the quoted price with x402, USDT, or credits.",
      "Meter usage and settle revenue on-chain.",
    ],
    capabilities: ["Discovery", "402 payment flow", "Metering", "On-chain settlement"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Autonomous purchasing", "Metered APIs", "Machine-to-machine payments"],
    faq: [
      { group: "About the offering", items: [
        ["How is this different from a normal API?", "A normal API assumes a human account. Machine commerce adds discovery, machine-readable pricing, and keyless payment so software can transact on its own."],
      ] },
    ],
    relatedProducts: ["machine-commerce", "x402", "rpc"],
  },
  trading: {
    slug: "trading", kind: "usecase", name: "Trading systems",
    definition: "For trading systems, Satelink is a metered source of derived market statistics — funding-rate, open-interest, liquidation-cluster, and microstructure metrics — bought per call. It is a research input, not investment advice.",
    problem: "Automated strategies need fresh derived market statistics without a data-vendor contract or seat licence.",
    how: [
      "Discover the metric catalog and per-call price.",
      "Call a metric endpoint per decision.",
      "Pay per call — no subscription.",
    ],
    capabilities: ["Four derived metrics", "Per-call pricing", "Model-vs-derived labelling", "Keyless x402"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Systematic strategies consuming derived metrics", "Backtesting inputs", "Agent trading tools"],
    faq: [
      { group: "About the offering", items: [
        ["Is this investment advice?", "No. Every metric is a statistic derived from public market data. It is a research input and Satelink never takes custody of funds."],
      ] },
    ],
    relatedProducts: ["trading-intelligence", "x402", "metering"],
  },
  "api-monetization": {
    slug: "api-monetization", kind: "usecase", name: "API monetization",
    definition: "Satelink lets you charge for an API per call over a machine-native rail: expose a priced endpoint, answer with HTTP 402, and get paid in USDC or from a prepaid balance — no billing stack to build.",
    problem: "Charging machines for API calls usually means building metering, billing, and dunning yourself.",
    how: [
      "Expose your endpoint behind the 402 handshake.",
      "Callers pay the quoted price per request.",
      "Revenue meters and settles on-chain.",
    ],
    twoSided: {
      buyers: "Callers pay per request with x402 or a balance.",
      sellers: "You price an endpoint and get paid without billing infrastructure.",
    },
    capabilities: ["HTTP 402 pricing", "Per-call metering", "USDC settlement", "On-chain receipts"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Monetizing a data API", "Charging agents per call", "Usage-based pricing without billing infra"],
    faq: [
      { group: "About the offering", items: [
        ["Do I need to build billing?", "No — metering and the 402 handshake are provided. You price the endpoint; the rail collects and settles."],
      ] },
    ],
    relatedProducts: ["metering", "x402", "machine-commerce"],
  },
  automation: {
    slug: "automation", kind: "usecase", name: "Automation",
    definition: "For automation, Satelink is the pay-per-call rail your scripts and workflows use to buy data and RPC on demand — no seats, no minimums, bounded by a prepaid balance.",
    problem: "Automated workflows call priced services intermittently and shouldn't carry a seat licence or a contract.",
    how: [
      "Point a workflow at the API with a key or x402.",
      "Pay per call from a prepaid balance.",
      "Cap spend with per-key limits.",
    ],
    capabilities: ["Flat per-call pricing", "Prepaid balance", "Per-key limits", "Keyless x402"],
    implementation: IMPLEMENTATION_COMMON,
    useCases: ["Scheduled data pulls", "Event-driven RPC calls", "Backoffice automations"],
    faq: [
      { group: "Getting started", items: [
        ["How do I bound spend?", "Fund a balance and set per-key limits — you can never exceed what you deposit."],
      ] },
    ],
    relatedProducts: ["rpc", "metering", "x402"],
  },
};

export const SOLUTIONS_BY_COMPANY = ["enterprise", "startups", "developers", "ai-native"];
export const SOLUTIONS_BY_USECASE = ["ai-agents", "commerce", "machine-commerce", "trading", "api-monetization", "automation"];

export function getSolution(slug: string): SolutionFacts | undefined {
  return SOLUTIONS[slug];
}

// ---- Industries layer (§8) ----
export interface IndustryFacts {
  slug: string;
  name: string;
  definition: string;
  body: string;
  useCases: string[];
  relatedProducts: ProductSlug[];
}

export const INDUSTRIES: Record<string, IndustryFacts> = {
  "financial-services": { slug: "financial-services", name: "Financial services", definition: "Financial-services teams use Satelink for metered derived market statistics and pay-per-call RPC, with on-chain-verifiable settlement.", body: "Consume derived funding-rate, open-interest, and microstructure metrics per call, and read chain state over metered RPC — without a data-vendor contract. Trading Intelligence is a research input, not investment advice.", useCases: ["Derived market statistics for research", "On-chain data access", "Agent trading tools"], relatedProducts: ["trading-intelligence", "rpc", "x402"] },
  ai: { slug: "ai", name: "AI", definition: "AI teams use Satelink so agents can buy the services they call — discovery, machine-readable pricing, and keyless x402 payments.", body: "Give agents a way to pay for data, RPC, and tools on their own, with per-key spend limits and on-chain receipts. MCP integration is planned.", useCases: ["Autonomous data purchasing", "Agent fleets with bounded spend", "Tool-using agents"], relatedProducts: ["machine-commerce", "x402", "trading-intelligence"] },
  software: { slug: "software", name: "Software", definition: "Software teams monetize or consume APIs per call over a machine-native rail — no billing stack, no seats.", body: "Expose a priced endpoint behind the 402 handshake, or call priced services per request. Metering and settlement are provided.", useCases: ["API monetization", "Metered integrations", "Usage-based features"], relatedProducts: ["metering", "x402", "machine-commerce"] },
  infrastructure: { slug: "infrastructure", name: "Infrastructure", definition: "Infrastructure providers meter and settle machine traffic on-chain, with per-epoch aggregation to a verifiable Polygon vault.", body: "Charge for infrastructure calls per request and settle revenue transparently, split 50% operators / 30% platform / 20% distribution.", useCases: ["Metered RPC", "On-chain settlement", "Node operator revenue"], relatedProducts: ["rpc", "metering", "machine-commerce"] },
  "internet-services": { slug: "internet-services", name: "Internet services", definition: "Internet-service products charge machines per call and let agents pay keylessly with x402.", body: "Add pay-per-call to any HTTP service with the 402 handshake, and accept keyless x402 payments from autonomous callers.", useCases: ["Pay-per-call services", "Agent-accessible APIs", "Usage-based pricing"], relatedProducts: ["x402", "metering", "machine-commerce"] },
  "developer-tools": { slug: "developer-tools", name: "Developer tools", definition: "Developer-tool companies integrate Satelink so their users pay per call and their agents transact autonomously.", body: "Use the REST API, the MIT x402-kit, and (planned) an SDK and MCP server to add machine payments to developer workflows.", useCases: ["Metered developer APIs", "Agent tooling", "x402-kit integrations"], relatedProducts: ["x402", "rpc", "metering"] },
  "enterprise-technology": { slug: "enterprise-technology", name: "Enterprise technology", definition: "Enterprise-technology teams get dedicated keys, spend controls, per-key attribution, and transparent on-chain settlement.", body: "Run machine access with bounded, auditable spend and consolidated invoicing through a corporate engagement.", useCases: ["Cost-controlled machine access", "Auditable per-team usage", "Corporate procurement"], relatedProducts: ["machine-commerce", "metering", "rpc"] },
};

export const INDUSTRY_ORDER = ["financial-services", "ai", "software", "infrastructure", "internet-services", "developer-tools", "enterprise-technology"];

export function getIndustry(slug: string): IndustryFacts | undefined {
  return INDUSTRIES[slug];
}
