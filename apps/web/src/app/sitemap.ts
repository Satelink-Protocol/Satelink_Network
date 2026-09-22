import type { MetadataRoute } from "next";
import { DOCS } from "@/lib/docs";
import { getFallbackCatalog } from "@/lib/intelligence";

const BASE = "https://satelink.network";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const metrics: MetadataRoute.Sitemap = getFallbackCatalog().metrics.map((m) => ({
    url: `${BASE}/intelligence/${m.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.8,
  }));
  const marketing: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/intelligence`, lastModified: now, changeFrequency: "weekly", priority: 0.95 },
    ...metrics,
    { url: `${BASE}/corporate`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${BASE}/machine`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/network`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/rpc`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/node`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/node/setup`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/status`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${BASE}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    // Compliance pages — not excluded, so Dodo (and anyone else) can find
    // them without needing the exact URL.
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/refund`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    // Deliberately excluded: /tasks (separate, flag-gated product — see
    // TASKS_PRODUCT_ENABLED), /admin, /satelink/os (internal consoles,
    // already disallowed in robots.ts).
  ];
  const docs: MetadataRoute.Sitemap = DOCS.map((d) => ({
    url: `${BASE}/docs/${d.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));
  return [...marketing, ...docs];
}
