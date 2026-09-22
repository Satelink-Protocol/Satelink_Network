# Sitemap — routes, purpose, data source, indexability

Generated routes: `src/app/sitemap.ts` (XML sitemap) and `src/app/robots.ts`. Indexable = in the sitemap and allowed by robots; noindex = excluded + robots-disallowed or `robots: noindex` metadata.

## Marketing (`(marketing)` group — shared header/footer)
| Route | Purpose | Data source | Indexable |
| --- | --- | --- | --- |
| `/` | Home — machine-commerce positioning, two lines, catalog strip, live strip | live `/v1/intelligence` (ISR 300s) + `/health` | ✅ |
| `/intelligence` | Trading Intelligence product | live catalog (ISR) + fallback | ✅ |
| `/intelligence/[metric]` | One page per metric (×4) | catalog + `data/intelligence-samples.json` | ✅ (SSG via generateStaticParams) |
| `/corporate` | Corporate Services + enquiry form | static | ✅ |
| `/pricing` | Unified pricing + rate card | live catalog (ISR) | ✅ |
| `/machine` | For Agents — x402 / 402 flow (SSR) | static | ✅ |
| `/network` | Infrastructure underneath — nodes, split, settlement | static | ✅ |
| `/rpc` | RPC gateway (secondary product) | static | ✅ |
| `/node`, `/node/*` | Node operator flows (kept, app logic) | live API | ✅ (`/node`, `/node/setup`) |
| `/status` | Status (restyle only; apex 308 → status.satelink.network) | `/health` | ✅ |
| `/contact` | Contact + legal entity + corporate routing | static | ✅ |
| `/terms` `/privacy` `/refund` | Legal (content unchanged) | static | ✅ |
| `/docs`, `/docs/[slug]` | In-app docs portal | `@/lib/docs` | ✅ |

## Checkout (`(checkout)` group — minimal chrome, all noindex)
| Route | Purpose | Indexable |
| --- | --- | --- |
| `/checkout` | Pre-checkout (plan summary, disclosures, consent → Dodo) | ❌ noindex + robots-disallow |
| `/checkout/success` | Pass-through → `/intelligence/success` (claim preserved) | ❌ |
| `/checkout/cancel` | Cancelled payment | ❌ |
| `/intelligence/success` | Canonical post-payment (#398) | ❌ (`robots: noindex` in-page) |

## Excluded / internal (robots-disallowed)
`/admin/*`, `/ops/*`, `/api/*`, `/satelink/os/*`, `/login`, `/tasks`, `/checkout*`, `/styleguide` (noindex component gallery), `/machine-console` (operator dashboard, served on machine.satelink.network), `/design`.

## Canonicals
The root layout no longer sets a blanket canonical (that made every page canonical to `/`). Each page sets its own `alternates.canonical`. Home → `https://satelink.network`.
