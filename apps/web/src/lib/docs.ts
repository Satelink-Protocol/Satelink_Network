import fs from "fs";
import path from "path";

/**
 * Docs registry — the single source of truth for the documentation portal
 * (served at /docs and, via the middleware host map, docs.satelink.network).
 *
 * Content lives as markdown in src/content/docs/<slug>.md. Every entry here
 * must have a file; the build fails loudly in getDoc() if one is missing.
 */

export interface DocEntry {
  slug: string;
  title: string;
  description: string;
  category: string;
}

export const DOC_CATEGORIES = [
  "Getting Started",
  "Platform",
  "Billing & Economics",
  "Network Participants",
  "Operations",
  "Reference",
] as const;

export const DOCS: DocEntry[] = [
  // Getting Started
  { slug: "quick-start", title: "Quick Start", description: "Make your first metered RPC call in under two minutes — free tier, no account required.", category: "Getting Started" },
  { slug: "architecture", title: "Architecture", description: "How the Satelink gateway, metering, epoch ledger, and on-chain settlement fit together.", category: "Getting Started" },
  { slug: "authentication", title: "Authentication", description: "API keys, wallet-bound keys via MetaMask signature, and machine identity via HTTP 402.", category: "Getting Started" },

  // Platform
  { slug: "api-reference", title: "API Reference", description: "Public HTTP endpoints of the Satelink RPC gateway: RPC, keys, credits, usage, status.", category: "Platform" },
  { slug: "sdk", title: "SDK (@satelink/sdk)", description: "The JavaScript/TypeScript SDK published on npm — install, configure, and call any supported chain.", category: "Platform" },
  { slug: "machine-customers", title: "Machine Customers", description: "The HTTP 402 flow that lets autonomous machines and AI agents onboard and pay without a human.", category: "Platform" },

  // Billing & Economics
  { slug: "billing", title: "Billing & Credits", description: "How per-call USDT metering, credit balances, and permissionless vault deposits work.", category: "Billing & Economics" },
  { slug: "pricing", title: "Pricing", description: "Free tier limits and the flat $0.00003-per-call metered rate. No subscriptions.", category: "Billing & Economics" },
  { slug: "revenue-model", title: "Revenue Model", description: "The 50/30/20 revenue split, epoch aggregation, and on-chain settlement lifecycle.", category: "Billing & Economics" },

  // Network Participants
  { slug: "node-operators", title: "Node Operators", description: "Register a node, serve traffic, and earn 50% of routed revenue in USDT. No staking, no slashing.", category: "Network Participants" },
  { slug: "developer-guide", title: "Developer Guide", description: "Integrating Satelink into applications: keys, headers, chains, failover, and usage monitoring.", category: "Network Participants" },
  { slug: "admin-guide", title: "Admin Guide", description: "The operator command center: observer endpoints, settlement controls, and demand radar.", category: "Network Participants" },

  // Operations
  { slug: "security", title: "Security", description: "Responsible disclosure policy, scope, severity levels, and the platform security model.", category: "Operations" },
  { slug: "troubleshooting", title: "Troubleshooting", description: "Common errors — 402, 429, chain guards, deposit timing — and exactly how to resolve them.", category: "Operations" },
  { slug: "deployment", title: "Deployment", description: "How the platform deploys (merge-to-main), and how node operators deploy the edge agent.", category: "Operations" },

  // Reference
  { slug: "faq", title: "FAQ", description: "Frequently asked questions about Satelink, honestly answered from the current production state.", category: "Reference" },
  { slug: "glossary", title: "Glossary", description: "Canonical definitions: epoch, settlement batch, RevenueVault, free-tier gate, demand radar.", category: "Reference" },
  { slug: "changelog", title: "Changelog", description: "Notable platform changes, newest first.", category: "Reference" },
  { slug: "roadmap", title: "Roadmap", description: "Completed, in progress, and planned work — kept in sync with the repository.", category: "Reference" },
];

const CONTENT_DIR = path.join(process.cwd(), "src", "content", "docs");

export function getDocEntry(slug: string): DocEntry | undefined {
  return DOCS.find((d) => d.slug === slug);
}

export function getDocMarkdown(slug: string): string {
  const file = path.join(CONTENT_DIR, `${slug}.md`);
  return fs.readFileSync(file, "utf8");
}

export function docsByCategory(): { category: string; docs: DocEntry[] }[] {
  return DOC_CATEGORIES.map((category) => ({
    category,
    docs: DOCS.filter((d) => d.category === category),
  })).filter((g) => g.docs.length > 0);
}
