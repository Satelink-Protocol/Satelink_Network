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

## Not yet run in this session (require the Vercel preview / founder — §10)
- Lighthouse CI against the preview URL (perf/a11y/best-practices/SEO budgets, LCP/CLS).
- Cross-viewport visual screenshots (375/768/1280, dark+light) → `docs/web/screenshots/`.
- Production smoke + truth-lint after merge.
