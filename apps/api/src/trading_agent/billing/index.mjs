// Trading Agent subscriptions billing (Stage 27). See ./README.md. Flag SUBSCRIPTIONS stays OFF; not mounted.
export const DOMAIN = 'billing';
export { BillingError } from './errors.mjs';
export { CATALOG, FREE_PLAN, planOf, entitlementsFor, assertCatalogUsable } from './plans.mjs';
export { GATEWAYS, GATEWAY_METHODS, assertGateway } from './gateway.mjs';
export { RazorpayGateway } from './razorpay.mjs';
export { prorationPreview } from './proration.mjs';
export { buildInvoice, GST_REVIEW } from './invoices.mjs';
export { GATEWAY_TO_STATUS, GRACE_DAYS, REMINDER_DAYS, nextStatus, graceUntil, remindersDue } from './lifecycle.mjs';
export { SimSubscriptionBook, RealBookPosting, bookFor } from './books.mjs';
export { InMemoryBillingStore, PgBillingStore } from './store.mjs';
export { BillingService } from './service.mjs';
export { createBillingRouter, createRazorpayWebhookHandler, mountBillingRoutes, BILLING_ROUTES } from './router.mjs';
