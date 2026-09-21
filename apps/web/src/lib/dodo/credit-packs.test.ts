import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("credit pack catalog parsing", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns empty when unset", async () => {
    delete process.env.NEXT_PUBLIC_DODO_CREDIT_PACKS;
    const { getCreditPacks } = await import("./credit-packs");
    expect(getCreditPacks()).toEqual([]);
  });

  it("parses a single productId:usdValue:Label entry", async () => {
    process.env.NEXT_PUBLIC_DODO_CREDIT_PACKS = "pdt_abc:9.99:Starter Pack";
    const { getCreditPacks } = await import("./credit-packs");
    expect(getCreditPacks()).toEqual([{ productId: "pdt_abc", usdValue: 9.99, label: "Starter Pack" }]);
  });

  it("parses multiple comma-separated entries", async () => {
    process.env.NEXT_PUBLIC_DODO_CREDIT_PACKS = "pdt_a:9.99:Small,pdt_b:49.99:Big";
    const { getCreditPacks } = await import("./credit-packs");
    expect(getCreditPacks()).toHaveLength(2);
    expect(getCreditPacks()[1]).toEqual({ productId: "pdt_b", usdValue: 49.99, label: "Big" });
  });

  it("defaults label to the productId when omitted", async () => {
    process.env.NEXT_PUBLIC_DODO_CREDIT_PACKS = "pdt_nolabel:5";
    const { getCreditPacks } = await import("./credit-packs");
    expect(getCreditPacks()[0].label).toBe("pdt_nolabel");
  });

  it("drops entries with a non-positive or non-numeric usdValue", async () => {
    process.env.NEXT_PUBLIC_DODO_CREDIT_PACKS = "pdt_zero:0:Zero,pdt_bad:notanumber:Bad,pdt_ok:5:OK";
    const { getCreditPacks } = await import("./credit-packs");
    expect(getCreditPacks()).toEqual([{ productId: "pdt_ok", usdValue: 5, label: "OK" }]);
  });

  it("findCreditPack locates by productId, undefined if not configured", async () => {
    process.env.NEXT_PUBLIC_DODO_CREDIT_PACKS = "pdt_a:9.99:Small";
    const { findCreditPack } = await import("./credit-packs");
    expect(findCreditPack("pdt_a")?.usdValue).toBe(9.99);
    expect(findCreditPack("pdt_missing")).toBeUndefined();
  });
});
