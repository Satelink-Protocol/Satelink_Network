// apps/web/src/app/api/dodo-webhook/route.ts
// POST /api/dodo-webhook
//
// Dodo Payments webhook — handles TWO independent surfaces that happen to
// share one Dodo business account (one webhook URL per account):
//   1. task-commerce (pre-existing): one-shot "500 Verified Local Business
//      Leads" purchases, isolated, writes ONLY to task_orders. Unchanged.
//   2. M5 human payment rail (T-17): Free/Starter/Pro subscriptions for
//      /intelligence. Routes to apps/api's canonical billing (api_credits,
//      payment_sources, revenue_events_v2, ledger) — see below.
//
// Signature verification (gate M5-d) is handled by the official
// @dodopayments/nextjs adapter BEFORE any handler below ever runs (Standard
// Webhooks HMAC-SHA256 via standardWebhook.verify()) — an invalid signature
// returns 401 straight out of the library, we never see the payload. Checked
// against the installed package (node_modules/@dodopayments/nextjs — the
// Webhooks() wrapper calls standardWebhook.verify() first, and does NOT
// catch handler errors: "let them bubble up ... as they will originate from
// the handlers passed by the user". So an error thrown below becomes a 500,
// which is what makes Dodo retry the delivery later — every write this file
// triggers is idempotent (apps/api's tx_hash-keyed dedup, gate M5-b), so a
// retried delivery is safe, and a transient apps/api outage does not lose
// the payment silently.
//
// Distinguishing which surface a payment.succeeded event belongs to:
// metadata.order_ref is set ONLY by /api/tasks/start (task-commerce
// checkout links) — its presence is the discriminator. No order_ref means
// this is an /intelligence subscription payment.
//
// Money-path writes for surface 2 happen in apps/api (POST
// /internal/dodo/credit), NOT here: apps/web's deployed DB role
// (task_commerce_web) has no grants on api_credits / payment_sources /
// revenue_events_v2 / ledger_txns — deliberately, "least-privilege by
// design" (see task-orders/db.ts). Widening that role was considered and
// rejected; a new endpoint on apps/api, guarded by its own shared secret
// (DODO_INTERNAL_SECRET, distinct from ADMIN_SECRET_TOKEN — narrower blast
// radius if it ever leaks), keeps that boundary intact.

import type { NextRequest, NextResponse } from "next/server";
import { Webhooks } from "@dodopayments/nextjs";
import { markOrderPaid } from "@/lib/task-orders/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERNAL_API_URL =
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  (process.env.NODE_ENV === "production"
    ? "https://api.satelink.network"
    : "http://localhost:8080");

type DodoCreditBody = {
  eventType:
    | "payment.succeeded"
    | "payment.failed"
    | "subscription.active"
    | "subscription.renewed"
    | "subscription.on_hold"
    | "subscription.cancelled";
  paymentId?: string;
  subscriptionId?: string;
  planProductId?: string;
  customerEmail?: string;
  apiKeyHint?: string;
  currency?: string;
  amountMinor?: number;
  isTestMode?: boolean;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  previousBillingDate?: string;
};

// Deliberately throws (does not catch) on a non-2xx or network failure — see
// the module header: an uncaught error here becomes a 500, and Dodo's own
// retry handles the rest. The one thing this must NEVER do is silently
// swallow a failed credit — that is exactly the "customer paid, got nothing,
// nobody noticed" bug class M4/M5 exist to close.
async function creditViaInternalApi(body: DodoCreditBody): Promise<void> {
  const secret = process.env.DODO_INTERNAL_SECRET;
  if (!secret) {
    // Fail loud, not open: refuse to pretend this succeeded.
    throw new Error("[dodo-webhook] DODO_INTERNAL_SECRET is not set — cannot credit apps/api");
  }
  const res = await fetch(`${INTERNAL_API_URL}/internal/dodo/credit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dodo-internal-secret": secret,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    // Already credited (idempotent replay, gate M5-b) — not an error.
    console.log(`[dodo-webhook] ${body.eventType} already credited (409, idempotent)`, {
      paymentId: body.paymentId,
      subscriptionId: body.subscriptionId,
    });
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[dodo-webhook] internal credit call failed: ${res.status} ${text}`.slice(0, 500)
    );
  }
}

type PaymentPayload = {
  payment_id?: string;
  subscription_id?: string | null;
  customer?: { email?: string };
  metadata?: Record<string, string>;
  currency?: string;
  total_amount?: number;
  settlement_amount?: number;
  settlement_currency?: string;
};

type SubscriptionPayload = {
  subscription_id?: string;
  product_id?: string;
  customer?: { email?: string };
  metadata?: Record<string, string>;
  currency?: string;
  recurring_pre_tax_amount?: number;
  previous_billing_date?: string;
  next_billing_date?: string;
  current_period_start?: string;
};

function isTestModePayload(data: { metadata?: Record<string, string> }): boolean {
  // Dodo test-mode payments use test API keys server-side; there is no
  // reliable payload field confirmed to flag this in the webhook body
  // itself, so this is metadata-driven only (checkout can set
  // metadata.test_mode="true" for a controlled gate-M5 test-mode run).
  // Never inferred from amount or currency.
  return data.metadata?.test_mode === "true";
}

