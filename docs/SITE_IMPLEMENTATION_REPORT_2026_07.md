# Website & Documentation Transformation — Implementation Report

**Date:** 2026-07-07 · **Branch:** `site/website-docs-transformation` (stacked on `ui/finished-dashboard`, PR #236)
Companion audit: `docs/SITE_AUDIT_2026_07.md` (Phase 1, written before any change).

## Files changed

**Marketing site**
- `apps/web/src/app/page.tsx` — full content refresh (fabrications removed, live metrics, honest roadmap, working mobile nav, real contract addresses, fixed routes)
- `apps/web/src/app/globals.css` — mobile nav drawer, AA contrast fixes (footer/muted text)
- `apps/web/src/app/layout.tsx` — metadata rewrite (title template, keywords, OG/Twitter), Organization + SoftwareApplication JSON-LD, RSS alternate link
- `apps/web/vercel.json` — app-subdomain redirect fixed to an existing route

**Documentation portal (new)**
- `apps/web/src/lib/docs.ts` — docs registry (19 pages, 6 categories)
- `apps/web/src/app/docs/{layout.tsx,page.tsx,docs.css}` + `apps/web/src/app/docs/[slug]/page.tsx` — portal shell, index, article renderer (react-markdown + remark-gfm), per-page canonical/OG metadata, TechArticle + BreadcrumbList JSON-LD
- `apps/web/src/content/docs/*.md` — 19 content pages, all sourced from the repository and corrected against production
- `apps/web/src/middleware.ts` — `docs` subdomain → `/docs` host mapping

**SEO / AI**
- `apps/web/src/app/sitemap.ts`, `robots.ts`, `not-found.tsx`, `feed.xml/route.ts` (RSS)
- `apps/web/public/llms.txt` — rewritten (old file claimed 1000/day free tier and 60-second settlement)

## New pages
`/docs` index + 19 articles: quick-start, architecture, authentication, api-reference, sdk, machine-customers, billing, pricing, revenue-model, node-operators, developer-guide, admin-guide, security, troubleshooting, deployment, faq, glossary, changelog, roadmap. Plus `/feed.xml`, dynamic `robots.txt`/`sitemap.xml`, and a proper 404.

## Removed pages
- 9 legacy `public/*.html` duplicates: about, blog, careers, press, compare, calculator, wiki, index, landing-page (`privacy.html` + `terms.html` kept — legal)
- Old `/docs` 4-link wiki hub (replaced by the portal)
- Conflicting static `public/robots.txt` + `public/sitemap.xml` (replaced by app-router versions)

## Redirects / navigation fixes
- `app.satelink.network` root redirect → `/satelink/os/mission-control` (was → nonexistent `/satelink/os/overview`)
- 6 broken homepage links fixed (`/satelink/os/overview` ×4, `/satelink/os/nodes` ×2); footer rebuilt to real routes; mobile hamburger now actually opens a menu (44px touch targets); unverified Discord/Twitter links removed
- Zero broken internal links verified by crawl (31 unique targets from 7 pages)

## Content corrections (accuracy)
- Removed 2 fake testimonials, hardcoded 99.8% uptime / 85ms latency (×3), a fake "99.9% delivery guarantee" for an unshipped product, and stale subscription tiers ($9/$49/$199 — do not exist)
- Contract references corrected everywhere to RevenueVault V2 `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF` (old `0x6987…1CC9` ClaimsContract removed from site + wiki)
- Free tier corrected to 500 calls/day; settlement cadence corrected from "every 60s" to ~10-minute epochs; settlement dry-run status stated honestly on site, docs, and wiki
- Roadmap rebuilt as Completed / In Progress / Next Milestones / Planned from repository truth (no invented quarter commitments)

## GitHub Wiki
All 9 wiki pages rewritten as short corrected mirrors with a canonical banner pointing to docs.satelink.network; pushed live (`9e71a35`). Hierarchy is now: repository → docs portal → wiki mirror.

## SEO / AI improvements
Title template + per-page titles/descriptions/canonicals; Organization, SoftwareApplication, WebSite, TechArticle, BreadcrumbList JSON-LD; OG + Twitter cards; XML sitemap covering marketing + all docs; robots.txt excluding consoles; RSS changelog feed; rewritten llms.txt; semantic headings (h1→h2→h3 fixed), labeled form controls, AA contrast.

## Verification
- **Lighthouse (production build):** homepage **accessibility 100 / SEO 100**; docs article **90 / 100**
- **Link crawl:** 31 internal links, **zero broken**
- **`next build`:** passes — 65 static pages including all 19 docs articles
- Screenshots at 1440/390 for homepage and docs portal captured during QA

## Remaining TODO / blockers requiring manual action
1. **DNS for docs.satelink.network** — CNAME → `cname.vercel-dns.com` and add the domain in the Vercel project (Settings → Domains). The middleware host-map is already in place; until DNS, docs are live at `satelink.network/docs`.
2. `og-image.png` referenced in OG metadata should be produced as a real branded 1200×630 asset (currently whatever exists in `public/`).
3. `privacy.html` / `terms.html` are legacy static pages — content should get a legal review and eventually move into the app router.
4. `/machine`, `/node`, `/status` inherit correct global metadata but could each get bespoke titles/descriptions in a follow-up.
5. Docs search (client-side index) — deliberately deferred; IA is small enough to browse.

## Lighthouse targets
Maintained ≥ 90 accessibility and ≥ 90 SEO on all public pages (homepage currently 100/100 on the production build).
