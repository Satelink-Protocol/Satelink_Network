// Plan catalogue — the single source for the Explore-plans cards (home) and the
// /pricing plan table (P3). Config-driven: no plan numbers are hardcoded in JSX.
//
// Truth rule (§4.4): the recurring plans (Pro/Max) and the Free monthly quota do
// NOT exist in the backend yet. Until PLANS_ENABLED is true in production, the
// Pro/Max cards render "Available soon — notify me" (capture email to
// Enquiries) and only Free + the existing $9.99 pack + x402 are purchasable.
// Never show a buy button that cannot complete. P3.B adds the backend + a
// pricing-parity test against GET /v1/plans; this file becomes the web mirror.

export type BillingPeriod = "monthly" | "yearly";

export interface Plan {
  id: "free" | "pro" | "max";
  name: string;
  /** USD price by billing period. Free is 0/0. */
  price: Record<BillingPeriod, number>;
  /** Included Trading-Intelligence calls per month. */
  includedCalls: number;
  /** Effective per-call once the plan is spent, or null for Free. */
  effectivePerCall: number | null;
  /** Overage price per call drawn from credits, or null for Free. */
  overagePerCall: number | null;
  apiKeys: number;
  rateLimit: "Low" | "Standard" | "High";
  /** Marketing one-liner. */
  tagline: string;
  /** Feature bullets for the card. */
  features: string[];
  featured?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: { monthly: 0, yearly: 0 },
    includedCalls: 300,
    effectivePerCall: null,
    overagePerCall: null,
    apiKeys: 1,
    rateLimit: "Low",
    tagline: "Start building, no card.",
    features: ["300 Trading-Intelligence calls / month", "All 4 metrics", "1 API key", "Pay-as-you-go packs", "Catalog + discovery"],
  },
  {
    id: "pro",
    name: "Pro",
    price: { monthly: 19, yearly: 190 },
    includedCalls: 2500,
    effectivePerCall: 0.0076,
    overagePerCall: 0.008,
    apiKeys: 5,
    rateLimit: "Standard",
    tagline: "For a working desk or product.",
    features: ["2,500 calls / month (~$0.0076 each)", "Overage $0.008 / call from credits", "5 API keys", "Usage alerts & spend caps", "Standard rate limit"],
    featured: true,
  },
  {
    id: "max",
    name: "Max",
    price: { monthly: 79, yearly: 790 },
    includedCalls: 12000,
    effectivePerCall: 0.0066,
    overagePerCall: 0.007,
    apiKeys: 20,
    rateLimit: "High",
    tagline: "For heavy, always-on usage.",
    features: ["12,000 calls / month (~$0.0066 each)", "Overage $0.007 / call from credits", "20 API keys", "Priority email support", "High rate limit"],
  },
];

/** Pay-as-you-go credit packs (no plan). Minimum >= $10 so the $0.40 fixed fee
 *  stays < 5%. The $9.99 Starter Pack is the one live today. */
export interface CreditPack {
  id: string;
  price: number;
  label: string;
  bonusPct: number;
  live: boolean;
}
export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", price: 9.99, label: "Starter Pack", bonusPct: 0, live: true },
  { id: "pack-50", price: 50, label: "$50 pack", bonusPct: 5, live: false },
  { id: "pack-200", price: 200, label: "$200 pack", bonusPct: 10, live: false },
];

/** Agents & API — the machine rate card (Claude-API-style, per §4.3). */
export interface RateCardRow {
  product: string;
  unit: string;
  price: number;
  rail: string;
}
export const AGENT_RATE_CARD: RateCardRow[] = [
  { product: "Funding-rate heatmap", unit: "call", price: 0.01, rail: "credits or x402" },
  { product: "Open-interest shifts", unit: "call", price: 0.01, rail: "credits or x402" },
  { product: "Market microstructure", unit: "call", price: 0.01, rail: "credits or x402" },
  { product: "Liquidation clusters (model)", unit: "call", price: 0.01, rail: "credits or x402" },
  { product: "Polygon RPC", unit: "call", price: 0.00003, rail: "credits or x402 / USDT" },
];

/** Fixed monthly infrastructure assumption (USD) — the single constant the
 *  founder edits. See docs/web/PRICING_MODEL.md. */
export const FIXED_MONTHLY_INFRA_USD = 80;

/** Full feature-comparison matrix (§4.2), grouped (§4.6). Values are per plan
 *  in PLANS order [Free, Pro, Max]. Config only — no numbers in JSX. */
export type CompareValue = string | boolean;
export interface CompareRow {
  label: string;
  values: [CompareValue, CompareValue, CompareValue];
}
export interface CompareGroup {
  group: string;
  rows: CompareRow[];
}
export const COMPARE_GROUPS: CompareGroup[] = [
  {
    group: "Usage",
    rows: [
      { label: "Included Trading-Intelligence calls / month", values: ["300", "2,500", "12,000"] },
      { label: "Effective per-call", values: ["—", "~$0.0076", "~$0.0066"] },
      { label: "Overage", values: ["Upgrade or top up", "$0.008 / call", "$0.007 / call"] },
      { label: "Catalog + discovery", values: [true, true, true] },
      { label: "Metrics", values: ["All 4", "All 4", "All 4"] },
    ],
  },
  {
    group: "API & limits",
    rows: [
      { label: "Rate limit", values: ["Low", "Standard", "High"] },
      { label: "API keys", values: ["1", "5", "20"] },
    ],
  },
  {
    group: "Payments",
    rows: [{ label: "Pay-as-you-go packs", values: [true, true, true] }],
  },
  {
    group: "Support",
    rows: [
      { label: "Usage alerts & spend caps", values: [false, true, true] },
      { label: "Priority email support", values: [false, false, true] },
    ],
  },
  {
    group: "Security",
    rows: [
      { label: "TLS in transit", values: [true, true, true] },
      { label: "Server-side hashed API keys", values: [true, true, true] },
    ],
  },
];

/** Whether recurring plans are live (backend PLANS_ENABLED). Build-time inlined;
 *  unset today → false, so Pro/Max render "Available soon — notify me". */
export function plansEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PLANS_ENABLED === "true";
}

/** Yearly saving vs 12× monthly, as a rounded percent (for the "Save ~X%" pill). */
export function yearlySavingPct(plan: Plan): number {
  if (!plan.price.monthly) return 0;
  const full = plan.price.monthly * 12;
  return Math.round(((full - plan.price.yearly) / full) * 100);
}