// Webhooks(...) validates webhookKey eagerly inside its own constructor (throws
// "Secret can't be empty" if unset) — calling it at MODULE LOAD TIME would crash
// Next.js's build-time page-data collection in any environment lacking this one
// secret (local dev, CI, a Vercel preview build for an unrelated PR). Deferred to
// first request instead: identical verification behavior (still the official
// standardWebhook.verify() over the same handlers), just constructed lazily.
let _handler: ((req: NextRequest) => Promise<NextResponse<unknown>>) | null = null;
function getHandler() {
  if (!_handler) {
    _handler = Webhooks({
      webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY!,

      onPaymentSucceeded: async (payload: unknown) => {
        const data = payload as PaymentPayload;
        const orderRef = data.metadata?.order_ref;

        // ── Surface 1: task-commerce (pre-existing, unchanged) ──────────────
        if (orderRef !== undefined) {
          const dodoPaymentId = data.payment_id;
          if (!dodoPaymentId) {
            console.error("[dodo-webhook] payment.succeeded with no payment_id — cannot record", data);
            return;
          }
          const payerEmail = data.customer?.email;
          const { order, matchedVia } = await markOrderPaid({
            orderRef,
            payerEmail,
            dodoPaymentId,
            rawPayload: payload,
          });
          if (matchedVia === "none") {
            console.error("[dodo-webhook] payment.succeeded matched NO task_orders row", {
              dodoPaymentId, orderRef, payerEmail,
            });
            return;
          }
          if (matchedVia === "email_fallback") {
            console.warn(
              "[dodo-webhook] matched via email fallback, NOT order_ref metadata — " +
              "static-link metadata pass-through may not be reaching webhooks as documented",
              { orderRef: order?.order_ref, dodoPaymentId, payerEmail }
            );
          } else {
            console.log(`[dodo-webhook] order marked paid (matchedVia=${matchedVia})`, {
              orderRef: order?.order_ref, dodoPaymentId,
            });
          }
          return;
        }

        // ── Surface 2: /intelligence subscription payment (M5) ──────────────
        if (!data.payment_id) {
          console.error("[dodo-webhook] payment.succeeded with no payment_id — cannot credit", data);
          return;
        }
        await creditViaInternalApi({
          eventType: "payment.succeeded",
          paymentId: data.payment_id,
          subscriptionId: data.subscription_id ?? undefined,
          planProductId: data.metadata?.plan_product_id,
          customerEmail: data.customer?.email,
          apiKeyHint: data.metadata?.api_key,
          // Prefer settlement_* (what actually lands in the merchant account)
          // over the customer-facing charge currency/amount when both are
          // present — see internal_dodo.js's FX note for why this still isn't
          // exact accounting without a confirmed settlement currency.
          currency: data.settlement_currency || data.currency,
          amountMinor: data.settlement_amount ?? data.total_amount,
          isTestMode: isTestModePayload(data),
        });
      },

      onPaymentFailed: async (payload: unknown) => {
        const data = payload as PaymentPayload;
        if (data.metadata?.order_ref !== undefined) return; // task-commerce: no money-path handling needed
        await creditViaInternalApi({
          eventType: "payment.failed",
          paymentId: data.payment_id,
          subscriptionId: data.subscription_id ?? undefined,
          isTestMode: isTestModePayload(data),
        });
      },

      onSubscriptionActive: async (payload: unknown) => {
        const data = payload as SubscriptionPayload;
        // Gate M5-c: active alone (fires before a UPI mandate confirms) must
        // NEVER credit or entitle — internal_dodo.js enforces this server-side
        // regardless of what this handler sends, but the eventType alone is
        // enough here; no amount/currency needed for a non-entitling event.
        await creditViaInternalApi({
          eventType: "subscription.active",
          subscriptionId: data.subscription_id,
          planProductId: data.product_id,
          customerEmail: data.customer?.email,
          apiKeyHint: data.metadata?.api_key,
          currency: data.currency,
          amountMinor: data.recurring_pre_tax_amount,
          currentPeriodStart: data.current_period_start,
          isTestMode: isTestModePayload(data),
        });
      },

      onSubscriptionRenewed: async (payload: unknown) => {
        const data = payload as SubscriptionPayload;
        if (!data.subscription_id || !data.previous_billing_date) {
          console.error("[dodo-webhook] subscription.renewed missing subscription_id/previous_billing_date — cannot credit", data);
          return;
        }
        await creditViaInternalApi({
          eventType: "subscription.renewed",
          subscriptionId: data.subscription_id,
          planProductId: data.product_id,
          customerEmail: data.customer?.email,
          apiKeyHint: data.metadata?.api_key,
          currency: data.currency,
          amountMinor: data.recurring_pre_tax_amount,
          previousBillingDate: data.previous_billing_date,
          currentPeriodEnd: data.next_billing_date,
          isTestMode: isTestModePayload(data),
        });
      },

      onSubscriptionOnHold: async (payload: unknown) => {
        const data = payload as SubscriptionPayload;
        await creditViaInternalApi({
          eventType: "subscription.on_hold",
          subscriptionId: data.subscription_id,
          isTestMode: isTestModePayload(data),
        });
      },

      onSubscriptionCancelled: async (payload: unknown) => {
        const data = payload as SubscriptionPayload;
        await creditViaInternalApi({
          eventType: "subscription.cancelled",
          subscriptionId: data.subscription_id,
          isTestMode: isTestModePayload(data),
        });
      },
    });
  }
  return _handler;
}

export async function POST(req: NextRequest) {
  return getHandler()(req);
}
