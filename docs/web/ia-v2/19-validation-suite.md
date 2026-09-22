# 19 — Validation Suite (all CI-blocking)

§19. Self-debug loop on failure: log → one-line root cause → fix → rerun full gate
→ record in `docs/web/VERIFICATION.md`.

| Gate | Tool | Scope |
| --- | --- | --- |
| typecheck | `tsc` | all apps + packages |
| lint | eslint | all |
| unit | vitest | existing 43 (apps/web) + packages (9) + new |
| E2E | Playwright | every sitemap route 200/308, mega-menu keyboard nav, search, pricing calculator math, checkout unchanged, **#398 claim-token check**, contact-sales form, support feedback, CMS publish→page updates (revalidation), scheduled publish, rollback |
| seo:check | `@satelink/seo/validators` | missing/duplicate meta, alt, JSON-LD, orphan, broken links, sitemap drift |
| link-graph | `@satelink/seo` `checkLinkGraph` | no orphan (≥2 inbound), no broken internal links |
| truth-lint | apps/web `test/truth-lint` (extended to CMS content) | banned phrases, "—" in stat tiles, Dodo outside Trading Intelligence, invented-data guard on testimonial/person/customer docs without `verifiedAt` |
| pricing-parity | CI job | fetch `rpc.satelink.network/v1/intelligence`; fail if any CMS price for a live product differs; no recurring plan while backend is one-time only |
| JSON-LD validation | schema-dts + structured-data test | all pages |
| llms.txt freshness | `@satelink/seo` | regenerated matches committed |
| Lighthouse CI | budgets from `15-design-and-performance.md` | key routes |
| axe a11y | axe | every template |
| M0 architecture guard | `npm run test:arch` | `tools/architecture-tests` |
| hex-gate | apps/web `test/hex-gate` | reposition + `@satelink/web-ui` components |

## Payments-boundary checks (hard)
- Dodo button/logo/checkout present **only** on Trading Intelligence surfaces.
- RPC/x402/USDT/settlement pages carry the "not billed through Dodo" label and no
  Dodo element.
- Trading/Financial-Services solution + industry pages: data/research tooling only
  — no advice/signals/execution/strategies/returns/custody language.

## Backend-untouched check
No diff to economics, billing, credits, webhooks, the #398 claim-token flow, or
production API contracts. The website is a presentation/content layer.
