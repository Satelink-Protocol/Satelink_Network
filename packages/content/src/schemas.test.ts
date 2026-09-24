import { describe, it, expect } from "vitest";
import { ProductJson, PriceLine, PublishStatus } from "./schemas";

describe("content schemas", () => {
  it("parses a valid product/pricing contract", () => {
    const ok = ProductJson.safeParse({
      product: "trading-intelligence",
      endpoint: "https://rpc.satelink.network/v1/intelligence",
      pricing: [{ metric: "funding-rate-heatmap", unit: "call", price: 0.01, currency: "USD" }],
      auth: ["api_key", "x402"],
      payment_rails: ["dodo_card_upi", "x402_usdc_base"],
    });
    expect(ok.success).toBe(true);
  });

  it("rejects negative prices", () => {
    const bad = PriceLine.safeParse({ metric: "m", unit: "call", price: -1 });
    expect(bad.success).toBe(false);
  });

  it("defaults currency to USD", () => {
    const p = PriceLine.parse({ metric: "m", unit: "call", price: 0.01 });
    expect(p.currency).toBe("USD");
  });

  it("enforces the publish workflow states", () => {
    expect(PublishStatus.safeParse("published").success).toBe(true);
    expect(PublishStatus.safeParse("live").success).toBe(false);
  });
});
