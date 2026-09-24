# 16 — Content Model Reference (field-level)

Companion to `12-cms-schema-roles-workflow.md`: the field lists per collection.
Shared common fields (title, slug, site, description, hero, blocks, status,
publishedAt, updatedAt, seo, geo, relatedProducts/Solutions/Resources) are on
every content collection and not repeated below.

| Collection | Distinct fields |
| --- | --- |
| Page | `template` (generic/landing), `sections[]` |
| Product | `canonicalConcept`, `definition` (≤50w), `capabilities[]`, `integrationPaths[]`, `pricingSource` (live catalog slug), `machineJson` (derived), `paymentRails[]`, `isDodoSurface` (bool) |
| Solution | `audienceType` (company/use-case/industry), `problem`, `whyNow`, `twoSided`, `proof` (rel, auto-hide) |
| Article | `subtitle`, `author` (rel), `category` (rel), `heroImage`, `articleType` (Article/News/Tech) |
| CustomerStory | `logo`, `quote`, `verifiedBy`, `verifiedAt` (**required to publish**) |
| NewsArticle | `source` (satelink/jakuraa), `externalUrl?` |
| ChangelogEntry | `version`, `date`, `area`, `body` |
| Course | `lessons[]` (rel), `level` |
| Lesson | `course` (rel), `order`, `body` |
| Tutorial | `product` (rel), `prereqs[]`, `steps[]`, `runnableCode`, `endpointVerified` (bool → gates publish), `nextTutorial` (rel) |
| UseCase | `scenario`, `flowDiagram`, `productsUsed[]`, `tutorials[]` |
| SupportCategory | `parent?` (self-rel), `order`, `icon` |
| SupportArticle | `category` (rel), `product?` (rel), `helpfulVotes` (int) |
| FAQ | `question`, `answer`, `group`, `attachedTo` (Page/Product/Solution rel) |
| Author | `name`, `title`, `avatar`, `bio` |
| Category / Tag | `name`, `slug`, `description?` |
| Person | `name`, `role`, `group` (Founder/Leadership/Advisor), `photo?`, `bio`, `verifiedBy`, `verifiedAt` (**required to publish**) |
| JobOpening | `title`, `team`, `location`, `type`, `body`, `applyUrl` |
| Redirect | `from`, `to`, `permanent` (bool) |
| MediaAsset | Vercel Blob url, alt, width, height |
| Announcement | `text`, `href?`, `startsAt`, `endsAt` |
| Feedback | `article` (rel), `helpful` (bool), `comment?`, `ts` |
| PricingDisplay | `productSlug`, `metric`, `unit`, `price`, `currency` (**parity-checked**) |
| Enquiries | `kind` (contact-sales/corporate/support-feedback), `name`, `email`, `company?`, `useCase?`, `volume?`, `message`, `ip`, `ts`, `emailConsent` (bool) |
| AuditLog | `user`, `action`, `collection`, `docId`, `diff`, `ts`, `ip` |

## Globals fields
- **Navigation** — see `05-header-ia.md` data shape.
- **Footer** — see `06-footer-ia.md` data shape.
- **SiteSettings** — `site`, `wordmark`, `defaultOgImage`, `social[]`, `legalEntity`
  (defaults from `@satelink/content` `LEGAL_ENTITY`).
- **SEODefaults** — default title template, description, og image, twitter handle.
- **RobotsConfig** — allow/disallow rules, sitemap URL.
