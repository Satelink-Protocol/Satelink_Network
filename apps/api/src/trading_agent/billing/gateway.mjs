// PaymentGateway abstraction (Stage 27). One interface for subscription gateways.
//   razorpay — implemented here (test mode only).
//   dodo     — the EXISTING Pricing V2 path (apps/api/src/pricing_v2, /webhooks/dodo/v2) for Trading
//              Intelligence plans. It is listed so the abstraction is complete, but it is NOT wrapped
//              or changed: legacy customers keep exactly today's behaviour.
import { BillingError } from './errors.mjs';

export const GATEWAY_METHODS = Object.freeze(['ensurePlan', 'createSubscription', 'changePlan', 'cancelSubscription', 'verifyWebhook', 'parseWebhook']);

export const GATEWAYS = Object.freeze({
  razorpay: Object.freeze({ id: 'razorpay', status: 'implemented', modes: ['test'], note: 'Stage 27; live keys refused' }),
  dodo: Object.freeze({ id: 'dodo', status: 'existing_external', modes: ['test', 'live'], note: 'Pricing V2 (Trading Intelligence); untouched by Stage 27' }),
});

export function assertGateway(g) {
  const missing = GATEWAY_METHODS.filter((m) => typeof g?.[m] !== 'function');
  if (missing.length) throw new BillingError('CONFIG', `payment gateway missing ${missing.join(', ')}`);
  if (!['test', 'live'].includes(g.mode)) throw new BillingError('CONFIG', 'payment gateway needs a mode');
  return g;
}
