import type { MetadataRoute } from "next";
import { DOCS } from "@/lib/docs";

const BASE = "https://satelink.network";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const marketing: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/machine`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/node`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/node/setup`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/status`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${BASE}/docs`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
  ];
  const docs: MetadataRoute.Sitemap = DOCS.map((d) => ({
    url: `${BASE}/docs/${d.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));
  return [...marketing, ...docs];
}
