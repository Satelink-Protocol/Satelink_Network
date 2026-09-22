import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 })),
  },
}));

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe("POST /api/dodo-claim", () => {
  const originalEnv = process.env;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DODO_INTERNAL_SECRET: "internal_secret",
      INTERNAL_API_URL: "http://localhost:8080",
    };
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("rejects a missing claimToken", async () => {
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({}));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("claimToken_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges a valid claim token for the apiKey, forwarding to apps/api with the internal secret", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, apiKey: "sk_dodo_abc" }) });
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ claimToken: "claim_123" }));
    expect(res.status).toBe(200);
    expect(res.body.apiKey).toBe("sk_dodo_abc");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/internal/dodo/exchange-claim");
    expect(opts.headers["x-dodo-internal-secret"]).toBe("internal_secret");
    expect(JSON.parse(opts.body)).toEqual({ claimToken: "claim_123" });
  });

  it("propagates 410 for an invalid/expired/already-used token", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 410, text: async () => "gone" });
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ claimToken: "claim_dead" }));
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("claim_invalid_expired_or_used");
  });

  it("returns 502 on an unexpected upstream failure", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ claimToken: "claim_x" }));
    expect(res.status).toBe(502);
  });

  it("returns 503 when DODO_INTERNAL_SECRET is not configured, without calling upstream", async () => {
    delete process.env.DODO_INTERNAL_SECRET;
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ claimToken: "claim_x" }));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
