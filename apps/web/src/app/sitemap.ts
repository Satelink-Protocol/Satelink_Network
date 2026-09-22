// Sitemap (§12) — the full IA-v2 public route set, generated from the same
// data modules the pages use (no drift). Excludes redirected paths
// (/intelligence, /rpc), noindex pages (customer-stories, /support/search,
// /styleguide), and the internal consoles (disallowed in robots.ts).
import type { MetadataRoute } from "next";
import { DOCS } from "@/lib/docs";
import { getFallbackCatalog } from "@/lib/intelligence";
import { PRODUCT_ORDER, PRODUCTS } from "@/lib/products";
import { PLATFORM_ORDER, PLATFORM } from "@/lib/platform";
import { SOLUTIONS_BY_COMPANY, SOLUTIONS_BY_USECASE, INDUSTRY_ORDER } from "@/lib/solutions";
import { POSTS } from "@/lib/resources";
import { TUTORIALS, USE_CASES } from "@/lib/academy";
import { nonEmptyCollections, ARTICLES } from "@/lib/support";
import { LEGAL_ORDER } from "@/lib/legal";

const BASE = "https://satelink.network";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const e = (path: string, priority = 0.7, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] = "monthly") =>
    ({ url: `${BASE}${path}`, lastModified: now, changeFrequency, priority });

  const core = [
    e("/", 1, "weekly"),
    e("/product/overview", 0.9, "weekly"),
    e("/pricing", 0.9, "weekly"),
    e("/platform", 0.85, "weekly"),
    e("/solutions", 0.85, "weekly"),
    e("/developers", 0.85, "weekly"),
    e("/developers/quickstart", 0.8, "weekly"),
    e("/developers/api", 0.75),
    e("/developers/sdks", 0.7),
    e("/academy", 0.7, "weekly"),
    e("/academy/tutorials", 0.7),
    e("/academy/use-cases", 0.7),
    e("/academy/courses", 0.5),
    e("/support", 0.7, "weekly"),
    e("/blog", 0.7, "weekly"),
    e("/news", 0.6, "weekly"),
    e("/changelog", 0.6, "weekly"),
    e("/corporate", 0.8),
    e("/contact-sales", 0.7),
    e("/contact", 0.4),
    e("/signup", 0.5),
    e("/network", 0.6),
    e("/network/run-a-node", 0.6),
    e("/status", 0.6, "daily"),
    e("/docs", 0.9, "weekly"),
    // Machine-readable endpoints.
    e("/.well-known/satelink.json", 0.5),
    e("/pricing.json", 0.5),
    e("/llms.txt", 0.5),
    e("/llms-full.txt", 0.4),
  ];

  const products = PRODUCT_ORDER.flatMap((slug) => [
    e(PRODUCTS[slug].href, 0.9, "weekly"),
    e(`/products/${slug}.json`, 0.4),
  ]);
  const metrics = getFallbackCatalog().metrics.map((m) => e(`/products/trading-intelligence/${m.slug}`, 0.8, "weekly"));
  const platform = PLATFORM_ORDER.map((slug) => e(PLATFORM[slug].href, 0.75));
  const solutions = [...SOLUTIONS_BY_COMPANY, ...SOLUTIONS_BY_USECASE].map((s) => e(`/solutions/${s}`, 0.75));
  const industries = INDUSTRY_ORDER.map((s) => e(`/solutions/industries/${s}`, 0.65));
  const posts = POSTS.map((p) => e(`/${p.section}/${p.slug}`, 0.6, "weekly"));
  const tutorials = TUTORIALS.map((t) => e(`/academy/tutorials/${t.slug}`, 0.65));
  const useCases = USE_CASES.map((u) => e(`/academy/use-cases/${u.slug}`, 0.6));
  const supportCollections = nonEmptyCollections().map((c) => e(`/support/${c.slug}`, 0.6));
  const supportArticles = ARTICLES.map((a) => e(`/support/${a.collection}/${a.slug}`, 0.5));
  // LEGAL_ORDER now includes terms/privacy/refund (P4), so no manual concat.
  // operator-terms is network-scoped (not in LEGAL_ORDER) but listed for SEO.
  const legal = LEGAL_ORDER.map((s) => e(`/${s}`, 0.5)).concat([e("/network/operator-terms", 0.4)]);
  const docs = DOCS.map((d) => e(`/docs/${d.slug}`, 0.7, "weekly"));

  return [
    ...core,
    ...products,
    ...metrics,
    ...platform,
    ...solutions,
    ...industries,
    ...posts,
    ...tutorials,
    ...useCases,
    ...supportCollections,
    ...supportArticles,
    ...legal,
    ...docs,
  ];
}
