# 12 — CMS (Payload 3) — Schema, Roles, Workflow

`apps/cms` — Payload 3 on Next.js, Postgres adapter (`satelink_cms`), Vercel Blob
media, drafts/versions/scheduled publish, RBAC, audit log. Private
(admin.satelink.network, deployment protection, noindex). §13.

## Collections
Page · Product · Solution · Article · CustomerStory · NewsArticle · ChangelogEntry ·
Course · Lesson · Tutorial · UseCase · SupportCategory · SupportArticle · FAQ ·
Author · Category · Tag · Person (leadership) · JobOpening · Redirect · MediaAsset ·
Announcement · Feedback · PricingDisplay · **Enquiries** (contact-sales / corporate /
support-feedback leads — founder decision #4) · Users · AuditLog.

## Globals
Navigation · Footer · SiteSettings (per site: satelink | jakuraa) · SEODefaults ·
RobotsConfig.

## Common fields
`title` · `slug` (unique per site+type) · `site` · `description` · `hero` · `blocks`
body (`07-templates-and-blocks.md` inventory) · `author` · `category` · `tags` ·
`status` · `publishedAt` · `updatedAt` · `seo {title,description,ogTitle,
ogDescription,ogImage,canonical,schemaType,noindex}` · `geo {entityDefinition,
keyFacts[],sources[]}` · `relatedProducts` · `relatedSolutions` · `relatedResources`.
(SEO/GEO/status shapes = `@satelink/content` schemas.)

## Relationships
Product↔Solution · Product↔Article · Product↔Tutorial · Product↔UseCase ·
Solution↔Article · Course↔Tutorial/Lesson · SupportArticle↔Product · FAQ↔Page/Product/Solution.

## Workflow
Draft → Review → Scheduled → Published → Archived. Payload versions + drafts +
autosave; scheduled publish via Vercel Cron → Payload job queue; preview mode on
both public sites; unpublish; revision history; one-click rollback. On
publish/unpublish → webhook (`CMS_REVALIDATE_SECRET`) → `revalidateTag` on the
right site → regenerate sitemap + llms files.

## Truth hooks (beforeChange, **block publish**)
- Banned-phrase lint (shared list with `truth-lint`).
- Dodo mentions only on docs tagged `trading-intelligence`.
- `PricingDisplay` parity with live catalog.
- Testimonial / CustomerStory / Person docs require `verifiedBy` + `verifiedAt`
  set by a Super Admin.

## Roles (Payload access control)
Super Admin · Content Admin · SEO/GEO Admin · Product Admin (products, pricing
display) · Support Admin · Technical Admin (redirects, robots, settings) · Editor
(edit/review; no publish of Product/Pricing) · Author (own drafts only). Every
create/update/delete/publish → `AuditLog` (user, action, collection, doc id, diff,
timestamp, IP). Auth: email+password + **mandatory TOTP 2FA**, 12h session, login
rate limit.

## Admin nav
Dashboard · Content (Pages, Products, Solutions) · Resources (Blog, Customer
Stories, News, Changelog) · Academy · Support · FAQs · Navigation · Footer · Media ·
Authors · Categories · Tags · SEO · GEO · Redirects · Announcements · Pricing
display · Enquiries · Analytics (read-only embed) · Settings · Users · Roles · Audit log.

## Public read path
Public sites read via REST with ISR (`@satelink/content` client, `CMS_API_URL`) +
on-publish `revalidateTag`. Each app ships `content/fallback/*.json` so builds
never fail if the CMS is down.
