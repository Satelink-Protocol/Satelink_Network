# 01 — Structural Analysis

Maps the reference two-property pattern (§1) onto Satelink. **Structure only** —
no reference text, logos, imagery, or brand styling is copied; all copy is
original Satelink content.

## Two-property model (§1.1)

| Role | Reference | Satelink |
| --- | --- | --- |
| Product + platform | product site + app + console | `satelink.network` (+ existing `/satelink/os/*` console) |
| Docs | docs site | `docs.satelink.network` (in-app portal, 19 pages — see `DOCS_MIGRATION.md`) |
| Learning | academy | `satelink.network/academy` |
| Help center | support | `satelink.network/support` |
| Corporate | company site | `jakuraa.com` (new, `apps/corporate`) |

## Header pattern (§1.2 → §6)
Products ▾ · Platform ▾ · Solutions ▾ · Pricing · Resources ▾ · Learn ▾ · Docs ·
Log in · Contact sales · **Get started**. Mega-menus are grouped columns + a
feature card, **data-driven from the CMS Navigation global** (no nav hard-coded
in components). Full spec: `05-header-ia.md`.

## Footer pattern (§1.3 → §7)
Columns: Products · Platform · Solutions · Industries · Developers · Resources +
Help & security · Company (→ jakuraa.com) · Terms & policies. Data-driven from
the CMS Footer global. Full spec: `06-footer-ia.md`.

## Corporate pattern (§1.4 → §10)
Minimal header (Company · Research · Products · News · Careers · Security + CTA
"Visit Satelink"); large footer with Company group (Careers, Leadership, Policy,
Research, News, Security & compliance). Full spec: `09-corporate-site.md`.

## Page skeletons (§1.5) — verified heading orders reused as templates
- **Product overview** → `ProductTemplate` (`07-templates-and-blocks.md`)
- **Platform/API** → `PlatformTemplate`
- **Solutions (enterprise/commerce)** → `SolutionTemplate` (FAQ grouped incl.
  "Trust and safety": *"What stops an agent from paying a price that isn't real?"*)
- **Pricing** → audience switch + compare table + grouped FAQ
- **Support home** → search + collections + sub-collections + articles
- **Academy** → hub grouped by product, card grids
- **Blog** → category tabs + featured + latest grid
- **Leadership / Careers** (corporate) → grouped people / hiring sections

## Signature interactive section — the Lifecycle stepper (§3)
`DISCOVER → IDENTIFY → REQUEST → PRICE → PAY → EXECUTE → METER → SETTLE → RECEIPT`,
each step: plain-English line + real Satelink mechanism + code/JSON reveal.
Keyboard-accessible; **SSR the full content** (no client-only shell). Used on
home, `/product/overview`, `/products/machine-commerce`, `/solutions/commerce`.

## Non-negotiables carried into every template
Truth policy (§2): no invented customers/logos/testimonials/metrics/certs/people;
data-dependent sections are CMS-driven and **auto-hidden when empty**. Live
metrics only from live APIs with a styled "unavailable" state. Payments boundary:
Dodo only on Trading Intelligence surfaces; crypto rails labelled "not billed
through Dodo". See `19-validation-suite.md` for the enforcing checks.
