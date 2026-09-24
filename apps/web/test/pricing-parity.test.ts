// Pricing parity (§12/§19) — the machine-readable contract and the documented
// constants must match the live catalog (here: the audited fallback). If the
// catalog moves, this fails until the constants/JSON are reconciled. Locks the
// "CMS/display pricing == live catalog" rule.
import { describe, it, expect } from "vitest";
import { getFallbackCatalog } from "@/lib/intelligence";
import { buildPricingJson, buildProductJson } from "@/lib/machine";
import { FLAT_RATE_USD, X402_BUNDLE, STARTER_PACK_USD, PRODUCT_ORDER } from "@/lib/products";

const catalog = getFallbackCatalog();

describe("pricing parity (§12)", () => {
  it("documented constants match the audited values", () => {
    expect(FLAT_RATE_USD).toBe(0.00003);
    expect(X402_BUNDLE).toEqual({ priceUsd: 0.1, calls: 1000 });
    expect(STARTER_PACK_USD).toBe(9.99);
  });

  it("Trading Intelligence product JSON prices equal the catalog metric prices", () => {
    const pj = buildProductJson("trading-intelligence", catalog);
    const byMetric = Object.fromEntries(pj.pricing.map((p) => [p.metric, p.price]));
    for (const m of catalog.metrics) {
      expect(byMetric[m.slug], `price for ${m.slug}`).toBe(m.priceUsd);
    }
  });

  it("RPC / metering / machine-commerce bill at the flat per-call rate", () => {
    for (const slug of ["rpc", "metering", "machine-commerce"] as const) {
      const pj = buildProductJson(slug, catalog);
      expect(pj.pricing.some((p) => p.price === FLAT_RATE_USD), `${slug} flat rate`).toBe(true);
    }
  });

  it("x402 product JSON reflects the documented bundle", () => {
    const pj = buildProductJson("x402", catalog);
    expect(pj.pricing[0].price).toBe(X402_BUNDLE.priceUsd);
  });

  it("pricing.json lists every product with at least one price line", () => {
    const pricing = buildPricingJson(catalog);
    expect(pricing.products.map((p) => p.slug).sort()).toEqual([...PRODUCT_ORDER].sort());
    for (const p of pricing.products) expect(p.prices.length).toBeGreaterThan(0);
  });
});
