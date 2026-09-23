# Web Reposition — Decisions Log

Every judgment call made without asking, per the reposition mandate (§0). Newest at top of each section.

## Branch & baseline
- **Branch `feat/web-machine-commerce-reposition` cut from `fix/web-public-pages-theme-dodo-compliance` (PR #400, commit `4fcb554`), NOT from `main`.** Per §10: "if #400 hasn't merged, branch from #400's branch and note it." #400 is 1 commit ahead of `main` and carries the `(marketing)` route group + shared `SiteHeader`/`SiteFooter` + Dodo compliance copy this project builds on. PR #398 (claim-token) is already on `main`.
- **Web test runner is `vitest`, not mocha.** `apps/web/package.json` `test` → `vitest`. (`mocha` is a stray dep, unused by web.) Playwright `^1.61.1` lives in the **root** `package.json` — reuse it there; do not add a second copy.

## Truth / data
- **`support@satelink.network` vs `satelinknetwork@gmail.com` mismatch.** The live `/contact` page shows `support@satelink.network`; the footer + audited legal facts show `satelinknetwork@gmail.com`. Audited ground truth (§1) is `satelinknetwork@gmail.com`. **Decision:** standardize public contact on `satelinknetwork@gmail.com` (the documented, founder-provided legal contact) and route the corporate enquiry form to it. Flag for founder to confirm which inbox is monitored.
- **No email provider is configured in the repo** (no Resend/nodemailer/SMTP/SendGrid in `apps/web`). **Decision (per §6 fallback):** the corporate-enquiry route handler validates with zod + honeypot + in-memory rate limit, then persists/forwards via the existing apps/api path if one exists; if none, it logs server-side and returns success, with a `TODO(email-provider)` and a follow-up item here. The destination address is never exposed beyond what is already public in the footer.
- **`/status` currently 308-redirects to `https://status.satelink.network/`** (see `next.config.ts` `redirects()`, gated on `missing host = status.satelink.network`). So on `satelink.network`, `/status` does not render the local React page. **Decision:** keep the redirect (external status page is the source of truth) and restyle the local `/status` page only as the fallback served on the `status.` host. Do not present a second, divergent status UI on the apex domain.

## Design system
- (Signal 1 tokens established in the reposition; Signal 2.0 in web-v3-experience P1 below.)

---

# web-v3-experience (stacked on IA-v2) — Decisions Log

Branch `feat/web-v3-experience` cut from `feat/web-ia-v2-claude-pattern` (§0). Baseline
gate confirmed green before any change: build 0 · unit 57/57 · packages 9/9 · arch 9/9 ·
E2E 99/99.

## P1 — Theme: Signal 2.0
- **Light-first marketing, dark console.** `tokens.css` now declares the light palette on
  `:root, [data-theme="light"]` (the default) and the dark palette on `[data-theme="dark"]`;
  an `@media (prefers-color-scheme: dark)` block covers OS-dark users who haven't chosen a
  theme. The SSR `<html data-theme>` flipped `dark → light` (marketing is light-first). The
  pre-paint `THEME_INIT` script still respects a stored choice, then OS preference — so
  OS-dark users still get dark (both themes are complete); the light default only governs the
  no-JS / first-paint case. The console (P6) will force dark in its own layout.
- **AA contrast overrode two spec-provided hexes (documented, math below).** The brief gave
  `--sl-accent:#0E9F8B` / `--sl-accent-strong:#0A7C6D` and `--sl-text-subtle` = `#76819A`
  (light) / `#6B7890` (dark), and also mandated "WCAG AA contrast checked by test". Those
  conflict: white-on-`#0E9F8B` is only **3.31:1** (primary buttons use 13–15px semibold text,
  which is *normal* text needing 4.5), and both subtle greys fall to ~3.9:1 on their surface
  (used on 11px labels). Honouring the AA mandate:
  - light `--sl-accent` `#0E9F8B → #0A7C6D` (white 5.10:1, accent-as-text 4.76:1 on bg / 5.10 on surface); `--sl-accent-strong → #085F53`; `--sl-accent-soft`/`--sl-ring` re-based.
  - light `--sl-text-subtle` `#76819A → #667085` (4.97 on surface, 4.65 on bg).
  - dark `--sl-text-subtle` `#6B7890 → #7C89A1` (4.93 on surface, 5.58 on bg).
  Gate: `apps/web/test/token-contrast.test.ts` parses the real palette and asserts AA on every
  text / primary-action pair in both themes (20 assertions).
- **Product rails are graphical accents, not body text.** `--sl-machine` (indigo), `--sl-market`
  (amber), `--sl-settle` (sky) carry meaning on icons/borders/charts. Amber and sky cannot meet
  4.5:1 as text on white by nature, so they are used only as graphical objects always paired with
  a `text-muted` label (e.g. LifecycleRing node numbers were switched to `--sl-text` on the
  coloured ring). They are therefore not asserted as body text in the contrast gate.
- **New visuals live outside the hex-gate scope but are token-only anyway.** Illustration kit
  (`packages/web-ui/src/illustrations/`), infographics + hero demo (`.../infographics/`), and
  motion primitives (`.../motion/`) are new sibling dirs to `components/`, so the hex gate (which
  scans `components/{ui,site}` + `(marketing)`/`(checkout)`) does not cover them — but every SVG
  references `var(--sl-*)`/`currentColor` and contains no hardcoded hex, so they remain fully
  themeable in both modes.
- **Motion = Framer Motion via LazyMotion + domAnimation only.** Every primitive
  (ScrollReveal, Stagger/StaggerItem, CountUp, HoverLift) checks `useReducedMotion()` and renders
  the final static state under reduced motion. CountUp only animates real/live values and renders
  the final value on SSR + reduced motion (no flash of zero). MachinePaysDemo pauses offscreen via
  IntersectionObserver and shows the complete final frame under reduced motion.
- **Typography:** Manrope added via `next/font` as the display face (`--sl-font-display`, H1–H2),
  Inter body, JetBrains Mono numbers/code; display scale `--sl-display-1/2` (clamp).
- **Lighthouse deferred to the Vercel preview** (per the repo's standing convention in
  VERIFICATION.md — Lighthouse-CI/axe run against the preview URL at §8/delivery). AA contrast is
  now enforced locally by the unit test above regardless.

## P2 — Landing page (claude.com pattern)
- **Home is now short and plan-led.** The old long platform stack (lifecycle stepper, 5-product
  grid, developer/agent/enterprise audiences, on-chain proof) moved into `/product/overview`; the
  home is hero (+ MachinePaysDemo) → live proof strip → three product tiles → Explore plans →
  FAQ → CTA. Body copy is ~314 words (gate: ≤450). The H1 keeps the phrase "software that pays
  software" (existing E2E asserts it) as "Commerce for software that pays software."
- **`/product/overview#lifecycle`** is the target of the home "See how machines pay" CTA; the
  moved LifecycleStepper sits in a `scroll-mt-24` section with `id="lifecycle"`.
- **Plan catalogue is config-driven in `apps/web/src/lib/plans.ts`** (Free/Pro/Max + PAYG packs +
  the Agents & API rate card) — the single source the home Explore-plans section and the P3 pricing
  page share via `apps/web/src/components/ExplorePlans.tsx`. P3.B will add `GET /v1/plans` and a
  pricing-parity test; this file becomes the web mirror. Chose an app-level lib over
  `packages/content` for P2 to avoid a premature package API; promotable in P3.
- **No dead buy buttons (§4.4).** `plansEnabled()` reads `NEXT_PUBLIC_PLANS_ENABLED` (unset today
  → false), so Pro/Max render "Available soon — notify me" linking to the `/contact-sales?topic=plans`
  enquiry form (captures interest), and only Free (→ /signup) + the Agents rate card are actionable.
- **FAQPage JSON-LD** added to the home via `faqLd()` + `jsonLdScript()` (the existing repo pattern),
  with the six brief-specified questions incl. "Is this investment advice? → No, analytics only."
- **Motion in production:** the product tiles use Stagger/StaggerItem and the plans block a
  ScrollReveal; the hero uses MachinePaysDemo. Above-the-fold hero copy is not motion-wrapped (LCP).

## P3 — Pricing (page + plan model, Track W UI)
- **`/pricing` rebuilt to the claude.com/pricing pattern:** hero → audience toggle
  (Individuals · Agents & API · Enterprise·later, `PricingAudienceTabs`) → [Individuals:
  ExplorePlans + PAYG packs + PlanCalculator] [Agents & API: rate card + x402, `id="agents"`]
  [Enterprise: "Coming later — contact sales"] → "How payments work" (the P1 TwoRailsDiagram) →
  Compare features (`CompareMatrix`, `#compare`) → balance/refunds (`#platform`, kept for the
  /platform/pricing redirect) → grouped FAQ (+ FAQPage JSON-LD).
- **All figures are config-driven** in `lib/plans.ts` (`PLANS`, `CREDIT_PACKS`, `AGENT_RATE_CARD`,
  `COMPARE_GROUPS`, `FIXED_MONTHLY_INFRA_USD`); no numbers in JSX. Economics recorded in
  `docs/web/PRICING_MODEL.md` (Dodo fee schedule, $80 fixed-infra constant, RPC upstream-cost
  gating, per-plan margin check).
- **No dead buy buttons.** With `PLANS_ENABLED` off, Pro/Max cards and the bonus packs render
  "notify me" / "Available soon" → `/contact-sales`; only Free, the live $9.99 Starter Pack, and
  the Agents rate card are actionable. The `#agents` hash activates the Agents tab on load.
- **PlanCalculator** maps calls/month → cheapest of Free / pay-as-you-go / Pro / Max from the
  config (PAYG at the $0.01 list rate; note that bonus packs lower the effective rate).
- **Plan-parity test** (`apps/web/test/plan-parity.test.ts`) locks the config to the live catalog
  (rate-card RPC = FLAT_RATE, TI = catalog price; overage < list; Max < Pro; non-live packs ≥ $10;
  compare rows have one value per plan). Full page↔backend parity (`GET /v1/plans`) is deferred to
  **Track B (P3.B)** on `feat/api-auth-and-plans`.
- **P3.B backend is NOT in this PR** — plans table/seed, `GET /v1/plans`, Dodo subscription
  products + webhooks, entitlement buckets (Dodo bucket = Trading Intelligence only), monthly
  reset, and bonus-pack mapping are additive backend work behind `PLANS_ENABLED`, delivered on the
  separate `feat/api-auth-and-plans` branch per §9.
- **Entitlement model — founder decision (2026-09-23): confirmed.** A Dodo subscription grants the
  monthly included-call **entitlement bucket** (Trading Intelligence only, resets monthly, consumed
  before credits) — **not** fungible USD credits. Track B's `entitlement_service.mjs` already
  implements this structurally (`SUB_PLAN_MAP`, `grantPlanAllowance`, `reconcileEntitlements` reads
  the existing `subscriptions` table additively). This does not change what the existing Dodo
  webhook (`internal_dodo.js`) does today — it still credits fungible USD on a subscription payment,
  unmodified — migrating that webhook to grant the entitlement bucket instead is real money-path
  surgery and stays a separate, later, founder-approved PR. `consumeEntitlement` remains
  deliberately unwired from the live billing path for the same reason. See
  `apps/api/src/plans/README.md`.

## P4 — Legal suite
- **All policies unified under one content-driven renderer.** `LegalView` now shows a plain-English
  summary box, a "Draft pending legal review" banner (these are CMS Review-state drafts), a version
  + last-updated date, numbered sections, and optional lists/tables + a version history. `LegalDoc`
  gained `version`, `summary`, `updated?`, `versionHistory?`, and section `list?`/`table?`.
- **terms/privacy/refund migrated** from bespoke pages into the shared `lib/legal.ts` content system
  (they were the only legal pages not already using it), so every policy has the same structure.
- **Ten policies, expanded** (all ≥600 words except Cookies and Sub-processors, enforced by
  `apps/web/test/legal-structure.test.ts`): Terms (restructured; node-operator terms moved to
  `/network/operator-terms`; payment-rail, credits-not-stored-value, MoR, governing law Coimbatore
  + arbitration), Privacy (Grievance Officer, data-category + retention tables, sub-processors,
  DPDP breach notification, expanded rights), Billing & Payment (NEW), Refund (subscription
  cancellation + irreversible crypto rail), Acceptable Use (manipulation/resale/scraping/sanctions/
  agent-operator responsibility/enforcement ladder), Data Processing (reframed as a B2B DPA),
  Cookies (storage table + cookieless analytics), Security (true practices only; explicit
  no-certifications), Sub-processors (NEW table), Responsible Disclosure (safe-harbour + scope).
- **Written to the frameworks** named in §5 (DPDP Act 2023 + 2025 Rules, IT Act/SPDI, GDPR/UK GDPR,
  CCPA/CPRA, Consumer Protection (E-Commerce) Rules 2020) but **claims nothing untrue** — no
  certifications Satelink lacks; the Grievance Officer is noted as "to be designated" pending
  counsel, and every page carries the draft banner. **Founder + Indian counsel must approve before
  publish.** Legal content lives in `.ts` (not scanned by truth-lint); pages are token-only.
- **Footer + sitemap** updated: added Billing & payment and Sub-processors to the policies column;
  sitemap de-duplicated (terms/privacy/refund are now in `LEGAL_ORDER`) and lists operator-terms.
- **Node Operator Terms** page created at `/network/operator-terms` with the moved obligations
  (rewards follow the 50/30/20 split; earnings are not guaranteed).

## P5 — Auth (web UI; backend is Track B)
- **Apple is out for now — founder decision (A6, 2026-09-23).** Removed from `AuthPanel.tsx` (the
  button, its SVG mark, the `onProvider` union type), `console/settings`, legal copy (Terms
  eligibility, Privacy auth-provider-profile row, Privacy/Sub-processors sub-processor tables),
  `INFRA_SETUP.md` (whole Apple provisioning section + its env vars), and E2E (`auth.spec.ts` now
  asserts zero Apple buttons). Not flag-gated — the removal was small and contained enough not to
  warrant `AUTH_APPLE_ENABLED=false` scaffolding. Supported sign-in: **Google + email** (password
  with verification, magic link). Track B's `better_auth.mjs` mirrors this removal.
- **Shared `AuthPanel`** powers /login and /signup: a Google provider button, a divider, an
  email form, a magic-link toggle, and a DPDP-style consent notice (signup) with itemized purposes
  and Terms/Privacy links. States: loading, error, verify-email-sent, magic-link-sent,
  account-exists, rate-limited, and "rolling out".
- **/login is non-breaking.** It was the "Satelink admin access" page and is the redirect target of
  the (admin)/(builder)/(distributor) console layouts. The redesign **keeps** the working
  email/password → `/auth/login` flow (role decode + token storage), so those consoles are
  unaffected; it only restyles it, removes the "admin access" copy, adds the provider button, and
  points operators to `/ops/login` (the existing ops-token login — staff login already lives there).
  Default post-login redirect is `/console` (P6), overridable with `?next=`.
- **No dead controls.** `authEnabled()` reads `NEXT_PUBLIC_AUTH_ENABLED` (unset today → false).
  With it off, Google/magic-link and new-account signup show a "rolling out — notify me / use
  keyless x402" state instead of failing; the /login email/password sign-in keeps working because it
  uses the existing endpoint. When Track B ships Better Auth and the flag flips, the same UI calls
  `/api/identity/sign-in/social` and the email verify/magic-link endpoints.
- **Better Auth namespace — founder decision (2026-09-23): `/api/identity/*`, never `/api/auth`.**
  `app_factory.mjs` already mounts `createUnifiedAuthRouter()` (the node/operator auth router) at
  `/api/auth`; giving Better Auth its own namespace removes any risk of the new customer-auth
  surface shadowing, or being shadowed by, that existing router, now or as either evolves. Every
  reference across the web (`AuthPanel.tsx`) and the API (`better_auth.mjs`'s default `basePath` +
  `baseURL`, `BETTER_AUTH.md`) uses `/api/identity`; `INFRA_SETUP.md`'s OAuth redirect URI is
  `/api/identity/callback/google`, not `/api/auth/callback/...`.
- **P5 backend is Track B** (feat/api-auth-and-plans): Better Auth in apps/api (email+password with
  verification, magic link, Google, sessions + 2FA), account linking by verified email, and the
  founder setup (Google Cloud OAuth, Resend DNS) — see INFRA_SETUP.md.

## P6 — Unified console (UI shell)
- **New customer console at `/console`** (dark by default per §7.2 — the layout sets
  `data-theme="dark"` on a wrapper so the tokens re-scope). IA: Home, Products (Trading
  Intelligence / x402 / RPC), Agents & keys, Usage, Billing, Docs & SDKs, Settings — via
  `ConsoleShell` (left nav with product colours + responsive mobile drawer + top bar).
- **Truth rule enforced (§7.3):** every widget without a live endpoint renders a designed empty
  state (`ConsoleEmpty` / `KpiTile` "No activity yet") — never "—". truth-lint and the hex gate now
  scan `/console` too; console E2E asserts no bare em-dash anywhere.
- **No dead controls:** key creation, CSV export, notifications carry a Planned badge or a
  "rolling out" state; Delete account shows the DPDP 48-hour notice and records intent; Download my
  data records the request. Real data + session-gating are Track B.
- **`/dashboard` → `/console`** (was → mission-control); nav E2E updated. The larger OS→`/ops`
  physical relocation (§7.1) is **deferred**: the operator dashboard lives at `/satelink/os/*` and
  moving it wholesale is an operator-side migration out of the Track W console-UI scope. `/ops`
  already enforces a staff gate (redirects to `/ops/login` without an ops session) — console E2E
  asserts it is unreachable without staff.
- **a11y:** added `@axe-core/playwright`; console E2E runs axe on every console page and asserts no
  critical/serious violations (dark tokens meet AA via the P1 contrast test). Broader Lighthouse/axe
  budgets across all routes stay deferred to the Vercel preview per the repo convention.
- **Note:** the `/ops` staff guard redirect-loops on the localhost apex (the ops-pathname header is
  only set for the ops subdomain); this is a test-env artifact — in production `/ops` is served on
  the ops subdomain where the header is present and it redirects cleanly to `/ops/login`.

## Follow-ups (web needs a new API — logged, not built)
- `TODO(email-provider)`: corporate enquiry delivery has no transactional email backend. Needs Resend or apps/api contact endpoint.
- `TODO(catalog-endpoint)`: `GET https://rpc.satelink.network/v1/intelligence` is the live catalog source; if unreachable at build/ISR time, pages fall back to `data/catalog.fallback.json`.

## Checkout (Phase 7)
- **No analytics events added.** §8 says add `checkout_start`/`checkout_redirect`/etc "if an analytics lib already exists". None does in `apps/web` (no Segment/Plausible/GA). Per the same rule, nothing new added. `TODO(analytics)` if a lib is later adopted.
- **Checkout-scoped CSP only.** A site-wide strict CSP would risk breaking Next's inline bootstrap + the pre-paint theme script + framer-motion. Added a CSP on `/checkout/:path*` allowing the Dodo origins; site-wide strict CSP deferred (`TODO(csp)`).
- **`/checkout/success` forwards `?claim` to `/intelligence/success`** (the canonical #398 page) rather than duplicating the claim→key exchange, so #398 is not weakened.
- **`/checkout` reuses `/api/dodo-checkout` verbatim** (email + productId). No new Dodo product/session shape.

## Home / live data (Phase 4)
- **Homepage live strip uses `/health` only** (public: `{server, db, uptime}`). The spec's "calls today / p50" tiles have **no public endpoint** (`/metrics/json` 404s; `/admin/observability/metrics` is admin-auth). Rather than fabricate or show two permanently-"unavailable" tiles, the strip shows Gateway / Database / Uptime from the real `/health` payload, each with StatTile's loading + error states, and links to `/status` for full metrics. `TODO(public-metrics)` to expose a public calls/p50 endpoint if those tiles are wanted.
- **Home moved into the `(marketing)` route group** (`src/app/(marketing)/page.tsx`, old top-level `src/app/page.tsx` removed) so `/` uses the shared `SiteHeader`/`SiteFooter` chrome, matching the §4 IA.

## SEO / IA / network+rpc (Phase 4/8)
- **Root blanket canonical removed.** The root layout set `alternates.canonical` = `/`, which made every page canonical to `/` (the audited bug). Removed; each page sets its own canonical.
- **`/network` and `/rpc` created** as the "infrastructure underneath" (§3 demote) so the footer links resolve; node/RPC/settlement/50-30-20/vault content moved off the homepage. Node operator flows kept at `/node` (app logic lives there). The earnings estimator is present but every output is labelled an "illustrative estimate".
- **No competitor comparison table** on `/rpc` (Infura/Alchemy/QuickNode) — competitor cells can't be independently verified here, so per §3 it's omitted rather than shipped unverifiable.
- **Truth-lint bans the promissory "guaranteed returns/profit/…"**, not the bare word — "not guaranteed" / "no guarantee" are encouraged disclaimers. `alpha` is word-boundary banned; bare `returns` is not banned ("returns derived statistics" is the approved phrasing).
- **Contact**: standardized on `satelinknetwork@gmail.com`, added the legal entity name and the corporate-enquiry routing pointer.

---

# IA-v2 (Claude-pattern) — Decisions Log

Stacked branch `feat/web-ia-v2-claude-pattern` off the reposition branch (PR #401).
Founder-approved directives applied; see `IA_V2_DISCOVERY.md` for the repo map.

## Phase 2 — Monorepo prep
- **Design system package = `@satelink/web-ui` (`packages/web-ui`), NOT `packages/ui`.** `packages/ui` is `@satelink/ui`, the OS/admin dashboard system — left untouched. "Satelink Signal" (the marketing system) was physically extracted from `apps/web/src/components/{ui,site}` + `src/styles/tokens.css` into `packages/web-ui`, with a package-local `cn` and package-relative internal imports. Founder-approved. Updates the §4/§16 paths.
  - **Zero import churn in apps/web:** the 49 deep `@/components/ui/*` imports + `@/components/site/*` + the barrel resolve via new `tsconfig.json` `paths` redirects to the package; `transpilePackages: ["@satelink/ui","@satelink/web-ui"]`; Tailwind `@source` scans `packages/web-ui/src`; `layout.tsx` imports tokens by the same deep-relative mechanism already used for `@satelink/ui` theme.css.
  - **Gate held green** after extraction: `next build` EXIT=0, unit **43/43**, E2E **28/28**. `hex-gate.test.ts` was repointed at `packages/web-ui/src/components` so the extracted components stay in the hex gate's scope.
- **`packages/content` (`@satelink/content`)** created: zod schemas (the machine-readable product/pricing contract for `/products/*.json` + `/pricing.json`; shared CMS field primitives — SEO/GEO/publish-status), a CMS REST client with guaranteed fallback (`CMS_API_URL` unset today → returns fixtures), and canonical site constants (`LEGAL_ENTITY`, `SITES`, `CANONICAL_URL`, `DISCOVERY`).
- **`packages/seo` (`@satelink/seo`)** created: typed JSON-LD builders (schema-dts — Organization/WebSite+SearchAction/WebPage/Breadcrumb/Product/Article/FAQ/HowTo), a Next `Metadata` builder, `llms.txt`/`llms-full.txt` generators, and CI validators (required/duplicate meta, orphan/broken-link graph, JSON-LD validity, sitemap drift).
- **Test wiring:** new root vitest project `packages` (`packages/{content,seo,web-ui}/**/*.{test,spec}.{ts,tsx}`) — **9/9** pass. Architecture guard (`tools`) still **9/9**. `npm run arch` (dependency-cruiser) cruises only `libs tools workers`, so the new packages/apps are not linted there and sit at top-of-stack — compliant by default; no allowlist to update.
- **Package manager:** npm everywhere (approved). All spec `pnpm …` references → npm scripts.
- **Analytics:** Vercel Web Analytics (approved) — greenfield, wired when the app shells land (Phase 5).
- **Email / leads:** log-only is insufficient — every contact-sales / corporate-enquiry / support-feedback submission will be persisted to a CMS `Enquiries` collection (Postgres) visible in admin, AND logged; email delivery is a later add-on behind an env flag (approved). Wired in Phase 4 (CMS) + Phase 5 (form handlers).

## Infra provisioning stance (see INFRA_SETUP.md)
- **CMS DB + Vercel projects + DNS are documented, not executed, during the build.** Rationale: creating a database via DDL on the *production* Railway Postgres instance, and creating Vercel projects, are production-infra mutations off Phase 2's critical path (its gate is only tests+build green) and belong at the §18 delivery step. CLAUDE.md's prod-DB guardrails + the founder's documentation escape-hatch make "document now, execute at delivery on go" the safe path. The CMS is built against ephemeral/local Postgres so nothing blocks. Exact SQL, env vars, Vercel settings, and DNS records are in `docs/web/INFRA_SETUP.md`.

## Phase 4 — CMS (Payload 3) — isolation + gate stance
- **`apps/cms` is isolated from the npm workspace.** Root `package.json` pins
  `overrides: { react: 18.2.0, react-dom: 18.2.0 }` for apps/web; Payload 3 needs
  **React 19**. A shared install would force one React major on both and break the
  green apps/web build. Resolution: exclude `apps/cms` from the workspace globs so
  it carries its own `node_modules` + lockfile (React 19), fully isolated. It does
  not need `@satelink/web-ui` (Payload ships its own admin UI); it aligns with
  `@satelink/content` schemas by convention, not runtime import.
- **DB:** a local Postgres is running (`/tmp:5432`). CMS dev DB = `satelink_cms_dev`
  there; prod = `satelink_cms` on Railway (INFRA_SETUP.md). Never the app DB.
- **Runtime gate stance:** the CMS is delivered as complete, reviewable Payload 3
  code (config, collections, globals, RBAC, 2FA, audit log, truth hooks, workflow,
  revalidation, seed). The **live CRUD/publish/rollback boot test is run from the
  isolated `apps/cms` install** (`cd apps/cms && npm install && npm run dev`) —
  NOT forced into the React-18-pinned shared tree from this background session,
  which would risk apps/web. Boot/test steps in `apps/cms/README.md`. This is the
  one place Phase's runtime gate is deferred to the isolated setup by design.
