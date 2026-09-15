/**
 * apps/api/src/billing/pricing_config.mjs
 *
 * CANONICAL PRICING CONFIGURATION — the SINGLE source of truth for all
 * product pricing across Satelink Trading Machine Commerce.
 *
 * Every route, middleware, checkout, and machine surface must read prices
 * from here — never hardcode in route handlers.
 *
 * Three rails, one price table:
 *   - Dodo (human): subscription plans (INR, monthly)
 *   - x402 (machine): per-bundle USDC on Base
 *   - Credits (both): per-call USDT deductions
 */

// ── Subscription Plans (Dodo / Human Rail) ──────────────────────────────────

export const SUBSCRIPTION_PLANS = {
  free: {
    name: 'Free',
    price_inr: 0,
    price_usd: 0,
    daily_limit: 500,
    tier: 'free',
    credits_usdt: 0,
    description: 'Limited evaluation — 500 calls/day, no intelligence access',
  },
  starter: {
    name: 'Starter',
    price_inr: 49900, // ₹499 in paise
    price_usd: 5.99,
    daily_limit: 10000,
    tier: 'basic',
    credits_usdt: 5.0,
    description: 'Starter plan — 10,000 calls/day + 5 USDT credits/month',
  },
  pro: {
    name: 'Pro',
    price_inr: 199900, // ₹1,999 in paise
    price_usd: 24.99,
    daily_limit: 100000,
    tier: 'pro',
    credits_usdt: 25.0,
    description: 'Pro plan — 100,000 calls/day + 25 USDT credits/month (primary commercial plan)',
  },
  professional: {
    name: 'Professional',
    price_inr: 499900, // ₹4,999 in paise
    price_usd: 59.99,
    daily_limit: 1000000,
    tier: 'enterprise',
    credits_usdt: 60.0,
    description: 'Professional plan — 1,000,000 calls/day + 60 USDT credits/month',
  },
};

// ── Per-Call Pricing (Credits) ──────────────────────────────────────────────

export const CREDIT_PRICING = {
  rpc_call: 0.000030,      // RPC calls — $0.00003/call
  intelligence_lookup: 0.005, // Simple lookup intelligence
  intelligence_derived: 0.01, // Derived intelligence (funding heatmap, OI, etc.)
  intelligence_premium: 0.02, // Premium intelligence (reserved for high-value metrics)
};

// ── Intelligence Metric Prices ──────────────────────────────────────────────
// Maps metric names to their canonical prices. Used by intelligence_route.js.

export const INTELLIGENCE_PRICES = {
  'funding-rate-heatmap': CREDIT_PRICING.intelligence_derived,
  'oi-shifts': CREDIT_PRICING.intelligence_derived,
  'liquidation-pressure': CREDIT_PRICING.intelligence_derived,
  'microstructure': CREDIT_PRICING.intelligence_derived,
};

// ── x402 Bundle Pricing (Machine Rail) ──────────────────────────────────────

export const X402_PRICING = {
  bundle_price_usd: parseFloat(process.env.X402_BUNDLE_PRICE_USD || '0.10'),
  bundle_calls: parseInt(process.env.X402_BUNDLE_CALLS || '1000', 10),
  currency: 'USDC',
  network: 'eip155:8453', // Base mainnet
};

// ── Billing Waterfall Order ─────────────────────────────────────────────────
// The order in which billing sources are consumed for a single request.

export const BILLING_WATERFALL = [
  'promotional_grant',
  'subscription_included',
  'prepaid_credits',
  'authorized_overage',
  'x402_payment',
  'hard_stop',
];

// ── Dodo Product ID Resolution ──────────────────────────────────────────────
// Product IDs are Dodo-dashboard configuration — set via env.

export function resolvePlanFromProductId(productId) {
  if (!productId) return 'starter';
  const envMap = {
    [process.env.DODO_PRODUCT_FREE_ID]: 'free',
    [process.env.DODO_PRODUCT_STARTER_ID]: 'starter',
    [process.env.DODO_PRODUCT_PRO_ID]: 'pro',
    [process.env.DODO_PRODUCT_PROFESSIONAL_ID]: 'professional',
  };
  return envMap[productId] || 'starter'; // default to starter, never silently grant higher tier
}

export function getPlanConfig(planName) {
  return SUBSCRIPTION_PLANS[planName] || SUBSCRIPTION_PLANS.starter;
}
