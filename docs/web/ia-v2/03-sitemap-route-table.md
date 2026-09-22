# 03 — Sitemap & Route Table (satelink.network)

Canonical master route list (§5). Status legend: **EXISTS** (built in reposition),
**NEW** (build in IA-v2), **RESTYLE** (keep, restyle only), **REDIRECT** (see
`04-redirect-map.md`). Rendering: RSC by default, ISR for CMS/catalog content.

## Core / product
| Route | Status | Template | Notes |
| --- | --- | --- | --- |
| `/` | EXISTS→rework | Home | Lifecycle stepper SSR, live indicators |
| `/product/overview` | NEW | Overview | platform-wide overview + interactive selector |
| `/products/machine-commerce` | NEW | Product | **canonical** Machine Commerce |
| `/products/trading-intelligence` | EXISTS(`/intelligence`)→move | Product | **only Dodo checkout surface** |
| `/products/trading-intelligence/[metric]` | EXISTS→move | Product | 4 metrics from live catalog |
| `/products/rpc` | EXISTS(`/rpc`)→canonicalize | Product | crypto rail |
| `/products/x402` | NEW | Product | crypto rail |
| `/products/metering` | NEW | Product | credits + usage metering |

## Platform
| Route | Status |
| --- | --- |
| `/platform` | NEW (hub) |
| `/platform/api` | NEW (PlatformTemplate) |
| `/platform/x402` · `/platform/machine-identity` · `/platform/metering` | NEW |
| `/platform/payments` · `/platform/settlement` · `/platform/integrations` | NEW |
| `/platform/pricing` | REDIRECT 308 → `/pricing#platform` |

## Pricing / solutions
| Route | Status |
| --- | --- |
| `/pricing` | EXISTS→rework (audience switch, calculator, compare, live parity) |
| `/solutions` | NEW (hub) |
| `/solutions/{enterprise,startups,developers,ai-native}` | NEW (company size) |
| `/solutions/{ai-agents,commerce,machine-commerce,trading,api-monetization,automation}` | NEW (use case) |
| `/solutions/industries/[slug]` | NEW — `financial-services, ai, software, infrastructure, internet-services, developer-tools, enterprise-technology` |

## Developers
`/developers` · `/developers/quickstart` · `/developers/api` · `/developers/sdks` — NEW.

## Resources
| Route | Status |
| --- | --- |
| `/blog` · `/blog/[slug]` · `/blog/category/[slug]` | NEW |
| `/customer-stories` · `/customer-stories/[slug]` | NEW — **hidden from nav until ≥1 published** |
| `/news` · `/news/[slug]` | NEW |
| `/changelog` · `/changelog/[slug]` | NEW — seed from docs changelog |

## Academy / Support
`/academy` · `/academy/courses[/[slug]]` · `/academy/tutorials[/[slug]]` ·
`/academy/use-cases[/[slug]]` — NEW.
`/support` · `/support/[category]` · `/support/[category]/[slug]` ·
`/support/search` — NEW.

## Account / entry
| Route | Status | Notes |
| --- | --- | --- |
| `/status` | RESTYLE | existing |
| `/login` · `/signup` | NEW entry pages → existing console auth (do not rebuild auth) |
| `/dashboard` | REDIRECT 308 → `/satelink/os/mission-control` |
| `/contact-sales` | NEW | reuse corporate enquiry handler + persist to CMS Enquiries |
| `/contact` · `/terms` · `/privacy` · `/refund` | EXISTS |
| `/acceptable-use` · `/cookies` · `/security` · `/responsible-disclosure` · `/data-processing` | NEW — publish as Review, link only when Published |
| `/network` · `/network/run-a-node` | EXISTS(`/network`) / NEW |
| `/checkout` · `/checkout/success` · `/checkout/cancel` | EXISTS — keep |
| `/intelligence` | REDIRECT 308 → `/products/trading-intelligence` **only after** confirming no checkout/claim depends on it |
| `/intelligence/success` | EXISTS — **stays as-is** (#398 claim page) |
| `/search` | NEW (global) |

## Machine / SEO endpoints
`/llms.txt` · `/llms-full.txt` · `/sitemap.xml` · `/robots.txt` ·
`/.well-known/satelink.json` (proxy → rpc discovery) · `/products/[slug].json` ·
`/pricing.json` · `/styleguide` (noindex). Detail: `11-machine-geo-layer.md`.

## Nav visibility rules
`customer-stories` hidden until ≥1 published; new legal pages linked only once
Published; admin/OS/console never linked from the public site.
