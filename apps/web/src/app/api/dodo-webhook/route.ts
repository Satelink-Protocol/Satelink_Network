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
// set by /api/tasks/start. Dodo's docs confirm metadata_* query params are
// supported on payment/checkout links and that metadata is included in
// webhook events at event.data.metadata — but this wasn't independently
// confirmed against a live account before this went into code (no live Dodo
// account existed at build time). markOrderPaid() therefore matches by
// order_ref FIRST, and falls back to "most recent pending_payment row for
// this buyer's email" if metadata didn't come through as expected. This
// fallback is real, not decorative — verify in STEP 4 which path actually
// fires (raw_webhook_payload is stored either way for post-hoc inspection).
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

    const matched = await markOrderPaid({
      orderRef,
      payerEmail,
      dodoPaymentId,
      rawPayload: payload,
    });

    if (!matched) {
      // Loud, not silent: nothing to retry (Dodo won't resend a payload we
      // already 2xx'd), so this needs a human to reconcile manually against
      // raw_webhook_payload / the Dodo dashboard.
      console.error(
        "[dodo-webhook] payment.succeeded matched NO task_orders row",
        { dodoPaymentId, orderRef, payerEmail }
      );
    } else {
      console.log("[dodo-webhook] order marked paid", { orderRef: matched.order_ref, dodoPaymentId });
    }
  },
});
