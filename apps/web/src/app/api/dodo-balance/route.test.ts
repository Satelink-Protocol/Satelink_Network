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

describe("POST /api/dodo-balance", () => {
  const originalEnv = process.env;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env = { ...originalEnv, INTERNAL_API_URL: "http://localhost:8080" };
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("rejects a missing/invalid apiKey without calling upstream", async () => {
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ apiKey: "not-a-key" }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the apiKey as the X-Api-Key HEADER, never a query param", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ balance_usdt: 9.99, status: "funded" }) });
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ apiKey: "sk_dodo_abc" }));
    expect(res.status).toBe(200);
    expect(res.body.balance_usdt).toBe(9.99);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/credits/balance");
    expect(url).not.toContain("apiKey");
    expect(opts.headers["x-api-key"]).toBe("sk_dodo_abc");
  });

  it("propagates 404 for an unknown account", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "not found" });
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ apiKey: "sk_dodo_missing" }));
    expect(res.status).toBe(404);
  });

  it("returns 502 on an unexpected upstream failure", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const { POST } = await import("./route");
    const res: any = await POST(makeReq({ apiKey: "sk_dodo_x" }));
    expect(res.status).toBe(502);
  });
});
