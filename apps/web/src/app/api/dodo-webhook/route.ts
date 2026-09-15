// apps/web/src/app/api/dodo-webhook/route.ts
// POST /api/dodo-webhook
//
// Dodo Payments webhook — isolated task-commerce surface. Signature
// verification is handled by the official @dodopayments/nextjs adapter
// (Standard Webhooks HMAC-SHA256; invalid signature -> 401 automatically,
// we never see it). We only handle payment.succeeded.
//
// Matching the payment back to a task_orders row: the checkout link carries
// metadata_order_ref (and metadata_city / metadata_category) as query params,
// set by /api/tasks/start. Dodo's docs confirm the metadata_* query-param
// SYNTAX for static payment links, but — checked again, still true as of
// this comment — do not explicitly confirm that metadata set this way (vs.
// via the API on a Checkout Session) reaches event.data.metadata on the
// webhook. markOrderPaid() therefore matches by order_ref FIRST, and falls
// back to "most recent pending_payment row for this buyer's email" if
// metadata didn't come through as expected. This fallback is real, not
// decorative — every time it fires, that's logged as a WARNING below (never
// silent) until a real payment settles the question of which path actually
// fires in production (raw_webhook_payload is stored either way for
// post-hoc inspection).
//
// Reserved next.config.ts rewrite exclusion for this path — see the comment
// there. Isolated: writes ONLY to task_orders, never touches apps/api.

import { Webhooks } from "@dodopayments/nextjs";
import { markOrderPaid } from "@/lib/task-orders/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = Webhooks({
  webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY!,
  onPaymentSucceeded: async (payload: unknown) => {
    const data = payload as {
      payment_id?: string;
      customer?: { email?: string };
      metadata?: Record<string, string>;
    };

    const dodoPaymentId = data.payment_id;
    if (!dodoPaymentId) {
      console.error("[dodo-webhook] payment.succeeded with no payment_id — cannot record", data);
      return;
    }

    const orderRef = data.metadata?.order_ref;
    const payerEmail = data.customer?.email;

    const { order, matchedVia } = await markOrderPaid({
      orderRef,
      payerEmail,
      dodoPaymentId,
      rawPayload: payload,
    });

    if (matchedVia === "none") {
      // Loud, not silent: nothing to retry (Dodo won't resend a payload we
      // already 2xx'd), so this needs a human to reconcile manually against
      // raw_webhook_payload / the Dodo dashboard.
      console.error(
        "[dodo-webhook] payment.succeeded matched NO task_orders row",
        { dodoPaymentId, orderRef, payerEmail }
      );
      return;
    }

    if (matchedVia === "email_fallback") {
      // See the module-header comment: this means metadata_order_ref did NOT
      // arrive on this webhook as expected. Flagged loudly every time, not
      // just once, until confirmed live one way or the other.
      console.warn(
        "[dodo-webhook] matched via email fallback, NOT order_ref metadata — " +
        "static-link metadata pass-through may not be reaching webhooks as documented",
        { orderRef: order?.order_ref, dodoPaymentId, payerEmail }
      );
    } else {
      console.log(`[dodo-webhook] order marked paid (matchedVia=${matchedVia})`, {
        orderRef: order?.order_ref,
        dodoPaymentId,
      });
    }
  },
});
