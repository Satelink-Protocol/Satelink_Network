import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Consoles and internal surfaces are app UIs, not content — keep
        // crawlers focused on the marketing site and documentation.
        // /tasks is a separate, flag-gated product (TASKS_PRODUCT_ENABLED,
        // default OFF) unrelated to the RPC/intelligence products — kept out
        // of the index even on the rare occasion it's enabled.
        disallow: [
          "/admin/",
          "/ops/",
          "/api/",
          "/satelink/os/",
          "/login",
          "/tasks",
          "/checkout",
          "/checkout/",
          "/styleguide",
          "/machine-console",
          "/design",
        ],
      },
    ],
    sitemap: "https://satelink.network/sitemap.xml",
  };
}
