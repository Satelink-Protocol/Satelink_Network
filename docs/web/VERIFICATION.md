# Verification — gate results, bugs found, fixes

Running log of gates for the machine-commerce reposition. Each build/test run is captured; failures get a one-line root cause + fix.

## Build gate (`next build`)
| # | Scope | Result | Notes |
| --- | --- | --- | --- |
| 1 | tokens + components + styleguide | ❌ → root cause | CSS comment contained `--bg-*/--text-*`; the `*/` closed the comment early → "Unknown word". |
| — | fix | — | Reworded comments in `globals.css` + `tokens.css` to remove `*/`. |
| 2 | tokens + components + styleguide | ✅ | `/styleguide` prerenders static; all `sl-*` utilities generate. |
| 3 | + checkout group | ✅ | `/checkout` (ƒ), `/checkout/cancel` (○), `/checkout/success` (ƒ). |
| 4 | + corporate + pricing | ✅ | `/corporate` ○, `/pricing` ISR (5m), `/api/corporate-enquiry` ƒ. |
| 5 | + home moved into (marketing) | ✅ | old `src/app/page.tsx` removed. |
| 6 | + intelligence + per-metric | ✅ | 4 metric pages prerender static (SSG). |
| 7 | + /machine SSR, dashboard → /machine-console | ✅ | middleware repointed. |
| 8 | + /network + /rpc + sitemap/robots | ✅ | all routes compile. |

Final: `next build` **EXIT=0**.

## Truth-lint + hex-gate (Vitest)
| Run | Result | Notes |
| --- | --- | --- |
| initial | ❌ | terms page "guaranteed" (legal disclaimer) flagged → excluded legal pages. |
| after /network | ❌ | estimator "not guaranteed" flagged → banned the *promissory* `guaranteed returns/profit/…`, not the bare word. |
| final | ✅ | **43/43** web vitest pass (6 new gate tests + 37 existing). |

Gate coverage:
- **Hex gate**: no hardcoded hex in reposition `.tsx` outside the allowlist (`TerminalWindow`, chart/palette, og, icon). Comments stripped so `#398`-style refs don't false-positive. Scoped to the reposition surface (admin/OS/console use the separate `@satelink/ui` system — out of scope).
- **Truth lint**: no banned trading-advice phrases in product/checkout copy; no literal `—` passed as a StatTile value; every Dodo product/checkout surface renders a `<Disclosure>`.

## Bugs found & fixed during the build-out
1. CSS comment `*/` premature close (build 1) — fixed.
2. Blanket root canonical made every page canonical to `/` — removed; per-page canonicals added.
3. `/status` apex 308-redirects to status.satelink.network — kept (documented), restyle only.
4. Contact email mismatch (`support@` vs `satelinknetwork@gmail.com`) — standardized on the audited legal contact.

## Playwright E2E
Specs added under `apps/web/e2e/`: route smoke (16 routes + noindex + unknown-plan redirect + model-limitations), checkout (mocked Dodo session, consent gating, redirect, retryable error, stale-claim → "Missing claim reference", cancel), corporate (validation, happy path, honeypot hidden, 429). Config: `apps/web/playwright.config.ts` (local prod server on :3100, or `PW_BASE_URL` for a preview). Run: `npm run e2e`.

**Result: 28/28 passing** (fresh `next build` + `next start`, chromium). Unit: **43/43** vitest.

