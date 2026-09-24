// Canonical site constants — the single source of truth for legal entity,
// registered address, and the one-canonical-URL-per-concept map (§3, §2 footer
// rule). Imported by both apps/web and apps/corporate so the footer entity and
// internal links never drift.

export const LEGAL_ENTITY = {
  name: "Jakuraa Commercial Pvt Ltd",
  addressLines: ["38/39 Malaviya Street", "Ram Nagar", "Coimbatore 641009", "Tamil Nadu", "India"],
  addressOneLine: "38/39 Malaviya Street, Ram Nagar, Coimbatore 641009, Tamil Nadu, India",
  country: "IN",
} as const;

export const SITES = {
  satelink: { origin: "https://satelink.network", name: "Satelink" },
  jakuraa: { origin: "https://jakuraa.com", name: "Jakuraa" },
  docs: { origin: "https://docs.satelink.network", name: "Satelink Docs" },
  api: { origin: "https://rpc.satelink.network", name: "Satelink API" },
} as const;

export type SiteKey = keyof typeof SITES;

// One canonical explanation per concept (§3). Everywhere else links here.
export const CANONICAL_URL = {
  machineCommerce: "/products/machine-commerce",
  tradingIntelligence: "/products/trading-intelligence",
  x402: "/products/x402",
  rpc: "/products/rpc",
  metering: "/products/metering",
  api: "/platform/api",
  pricing: "/pricing",
  enterprise: "/solutions/enterprise",
} as const;

export type ConceptKey = keyof typeof CANONICAL_URL;

// Machine-discovery endpoints on the live API (§12).
export const DISCOVERY = {
  wellKnown: `${SITES.api.origin}/.well-known/satelink.json`,
  catalog: `${SITES.api.origin}/v1/intelligence`,
} as const;
