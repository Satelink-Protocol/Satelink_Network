# 07 — Page Templates & Blocks

Built as Payload blocks so admins compose pages. Every template renders blocks in
the listed order; **blocks with no content are skipped** (§2 auto-hide). §8.

## Templates (block order)

### ProductTemplate
Breadcrumb · Hero (eyebrow, H1, ≤50-word answer-first definition, CTAs) ·
Definition ("What is X?" GEO entity block) · Core value (3 cards) · Product visual
(code/JSON/diagram) · How it works (steps) · Capabilities grid · Use cases ·
Technical architecture (diagram) · Integration paths ("Choose how you build") ·
Pricing (live) · Security · Machine-readable panel (`11-machine-geo-layer.md`) ·
Documentation links · FAQ (grouped) · Related products · Related resources · Final CTA.

### SolutionTemplate
Hero · Problem · Why now · How Satelink works · Workflow · Two-sided section
(buyers/sellers) · Capabilities · Architecture · Security · Pricing · Implementation
("Choose how you build") · Use cases · Proof (**auto-hidden**) · FAQ (grouped:
About the offering · Trust and safety · Getting started) · Related products · CTA.

### PlatformTemplate
Hero · feature carousel (from changelog) · capability sections · "Control cost"
section · Console (Build · Deploy · Monitor · Manage) mapped to real console
screens · Technical resources · CTA.

### ArticleTemplate (blog/news/customer story/changelog)
Breadcrumb · category · title · subtitle · author · published/updated dates · hero
image · body · related products · related articles · CTA · FAQ (optional) · JSON-LD.

### AcademyTemplate
Hub (grouped by product) · Course (lessons list, progress in localStorage) ·
Tutorial (prereqs, steps, runnable code, "what you built", next tutorial) ·
Use case (scenario, flow diagram, products used, tutorial links).

### SupportTemplate
Home (search hero + collection grid + popular + recently updated) · Category
(sub-collections + article list) · Article (body, related, "Was this helpful?" →
CMS `Feedback`, contact support, docs/status links).

### CompanyTemplate (jakuraa.com)
Editorial long-form · people grid · principles list · FAQ.

## Block inventory (Payload blocks)
`richText` · `markdown` · `code` (lang tabs; Illustrative badge) · `image` ·
`video` · `table` · `callout` · `tabs` · `cards` · `cta` · `faq` · `productEmbed` ·
`apiExample` (curl/TS/Python) · `relatedContent` · `heroBlock` · `valueCards` ·
`capabilityGrid` · `lifecycleStepper` · `integrationPaths` · `comparisonTable` ·
`pricingLive` · `machineReadablePanel` · `stepper` (how-it-works) ·
`interactiveSelector` (role/task → product) · `people` · `principles` · `stat` (live only).

Each block: a Payload block config (fields) + an RSC renderer in
`@satelink/web-ui` (or app-local for one-offs). `/styleguide` renders every block
(Phase 6 gate).

## Rules baked into blocks
- `stat` renders only from a live API; failure → styled "unavailable", never "—".
- `pricingLive` reads the live catalog via `@satelink/content`; parity-checked in CI.
- `code`/`apiExample` runs against a real endpoint (CI free-tier call) or shows an
  **Illustrative** badge.
- `productEmbed`/`relatedContent` come from CMS relationships (`10-internal-link-graph.md`).
