import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Consoles and internal surfaces are app UIs, not content — keep
        // crawlers focused on the marketing site and documentation.
        disallow: ["/admin/", "/ops/", "/api/", "/satelink/os/", "/login"],
      },
    ],
    sitemap: "https://satelink.network/sitemap.xml",
  };
}
