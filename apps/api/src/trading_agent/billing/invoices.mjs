// Invoices (Stage 27): one per captured payment, with GST METADATA fields only. No tax is computed
// and no GST invoice number/format is invented — that is RPrC (requires professional review).
// The invoice total is the amount the gateway captured.
import { BillingError } from './errors.mjs';

export const GST_REVIEW = 'RPrC — GST invoice format, numbering, SAC code and tax treatment require professional review before any invoice is issued to a customer.';

export function buildInvoice({ id, subscription, plan, payment, gst = {}, issuedAt, kind = 'invoice' }) {
  if (payment.status !== 'captured') throw new BillingError('INVALID', 'invoices are issued only for captured payments');
  if (payment.currency !== 'INR') throw new BillingError('INVALID', `unexpected currency ${payment.currency}`);
  const total = BigInt(payment.amountMinor);
  return Object.freeze({
    id, kind, principalId: subscription.principalId, subscriptionId: subscription.id, mode: subscription.mode, gateway: subscription.gateway,
    gatewayPaymentId: payment.gatewayPaymentId, currency: payment.currency, totalMinor: total,
    periodStart: subscription.currentPeriodStart ?? null, periodEnd: subscription.currentPeriodEnd ?? null, issuedAt,
    lines: Object.freeze([Object.freeze({ lineNo: 1, description: `${plan.name} — Trading Agent subscription`, quantity: 1, unitMinor: total, amountMinor: total, ledgerTxnId: null })]),
    gst: Object.freeze({
      supplierGstin: gst.supplierGstin ?? null, customerGstin: gst.customerGstin ?? null, placeOfSupply: gst.placeOfSupply ?? null,
      sacCode: null, taxBreakdown: null, reviewStatus: 'rprc_pending', note: GST_REVIEW,
    }),
  });
}
