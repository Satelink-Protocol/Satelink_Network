# 21 — File / Route Implementation List

The concrete build list (Phase 3 gate = this list complete). Paths are what each
later phase creates. ✅ = already exists.

## packages/ (Phase 2 — done)
- ✅ `packages/web-ui/**` — `@satelink/web-ui` (Signal, extracted)
- ✅ `packages/content/**` — `@satelink/content` (schemas, client, site)
- ✅ `packages/seo/**` — `@satelink/seo` (jsonld, metadata, llms, validators)
- `packages/web-ui/src/blocks/**` — RSC renderers for the CMS block inventory (Phase 6)
- `packages/web-ui/src/diagrams/**` — lifecycle / payment-flow / settlement SVGs (Phase 6)
- `packages/content/src/fallback/*.json` — fallback fixtures per app (Phase 4)

## apps/cms/ (Phase 4 — Payload 3)
- `apps/cms/package.json`, `next.config`, `payload.config.ts`
- `apps/cms/src/collections/*.ts` — the 25 collections (`12`/`16`)
- `apps/cms/src/globals/*.ts` — Navigation, Footer, SiteSettings, SEODefaults, RobotsConfig
- `apps/cms/src/access/*.ts` — RBAC (8 roles), 2FA, audit-log hooks
- `apps/cms/src/hooks/*.ts` — truth hooks (banned-phrase, Dodo-scope, pricing-parity, verifiedAt)
- `apps/cms/src/blocks/*.ts` — Payload block configs (mirror `07` inventory)
- `apps/cms/seed/*.ts` — idempotent seed (`18`)
- `apps/cms/src/jobs/*.ts` — scheduled publish (Vercel Cron), revalidation webhook

## apps/web/ new routes (Phases 5–10)
Shell (Phase 5): data-driven `SiteHeader`/`SiteFooter` from CMS Navigation/Footer,
`Breadcrumbs`, ⌘K `SearchPalette`, Redirect middleware, theme.
Pages (Phases 6–10) — `src/app/(marketing)/…` unless noted:
- `product/overview/page.tsx`
- `products/machine-commerce/page.tsx` · `products/x402/page.tsx` ·
  `products/metering/page.tsx` · `products/rpc/page.tsx` (canonicalize existing `/rpc`)
- move `intelligence` → `products/trading-intelligence/{page,[metric]}` (+ redirect)
- `platform/page.tsx` + `platform/{api,x402,machine-identity,metering,payments,settlement,integrations}/page.tsx`
- `pricing/page.tsx` (rework: audience switch, calculator, compare, live parity)
- `solutions/page.tsx` + `solutions/{enterprise,startups,developers,ai-native,ai-agents,commerce,machine-commerce,trading,api-monetization,automation}/page.tsx`
- `solutions/industries/[slug]/page.tsx`
- `developers/{page,quickstart,api,sdks}/page.tsx`
- `blog/{page,[slug],category/[slug]}/page.tsx`
- `customer-stories/{page,[slug]}/page.tsx` (nav-hidden until ≥1)
- `news/{page,[slug]}/page.tsx` · `changelog/{page,[slug]}/page.tsx`
- `academy/{page,courses,courses/[slug],tutorials,tutorials/[slug],use-cases,use-cases/[slug]}/page.tsx`
- `support/{page,[category],[category]/[slug],search}/page.tsx`
- `contact-sales/page.tsx` · `search/page.tsx`
- legal: `acceptable-use,cookies,security,responsible-disclosure,data-processing` (Review)
- entry: `login,signup` (→ console auth); `dashboard` 308; `network/run-a-node`
- API: `src/app/api/contact-sales/route.ts`, extend `corporate-enquiry` + a
  `support-feedback` route → persist to CMS `Enquiries`
- Machine/GEO (Phase 10): `products/[slug].json/route.ts`, `pricing.json/route.ts`,
  `.well-known/satelink.json/route.ts`, `llms.txt` + `llms-full.txt` generators,
  extend `sitemap.ts`/`robots.ts`, per-page JSON-LD.

## apps/corporate/ (Phase 11 — jakuraa.com)
- `apps/corporate/**` Next app; routes per `09-corporate-site.md`
- shares `@satelink/web-ui` (light theme) + reads CMS via `CMS_API_URL`

## docs (Phase 9)
- restructure in-app portal nav (`apps/web/src/lib/docs.ts` categories); add search,
  copy buttons, language tabs, version selector, TOC, prev/next, edit/feedback, docs
  `llms.txt`; move operator docs under "Operators"
- `docs/web/DOCS_MIGRATION.md` (diff root `docs/` Mintlify vs in-app; archive root)

## Architecture registration
Workspaces auto-register `apps/*` + `packages/*` (npm globs). `arch` cruises only
`libs tools workers` — new apps/packages compliant by default (`08` discovery).

## CI (Phase 13)
Add jobs: `seo:check`, `link-graph`, `pricing-parity`, `llms-freshness`,
Lighthouse CI, axe, extend Playwright; wire into `.github/workflows`.
