// fix/legacy-dodo-subscription-bucket — SIGNED events through the REAL
// @dodopayments/nextjs adapter (Standard Webhooks HMAC verify, not mocked).
// Proves the fields apps/api needs to route a subscription payment to the
// Trading-Intelligence entitlement bucket (subscriptionId, planProductId)
// survive verification + unwrapping, and that a forged delivery never
// reaches apps/api.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { Webhook } from "standardwebhooks";
import type { NextRequest } from "next/server";
import { createRequire } from "node:module";

vi.mock("@/lib/task-orders/db", () => ({ markOrderPaid: vi.fn() }));
// The REAL adapter, loaded through its CommonJS build: its ESM build inlines a
// Next.js internal that reads __dirname and cannot load under vitest's ESM
// runtime. Same code (verify → schema parse → dispatch), just the .cjs entry.
vi.mock("@dodopayments/nextjs", () => createRequire(import.meta.url)("@dodopayments/nextjs"));

const INTERNAL = "t_internal"; // dummy shared secret for the forward call
// Test-only key (base64 of a fixed string) — not a real Dodo secret.
const KEY = "whsec_" + Buffer.from("satelink-test-webhook-key-000000").toString("base64");


// Full Dodo payload shapes — the real adapter validates every delivery against
// its zod schema before dispatch, so partial fixtures would 400.
const customer = { customer_id: "cus_test", email: "c@example.test", name: "Test Customer" };
const billing = { city: null, country: "US", state: null, street: null, zipcode: null };
function payment(o: Record<string, unknown>) {
  return {
    payload_type: "Payment", billing, brand_id: "brd_test", business_id: "bus_test",
    created_at: "2026-09-25T00:00:00Z", currency: "USD", customer,
    digital_products_delivered: false, disputes: [], is_update_payment_method: false,
    metadata: {}, payment_id: "pay_x", payment_provider: "dodo", refunds: [], retry_attempt: 0,
    settlement_amount: 1900, settlement_currency: "USD", total_amount: 1900, status: "succeeded",
    ...o,
  };
}
function subscription(o: Record<string, unknown>) {
  return {
    payload_type: "Subscription", addons: [], billing, brand_id: "brd_test",
    cancel_at_next_billing_date: false, created_at: "2026-09-25T00:00:00Z",
    credit_entitlement_cart: [], currency: "USD", customer, metadata: {},
    meter_credit_entitlement_cart: [], meters: [],
    next_billing_date: "2026-11-25T00:00:00Z", on_demand: false,
    payment_frequency_count: 1, payment_frequency_interval: "Month",
    previous_billing_date: "2026-10-25T00:00:00Z", product_id: "pdt_test_pro_sub", quantity: 1,
    recurring_pre_tax_amount: 1900, status: "active", subscription_id: "sub_x",
    subscription_period_count: 1, subscription_period_interval: "Month",
    tax_inclusive: false, trial_period_days: 0,
    ...o,
  };
}
const envelope = (type: string, data: object) => ({ business_id: "bus_test", type, timestamp: "2026-09-25T00:00:00Z", data });

function signed(event: object, key = KEY): NextRequest {
  const body = JSON.stringify(event);
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const ts = new Date();
  const signature = new Webhook(key).sign(id, ts, body);
  return new Request("http://localhost/api/dodo-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(ts.getTime() / 1000)),
      "webhook-signature": signature,
    },
    body,
  }) as unknown as NextRequest;
}

describe("dodo-webhook — signed subscription events (real signature verification)", () => {
  let POST: (req: NextRequest) => Promise<Response>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    process.env.DODO_PAYMENTS_WEBHOOK_KEY = KEY;
    process.env.DODO_INTERNAL_SECRET = INTERNAL;
    process.env.INTERNAL_API_URL = "http://api.test";
    ({ POST } = (await import("./route")) as unknown as { POST: typeof POST });
  });

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "ok" });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const forwarded = () => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    return { url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(init.body) };
  };

  it("first subscription payment: forwards subscriptionId + the subscription product to /internal/dodo/credit", async () => {
    const res = await POST(signed(envelope("payment.succeeded", payment({
      payment_id: "pay_sub_first", subscription_id: "sub_T1",
      product_cart: [{ product_id: "pdt_test_pro_sub", quantity: 1 }],
      metadata: { satelink_account_id: "acct_hint_1" },
    }))));
    expect(res.status).toBe(200);
    const f = forwarded();
    expect(f.url).toBe("http://api.test/internal/dodo/credit");
    expect(f.headers["x-dodo-internal-secret"]).toBe(INTERNAL);
    expect(f.body).toMatchObject({
      eventType: "payment.succeeded", paymentId: "pay_sub_first",
      subscriptionId: "sub_T1", planProductId: "pdt_test_pro_sub", apiKeyHint: "acct_hint_1",
    });
  });

  it("renewal: forwards subscription.renewed with the subscriptionId (apps/api resolves the account via the earlier grant)", async () => {
    const res = await POST(signed(envelope("subscription.renewed", subscription({ subscription_id: "sub_T1" }))));
    expect(res.status).toBe(200);
    expect(forwarded().body).toMatchObject({ eventType: "subscription.renewed", subscriptionId: "sub_T1" });
  });

  it("one-time pack: no subscriptionId is forwarded (keeps the credit path)", async () => {
    await POST(signed(envelope("payment.succeeded", payment({
      payment_id: "pay_pack", product_cart: [{ product_id: "pdt_test_pack_10", quantity: 1 }],
      settlement_amount: 1000, total_amount: 1000, metadata: { satelink_account_id: "acct_hint_1" },
    }))));
    const { body } = forwarded();
    expect(body.subscriptionId).toBeUndefined();
    expect(body.planProductId).toBe("pdt_test_pack_10");
  });

  it("a delivery signed with the wrong key is rejected (401) and never reaches apps/api", async () => {
    const forged = "whsec_" + Buffer.from("attacker-key-00000000000000000000").toString("base64");
    const res = await POST(signed(envelope("payment.succeeded", payment({
      payment_id: "pay_forged", subscription_id: "sub_X", product_cart: [{ product_id: "pdt_test_pro_sub", quantity: 1 }],
    })), forged));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
