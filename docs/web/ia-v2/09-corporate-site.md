# 09 — jakuraa.com Corporate Site (`apps/corporate`)

Company site, editorial, shares `@satelink/web-ui` tokens with a light-first theme
and a distinct wordmark. §10.

## Header
Company · Research · Products · News · Careers · Security + CTA **Visit Satelink**.

## Routes
| Route | Content |
| --- | --- |
| `/` | Mission-led editorial homepage |
| `/company` | About Jakuraa Commercial Pvt Ltd, what we build, principles |
| `/company/mission` | Mission |
| `/company/leadership` | Grouped: Founder · Leadership · Advisors — **only verified `Person` docs; empty groups hidden; photo optional**. Founder: "Jakuraa, Founder" unless CMS has more. |
| `/company/research` | Research/engineering writing — **hidden until ≥1 post** |
| `/company/news` | Corporate news (shared CMS `NewsArticle`, site=jakuraa) |
| `/company/security` | Security & compliance posture — **only true statements**; responsible disclosure |
| `/products` | Links to Satelink products |
| `/careers` | Intro → principles → how we support you → how we hire → AI-in-application policy → FAQ → open roles (CMS `JobOpening`; none → "No open roles right now — send a note to …" empty state) |
| `/careers/[slug]` | Role detail |
| `/contact` | Corporate contact, registered address, press email |
| `/press` | Media kit (logo downloads from `@satelink/web-ui` brand assets) |
| `/legal/*` | Canonical legal pages; satelink.network legal links point here or mirror |

## Shared / cross-link
Shared footer with Satelink product links + company + legal. **Organization
JSON-LD** with `legalName`, `address`, `founder`, `brand: Satelink`, `sameAs`
(from `@satelink/seo` `organizationLd`). satelink.network footer "Company" →
jakuraa.com; jakuraa.com "Products" → satelink.network.

## Truth
Leadership = verified people only (`verifiedBy`+`verifiedAt` set by Super Admin).
Careers empty-state ready. No fabricated bios, no invented advisors/investors.

## Infra
Separate Vercel project `jakuraa-corporate` → jakuraa.com (DNS in `INFRA_SETUP.md`).
Reads the same CMS via `CMS_API_URL`.
