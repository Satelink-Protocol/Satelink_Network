// Sitemap coverage + no-drift (§19). Runs the REAL sitemap() and asserts every
// data-module route is present, redirected paths are absent, and there are no
// duplicate URLs. Composes @satelink/seo checkDuplicates over the sitemap so
// the SEO validators run against the live inventory, not a fixture.
import { describe, it, expect } from "vitest";
import sitemap from "@/app/sitemap";
import { checkDuplicates, type PageRecord } from "@satelink/seo";
import { PRODUCT_ORDER, PRODUCTS } from "@/lib/products";
import { PLATFORM_ORDER, PLATFORM } from "@/lib/platform";
import { SOLUTIONS_BY_COMPANY, SOLUTIONS_BY_USECASE, INDUSTRY_ORDER } from "@/lib/solutions";
import { LEGAL_ORDER } from "@/lib/legal";

const BASE = "https://satelink.network";
const entries = sitemap();
const urls = entries.map((e) => e.url);
const paths = new Set(urls.map((u) => u.replace(BASE, "")));

describe("sitemap coverage (§19)", () => {
  it("has no duplicate URLs", () => {
    const dupes = urls.filter((u, i) => urls.indexOf(u) !== i);
    expect(dupes, `duplicates: ${dupes.join(", ")}`).toEqual([]);
  });

  it("includes every product page and its machine-readable spec", () => {
    for (const slug of PRODUCT_ORDER) {
      expect(paths.has(PRODUCTS[slug].href), PRODUCTS[slug].href).toBe(true);
      expect(paths.has(`/products/${slug}.json`), `/products/${slug}.json`).toBe(true);
    }
  });

  it("includes every platform, solution, and industry route", () => {
    for (const slug of PLATFORM_ORDER) expect(paths.has(PLATFORM[slug].href), PLATFORM[slug].href).toBe(true);
    for (const s of [...SOLUTIONS_BY_COMPANY, ...SOLUTIONS_BY_USECASE]) expect(paths.has(`/solutions/${s}`), `/solutions/${s}`).toBe(true);
    for (const s of INDUSTRY_ORDER) expect(paths.has(`/solutions/industries/${s}`), s).toBe(true);
  });

  it("includes the legal pages and machine endpoints", () => {
    for (const s of LEGAL_ORDER) expect(paths.has(`/${s}`), s).toBe(true);
    for (const p of ["/pricing.json", "/.well-known/satelink.json", "/llms.txt", "/llms-full.txt"]) {
      expect(paths.has(p), p).toBe(true);
    }
  });

  it("excludes the redirected legacy paths", () => {
    expect(paths.has("/intelligence")).toBe(false);
    expect(paths.has("/rpc")).toBe(false);
  });

  it("passes the SEO duplicate-canonical check over the sitemap", () => {
    const records: PageRecord[] = urls.map((u) => ({ route: u, canonical: u }));
    const issues = checkDuplicates(records);
    expect(issues, JSON.stringify(issues)).toEqual([]);
  });
});
