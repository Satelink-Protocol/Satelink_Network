// Trading Agent plans and entitlements (Stage 27) — config, versioned. NOT a public price list:
// pricing is a founder decision (Phase 12) and the Stage 26 pricing page says no price exists.
// Amounts below are TEST-MODE FIXTURES for the Razorpay sandbox; the catalog is 'draft', and a
// draft catalog can never be used in live mode.
import { BillingError } from './errors.mjs';

export const CATALOG = Object.freeze({
  version: 'ta-2026-10-draft',
  status: 'draft', // draft ⇒ test mode only
  currency: 'INR',
  plans: Object.freeze({
    ta_free: Object.freeze({ id: 'ta_free', name: 'Free', amountMinor: 0n, period: 'monthly', interval: 1, entitlements: Object.freeze({ paperTrading: true, liveTrading: false, maxStrategies: 1, maxBrokerAccounts: 0, agentSuggestionsPerDay: 5 }) }),
    ta_pro_test: Object.freeze({ id: 'ta_pro_test', name: 'Pro (test fixture)', amountMinor: 49900n, period: 'monthly', interval: 1, entitlements: Object.freeze({ paperTrading: true, liveTrading: false, maxStrategies: 5, maxBrokerAccounts: 1, agentSuggestionsPerDay: 50 }) }),
    ta_team_test: Object.freeze({ id: 'ta_team_test', name: 'Team (test fixture)', amountMinor: 149900n, period: 'monthly', interval: 1, entitlements: Object.freeze({ paperTrading: true, liveTrading: false, maxStrategies: 20, maxBrokerAccounts: 5, agentSuggestionsPerDay: 500 }) }),
  }),
});

export const FREE_PLAN = 'ta_free';

export function planOf(planId, catalog = CATALOG) {
  const p = Object.hasOwn(catalog.plans, planId) ? catalog.plans[planId] : null;
  if (!p) throw new BillingError('INVALID', `unknown plan ${planId}`);
  return p;
}

export function assertCatalogUsable(mode, catalog = CATALOG) {
  if (mode === 'live' && catalog.status !== 'published') throw new BillingError('FORBIDDEN', `catalog ${catalog.version} is ${catalog.status}: test mode only`);
}

/** Entitlements for a subscription state: paid plan while active / authenticated / in grace; else Free. */
export function entitlementsFor(subscription, catalog = CATALOG) {
  const paying = subscription && ['active', 'past_due'].includes(subscription.status);
  return planOf(paying ? subscription.planId : FREE_PLAN, catalog).entitlements;
}