Three harness bugs found & fixed to reach green:
1. **vitest collected the Playwright specs** (`e2e/**` use Playwright's `test()`, not vitest) → 3 false failures. Fixed: added `e2e/**` to `vitest.config.ts` `test.exclude`.
2. **Checkout pay button stayed disabled** — `configured` derives from `NEXT_PUBLIC_DODO_CREDIT_PACKS`, inlined at build time and unset locally. Fixed: `playwright.config.ts` `webServer` now builds+serves with a test pack (`pdt_e2e_starter:9.99:Starter Pack`); the Dodo network call itself is still mocked in-spec.
3. **Honeypot `#website` measured visible** — parent `overflow-hidden` doesn't clip the child's own bounding box, so Playwright saw it. Fixed: added `invisible` (visibility:hidden, inherited) to the honeypot wrapper in `EnquiryForm.tsx`; still submitted, still traps bots. Also hardened the redirect spec to stub the external `checkout.dodopayments.com` domain (was hitting the live site, which 302'd `/mock-session` → `/error/not-found`).
<!-- E2E-RESULT -->

## Phase 7 — Core pages (IA-v2)
Built the machine-commerce core surface on `feat/web-ia-v2-claude-pattern`:
- **7.1 Home rework** — §8 IA: hero ("software that pays software") → live network
  strip → "what is machine commerce?" entity → lifecycle stepper (SSR) → products
  grid (5) → how it works (6 steps) → audiences → on-chain proof → live pricing
  summary → resources → CTA. Home no longer mentions Dodo (moved to TI/pricing).
- **7.2 `/product/overview`** — value cards, put-to-work tasks, principles, capability
  grid, and the interactive "I'm building X and I need Y" selector (role × need →
  product, a real request, its live price, docs link).
- **7.3 Products** — 5 product pages via a single-sourced `lib/products.ts` +
  `ProductPageView` (machine-commerce, rpc, x402, metering) and a bespoke Dodo
  surface for trading-intelligence; 4 metric pages under
  `/products/trading-intelligence/[metric]`. `/intelligence`, `/rpc`, and the four
  metric slugs 308 to their new homes via `middleware.ts` (edge-cached, per that
  file's own comment); `/intelligence/success` is deliberately NOT redirected.
- **7.4 `/platform`** — hub + 7 sub-pages (api, x402, machine-identity, metering,
  payments, settlement, integrations) via `lib/platform.ts` + `PlatformPageView`
  (PlatformTemplate order; console maps to real `/satelink/os` screens; "Draft"/
  "Planned" pills on surfaces not live; changelog carousel auto-hidden).
- **7.5 `/pricing` rework** — audience switch, usage calculator (live prices),
  compare table, live rate card (canonical links), `#platform` anchor (target of
  the `/platform/pricing` redirect), shared-balance disclosure (truthful), x402
  explainer, `pricing.json` link, grouped FAQ. No recurring plan.

**Gate (Phase 7): all green.**
- `next build` **EXIT=0** (90 static pages; the 9 new product/metric routes +
  8 platform routes + overview prerender).
- Unit **43/43** (truth-lint + hex-gate hold — new pages are token-only, and the
  only Dodo-mentioning marketing pages, `/products/trading-intelligence` and
  `/pricing`, both render a `<Disclosure>`).
- Packages **9/9** · arch (tools) **9/9**.
- E2E **55/55** (up from 39): +17 new route smoke, both product-move redirects,
  the `/intelligence/success` survival check, and the overview selector.

Judgment calls (no founder needed):
- Product/pricing/platform content is single-sourced in `apps/web/src/lib/{products,platform}.ts`
  (facts from CLAUDE.md 2026-07-16 + apps/api). Live TI price comes from the catalog;
  the flat $0.00003 rate and the $0.10=1,000-call x402 bundle are documented constants.
- Dropped the old `/rpc` page's unverified "500-req/day free tier" claim during the
  `/rpc → /products/rpc` canonicalization (not in the audited facts).
- Console screens are linked, not screenshotted — no invented image assets.

## Phases 8–14 — the rest of the IA-v2 surface
Built on top of Phase 7, each phase gated + committed:
- **8 Solutions** — hub + 10 solutions (company-size + use-case) + 7 industries
  (`lib/solutions.ts` + `SolutionPageView`). Proof section auto-hidden; no certs.
- **9 Developers** — hub, quickstart (live-endpoint steps + one Illustrative x402
  step), API surface, SDKs (x402-kit live; SDK/MCP Planned).
- **10 Resources** — blog/news/changelog seeded from real shipped milestones
  only (`lib/resources.ts`); customer-stories empty + noindex + nav-hidden.
- **11 Academy + Support** — academy hub/tutorials(live)/use-cases/courses(empty)
  + support home/[category]/[slug]/search (`lib/academy.ts`, `lib/support.ts`).
  Fixed: removed the dead `support` afterFiles rewrite prefix that shadowed
  `/support/[category]`.
- **12 Entry + legal + APIs** — /signup (left /login = console auth alone),
  /contact-sales + POST /api/contact-sales, /network/run-a-node, five Review
  policy pages, POST /api/support-feedback.
- **13 Machine/GEO + SEO** — /products/{slug}.json, /pricing.json,
  /.well-known/satelink.json, /llms.txt + /llms-full.txt (replacing the static
  one), sitemap rewrite, robots, and Product/Breadcrumb/FAQ + Article JSON-LD.
- **14 Validation suite** — `apps/web/test/{pricing-parity,sitemap-coverage,
  llms-freshness}.test.ts` run the @satelink/seo validators against the REAL
  route inventory + catalog (not fixtures): pricing parity vs the live catalog,
  full sitemap coverage / no-drift / no dupes, llms.txt freshness.

**Final cumulative gate (all phases): build EXIT=0 · unit 57/57 · packages 9/9 ·
arch 9/9 · E2E 99/99.** Truth-lint + hex-gate hold across all new pages (Dodo
appears only on `/products/trading-intelligence` and `/pricing`, both with a
`<Disclosure>`; every marketing page is token-only).

Deferred to §18 / founder (unchanged): Lighthouse-CI + axe against a Vercel
preview URL, CMS wiring (`CMS_API_URL`), and the CI workflow jobs. Contact-sales
and support-feedback log today and persist to CMS Enquiries/Feedback once wired.

## Not yet run in this session (require the Vercel preview / founder — §10)
- Lighthouse CI against the preview URL (perf/a11y/best-practices/SEO budgets, LCP/CLS).
- Cross-viewport visual screenshots (375/768/1280, dark+light) → `docs/web/screenshots/`.
- Production smoke + truth-lint after merge.
