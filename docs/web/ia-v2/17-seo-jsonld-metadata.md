# 17 — SEO / JSON-LD / Metadata Plan

All builders in `@satelink/seo`; per-page data from CMS `seo`/`geo` fields. §12.

## Per-page metadata (Next `Metadata` via `buildMetadata`)
Single title, description, canonical (absolute), OG (title/description/url/
siteName/type/image), Twitter (summary_large_image). `noindex` for
checkout/styleguide/admin. Canonical is **per-page** (the root blanket-canonical
bug is already fixed in the reposition — never reintroduce).

## JSON-LD graph per page type
| Page type | Graph |
| --- | --- |
| Any | `Organization` + `WebSite` (SearchAction) sitewide + `WebPage` + `BreadcrumbList` |
| Product | + `Product`/`Offer` (or `SoftwareApplication`) |
| Blog/News | + `Article`/`NewsArticle` |
| Tutorial | + `TechArticle` + `HowTo` |
| Any with visible FAQ | + `FAQPage` |
| Corporate leadership | `Organization` with `founder`, verified `Person` list |

## GEO layer
Answer-first ≤50-word entity block per major page (from CMS `geo.entityDefinition`),
mirrored into `llms.txt` and the JSON-LD `description`. `keyFacts[]` + `sources[]`
render as a visible "key facts" strip on product/solution pages.

## Validators (`seo:check`, CI-blocking) — `@satelink/seo/validators`
Missing title/description/canonical · duplicate titles/descriptions/slugs/
canonicals · missing alt · invalid JSON-LD (schema-dts + structured-data test) ·
orphan pages · broken links · sitemap drift · llms.txt freshness. Runs over the
built route set + CMS graph in CI; fails the build on any issue.

## Sitemap / robots
Extend `apps/web/src/app/sitemap.ts` for every new public route (products,
platform, solutions, developers, blog, news, changelog, academy, support). Keep
admin/OS/checkout/styleguide disallowed in `robots.ts`. `sitemap-drift` check
guarantees the sitemap and the published route set never diverge.
