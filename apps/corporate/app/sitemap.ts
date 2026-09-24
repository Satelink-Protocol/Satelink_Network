import type { MetadataRoute } from "next";
import { businesses } from "@/content/businesses";
import { news } from "@/content/people";

const SITE = "https://jakuraa.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "",
    "/company",
    "/company/leadership",
    "/businesses",
    ...businesses.map((b) => `/businesses/${b.slug}`),
    "/technology",
    "/news",
    ...news.map((n) => `/news/${n.slug}`),
    "/careers",
    "/contact",
    "/legal",
    "/legal/company-information",
    "/legal/privacy",
    "/legal/terms",
    "/legal/grievance",
  ];
  return paths.map((path) => ({
    url: `${SITE}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
