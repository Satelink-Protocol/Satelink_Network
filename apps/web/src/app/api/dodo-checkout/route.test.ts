import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

const createCheckoutSessionMock = vi.fn();

vi.mock("@dodopayments/core/checkout", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 })),
  },
}));

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/dodo-checkout", () => {
  const originalEnv = process.env;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DODO_PAYMENTS_ENVIRONMENT: "test_mode",
      DODO_PAYMENTS_API_KEY: "key_test",
      DODO_INTERNAL_SECRET: "internal_secret",
      INTERNAL_API_URL: "http://localhost:8080",
      NEXT_PUBLIC_DODO_CREDIT_PACKS: "pdt_pack:9.99:Starter Pack",
      NEXT_PUBLIC_SITE_URL: "https://satelink.network",
    };
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    createCheckoutSessionMock.mockReset();
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("rejects an invalid email", async () => {
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ email: "not-an-email", productId: "pdt_pack" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("valid_email_required");
  });

  it("rejects an unconfigured productId", async () => {
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ email: "buyer@example.com", productId: "pdt_unknown" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unknown_or_unconfigured_product");
  });

  it("resolves an account, embeds satelink_account_id in metadata, and returns the checkout URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, apiKey: "sk_dodo_new123", created: true }),
    });
    createCheckoutSessionMock.mockResolvedValueOnce({
      session_id: "cks_1",
      checkout_url: "https://checkout.dodopayments.com/cks_1",
    });

    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ email: "buyer@example.com", productId: "pdt_pack" }));

    expect(res.status).toBe(200);
    expect(res.body.checkoutUrl).toBe("https://checkout.dodopayments.com/cks_1");

    // resolve-account was called with the buyer's email
    const [resolveUrl, resolveOpts] = fetchMock.mock.calls[0];
    expect(resolveUrl).toBe("http://localhost:8080/internal/dodo/resolve-account");
    expect(JSON.parse(resolveOpts.body)).toEqual({ email: "buyer@example.com" });

    // checkout session was created with the resolved api_key as satelink_account_id
    const [payload, config] = createCheckoutSessionMock.mock.calls[0];
    expect(payload.metadata).toEqual({ satelink_account_id: "sk_dodo_new123" });
    expect(payload.customer).toEqual({ email: "buyer@example.com" });
    expect(payload.product_cart).toEqual([{ product_id: "pdt_pack", quantity: 1 }]);
    expect(payload.return_url).toBe("https://satelink.network/intelligence/success?account=sk_dodo_new123");
    expect(config).toEqual({ bearerToken: "key_test", environment: "test_mode" });
  });

  it("returns 502 when account resolution fails, and never calls createCheckoutSession", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ email: "buyer@example.com", productId: "pdt_pack" }));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("account_resolution_failed");
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("returns 503 when Dodo environment/API key is not configured", async () => {
    delete process.env.DODO_PAYMENTS_API_KEY;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, apiKey: "sk_dodo_x", created: false }),
    });
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ email: "buyer@example.com", productId: "pdt_pack" }));
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("dodo_not_configured");
  });

  it("returns 502 when Dodo's createCheckoutSession itself fails", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, apiKey: "sk_dodo_y", created: false }),
    });
    createCheckoutSessionMock.mockRejectedValueOnce(new Error("dodo api down"));
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ email: "buyer@example.com", productId: "pdt_pack" }));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("checkout_session_failed");
  });
});
