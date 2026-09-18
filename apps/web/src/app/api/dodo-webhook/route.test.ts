import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

// Store the callbacks passed to Webhooks(...)
let capturedCallbacks: Record<string, (...args: any[]) => Promise<any>> = {};

vi.mock("@dodopayments/nextjs", () => ({
  Webhooks: vi.fn((options: Record<string, any>) => {
    capturedCallbacks = options;
    return vi.fn(async (_req: any) => ({ status: 200 }));
  }),
}));

vi.mock("@/lib/task-orders/db", () => ({
  markOrderPaid: vi.fn(async () => ({ order: { order_ref: "ord_123" }, matchedVia: "order_ref" })),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: vi.fn() },
}));

describe("dodo-webhook route handler and envelope unwrapping", () => {
  const originalEnv = process.env;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env = {
      ...originalEnv,
      DODO_PAYMENTS_WEBHOOK_KEY: "whsec_test_dummy_key",
      DODO_INTERNAL_SECRET: "test_internal_secret",
      INTERNAL_API_URL: "http://localhost:8080",
    };
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => "ok",
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // Trigger POST once to initialize handler and register callbacks
    const { POST } = await import("./route");
    await POST({} as NextRequest);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("onPaymentSucceeded", () => {
    it("correctly unwraps wrapped Dodo envelope and calls internal credit API", async () => {
      const wrappedPayload = {
        business_id: "bus_test123",
        type: "payment.succeeded",
        timestamp: "2026-09-18T19:54:19.463Z",
        data: {
          payment_id: "pay_0NntAI66qoVUW9Dwa4ztA",
          currency: "INR",
          total_amount: 58988,
          settlement_amount: 591,
          settlement_currency: "USD",
          customer: { email: "infra@satelink.network" },
          product_cart: [{ product_id: "pdt_0NnsVXRRdMnzMoUZ5S7yN", quantity: 1 }],
          metadata: { plan_product_id: "pdt_0NnsVXRRdMnzMoUZ5S7yN" },
        },
      };

      await capturedCallbacks.onPaymentSucceeded(wrappedPayload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:8080/internal/dodo/credit");
      expect(options.headers["x-dodo-internal-secret"]).toBe("test_internal_secret");

      const body = JSON.parse(options.body);
      expect(body.eventType).toBe("payment.succeeded");
      expect(body.paymentId).toBe("pay_0NntAI66qoVUW9Dwa4ztA");
      expect(body.planProductId).toBe("pdt_0NnsVXRRdMnzMoUZ5S7yN");
      expect(body.customerEmail).toBe("infra@satelink.network");
      expect(body.currency).toBe("USD");
      expect(body.amountMinor).toBe(591);
    });

    it("handles unwrapped direct mock payload without error", async () => {
      const directPayload = {
        payment_id: "pay_direct_456",
        currency: "USD",
        total_amount: 500,
        customer: { email: "direct@example.com" },
        product_cart: [{ product_id: "pdt_0NnsVXRRdMnzMoUZ5S7yN", quantity: 1 }],
      };

      await capturedCallbacks.onPaymentSucceeded(directPayload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.paymentId).toBe("pay_direct_456");
      expect(body.amountMinor).toBe(500);
    });
  });

  describe("onPaymentFailed", () => {
    it("unwraps wrapped envelope for failed payment", async () => {
      const wrappedPayload = {
        business_id: "bus_test123",
        type: "payment.failed",
        data: {
          payment_id: "pay_failed_123",
          customer: { email: "failed@example.com" },
        },
      };

      await capturedCallbacks.onPaymentFailed(wrappedPayload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.eventType).toBe("payment.failed");
      expect(body.paymentId).toBe("pay_failed_123");
    });
  });

  describe("onSubscriptionRenewed", () => {
    it("unwraps wrapped envelope for subscription renewal", async () => {
      const wrappedPayload = {
        business_id: "bus_test123",
        type: "subscription.renewed",
        data: {
          subscription_id: "sub_123",
          product_id: "pdt_pro",
          customer: { email: "sub@example.com" },
          currency: "USD",
          recurring_pre_tax_amount: 2900,
          previous_billing_date: "2026-08-18T00:00:00Z",
          next_billing_date: "2026-09-18T00:00:00Z",
        },
      };

      await capturedCallbacks.onSubscriptionRenewed(wrappedPayload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.eventType).toBe("subscription.renewed");
      expect(body.subscriptionId).toBe("sub_123");
      expect(body.amountMinor).toBe(2900);
      expect(body.previousBillingDate).toBe("2026-08-18T00:00:00Z");
    });
  });

  describe("onRefundSucceeded", () => {
    it("unwraps wrapped envelope for refund", async () => {
      const wrappedPayload = {
        business_id: "bus_test123",
        type: "refund.succeeded",
        data: {
          refund_id: "ref_123",
          payment_id: "pay_orig_123",
          amount: 58988,
          currency: "INR",
          is_partial: false,
        },
      };

      await capturedCallbacks.onRefundSucceeded(wrappedPayload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:8080/internal/dodo/reversal");
      const body = JSON.parse(options.body);
      expect(body.eventType).toBe("refund.succeeded");
      expect(body.dodoRef).toBe("ref_123");
      expect(body.paymentId).toBe("pay_orig_123");
      expect(body.amountMinor).toBe(58988);
      expect(body.currency).toBe("INR");
    });
  });

  describe("onDisputeOpened", () => {
    it("unwraps wrapped envelope for dispute", async () => {
      const wrappedPayload = {
        business_id: "bus_test123",
        type: "dispute.opened",
        data: {
          dispute_id: "disp_123",
          payment_id: "pay_orig_123",
          amount: "58988",
          currency: "INR",
        },
      };

      await capturedCallbacks.onDisputeOpened(wrappedPayload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("http://localhost:8080/internal/dodo/reversal");
      const body = JSON.parse(options.body);
      expect(body.eventType).toBe("dispute.opened");
      expect(body.dodoRef).toBe("disp_123");
      expect(body.paymentId).toBe("pay_orig_123");
      expect(body.amountMinor).toBe(58988);
      expect(body.currency).toBe("INR");
    });
  });
});
