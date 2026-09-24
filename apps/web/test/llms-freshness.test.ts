// llms.txt freshness (§12/§19). The generated llms.txt must mention every
// current product and the canonical concepts — so it never goes stale relative
// to the catalog/products it advertises.
import { describe, it, expect } from "vitest";
import { generateLlmsTxt } from "@satelink/seo";
import { getFallbackCatalog } from "@/lib/intelligence";
import { buildLlmsInput } from "@/lib/machine";
import { PRODUCTS, PRODUCT_ORDER } from "@/lib/products";

const txt = generateLlmsTxt(buildLlmsInput(getFallbackCatalog()));

describe("llms.txt freshness (§12)", () => {
  it("names every current product", () => {
    for (const slug of PRODUCT_ORDER) {
      expect(txt, `mentions ${PRODUCTS[slug].name}`).toContain(PRODUCTS[slug].name);
      expect(txt, `links /products/${slug}`).toContain(`/products/${slug}`);
    }
  });

  it("advertises discovery, the catalog, and payment", () => {
    expect(txt).toContain("Discovery:");
    expect(txt).toContain("Catalog:");
    expect(txt.toLowerCase()).toContain("x402");
  });

  it("leads with the machine-commerce positioning", () => {
    expect(txt).toContain("Machine Commerce");
  });
});
