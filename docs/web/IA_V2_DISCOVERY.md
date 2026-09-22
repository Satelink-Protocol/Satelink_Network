# IA-v2 — PHASE 1 Discovery

Repo map for the website IA-v2 build (§17 Phase 1). Every claim is backed by a
path. Branch: `feat/web-ia-v2-claude-pattern` (stacked on
`feat/web-machine-commerce-reposition`, PR #401).

Verified: 2026-09-22.

---

## TL;DR — what the IA-v2 spec assumed vs. what is true

| Spec §4 assumption | Reality | Impact |
| --- | --- | --- |
| pnpm workspaces | **npm** workspaces (`npm@11.6.2`) + turbo | Use npm; no pnpm scripts. `pnpm seo:check` etc. become npm scripts. |
| `packages/ui` is the reposition design system to extract into | `packages/ui` = **`@satelink/ui`**, a *separate* admin/OS dashboard system. The reposition "Satelink Signal" system lives **in `apps/web/src`**. | Do NOT overwrite `@satelink/ui`. Extract Signal into a *new* package (e.g. `packages/web-ui`) or keep it in apps/web and share via a new package. Record in DECISIONS.md. |
| `apps/corporate`, `apps/cms`, `packages/content`, `packages/seo` new | None exist yet | Create them; workspace globs already cover `apps/*` + `packages/*` — no manual registration. |
| Architecture enforcement will gate new apps | `npm run arch` cruises only `libs tools workers`, not `apps/`/`packages/` | New apps are compliant by default; only rule: never import upward into libs/services. |
| Analytics tooling exists in repo | **None in apps/web** | Must add (Vercel Web Analytics per §15) — greenfield. |
| Email provider exists | **None wired to the site**; corporate form only logs | Brevo exists in `apps/api` but is not reachable from the site. §10/§6: wire Resend or an apps/api endpoint. |
| `.well-known/satelink.json` proxy | No `.well-known` handler today | Build the proxy/redirect (§5, §12). |
| `llms-full.txt` | Only `llms.txt` exists (static, in `public/`) | Generate both in `packages/seo`; diff against existing before replacing. |

---

## 1. Monorepo layout

- **Package manager:** npm (`package.json` → `"packageManager": "npm@11.6.2"`; only `package-lock.json`, no pnpm/yarn lock).
- **Workspaces:** npm workspaces, globs `apps/*`, `services/*`, `packages/*`, `agents/*`, `libs/*`, `workers/*`. Build orchestration: **turbo** (`turbo.json` — build/test/lint/dev).
- **apps/** (3): `apps/web` (Next 15.5.24 App Router, React 18.2, name `web`), `apps/api` (`@satelink/api`, backend), `apps/mcp-server` (`satelink-mcp`).
- **packages/** (5): `packages/ui`→`@satelink/ui`, `packages/config`→`@satelink/config`, `packages/database`→`@satelink/database`, `packages/sdk`→`@satelink/sdk`, `packages/provider`→`@satelinklabs/provider`.
- Financial-OS domain lives under `libs/` + `services/` (separate from the website).
- Root also has a **legacy root-level Next app** (`server.js`, root `src/`, root `public/llms.txt`) distinct from `apps/web` — do not confuse the two.

## 2. apps/web routes (App Router, `apps/web/src/app`)

Route groups → public paths (each a `page.tsx`):

- **(marketing)** — public site, no prefix: `/`, `/contact`, `/corporate`, `/machine`, `/network`, `/pricing`, `/privacy`, `/refund`, `/rpc`, `/terms`, `/intelligence`, `/intelligence/[metric]` (dynamic), `/intelligence/success`.
- **(admin)**: `/admin` + `/admin/{abuse,ledger,nodes,revenue,revenue/events,rewards/epochs,security,security/audit,settings,users,diagnostics/incidents,diagnostics/self-tests}`.
- **(builder)**: `/builder`, `/builder/{docs,keys,projects}`.
- **(checkout)**: `/checkout`, `/checkout/cancel`, `/checkout/success`.
- **(distributor)**: `/distributor`, `/distributor/referrals`.
- **(node)**: `/node`, `/node/{claim,earnings,setup}`.
- **Non-grouped**: `/admin/command-center` (+`/reward-epochs`, `/self-tests`), `/design`, `/styleguide`, `/status`, `/tasks`, `/login`, `/machine-console`, `/docs`, `/docs/[slug]`, `/ops`, `/ops/command-center`, `/ops/login`, and the **(metering)** group `/satelink/os` + `/satelink/os/{deposit,keys,mission-control,monitoring,revenue-ops,settlement-lifecycle,usage}`.
- **API `route.ts`**: `/api/corporate-enquiry`, `/api/dodo-{balance,checkout,claim,webhook}`, `/api/grafana/[...path]`, `/api/ops-auth`, `/api/tasks/start`; plus `/feed.xml` (RSS).

**IA-v2 collision watch:** the spec's `/products/*`, `/platform/*`, `/solutions/*`, `/academy/*`, `/support/*`, `/developers/*`, `/blog/*` are all NEW. Existing `/admin`, `/ops`, `/satelink/os`, `/node`, `/builder`, `/distributor` are the console surfaces — IA-v2 says admin stays a separate app; but note `/admin/*` currently lives *inside* apps/web. The `/dashboard` → `/satelink/os/mission-control` 308 (spec §5) must be added.

## 3. Console auth

- **Subdomain routing** (`apps/web/src/middleware.ts`) is a host→path **rewrite map**, not an auth gate. `SUBDOMAIN_MAP`: developer→`/satelink/os`, machine→`/machine-console`, node→`/node`, admin→`/admin`, status→`/status`, ops→`/ops`, docs→`/docs`. Injects `x-ops-pathname` on ops paths.
- Matcher (verbatim): `matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)']` — **`api` excluded from middleware.**
- **Auth gate = server-side, cookie-based, in the layout** (not middleware):
  - `apps/web/src/app/ops/layout.tsx`: `authed = Boolean(jar.get('ops-session')?.value) || Boolean(jar.get('x-admin-token')?.value)`; unauthed → `redirect('/ops/login')`.
  - `apps/web/src/app/api/ops-auth/route.ts` (POST): compares `token` to `process.env.ADMIN_TOKEN`; sets **httpOnly** `ops-session=1` (secure/prod, sameSite lax, 24h). Token never stored in the cookie.
- `/login` (root) is a distinct page. Only the **ops** layout gate was confirmed; `/admin` + `/satelink/os` rely on their own layout/app logic (robots-disallowed, but no middleware gate found).
- **IA-v2 impact:** §5 `/login` + `/signup` "entry pages → existing console auth" should point at this existing flow; do not rebuild auth. Admin-stays-separate (§2 hard rule) is aspirational — admin currently ships inside apps/web.

## 4. Docs source (docs.satelink.network)

Docs **are in this repo**, served by apps/web (middleware maps docs subdomain → `/docs`). Two systems coexist:

- **(a) Live in-app portal:** `apps/web/src/app/docs/page.tsx` + `docs/[slug]/page.tsx`. Registry `apps/web/src/lib/docs.ts` (`DOCS`, 19 entries; categories Getting Started / Platform / Billing & Economics / Network Participants / Operations / Reference). Markdown in **`apps/web/src/content/docs/<slug>.md` — 19 files** (admin-guide, api-reference, architecture, authentication, billing, changelog, deployment, developer-guide, faq, glossary, machine-customers, node-operators, pricing, quick-start, revenue-model, roadmap, sdk, security, troubleshooting). This is the "~20 doc pages."
- **(b) Legacy Mintlify config (root):** `docs.json` (+ older `mint.json`) point at the **root `docs/` folder** (39 mixed .md files). The **"Mintlify Deployment" CI check is the external Mintlify GitHub App** deploying that root config — NOT a repo workflow (`.github/workflows/` has only architecture.yml, ci.yml, health-check.yml, release.yml).
- **IA-v2 impact (§5 docs restructure):** the canonical, editable docs are the in-app portal (a) — restructure nav there and write `docs/web/DOCS_MIGRATION.md` for the Mintlify decision (keep, retire, or reconcile with root `docs/`). Two competing docs sources is a truth/consistency risk to flag to the founder.

## 5. Analytics

- **None in `apps/web`** — zero matches for `@vercel/analytics`, `<Analytics`, `SpeedInsights`, plausible, posthog, gtag, segment in `apps/web/src`; not in `apps/web/package.json`.
- `@vercel/analytics ^2.0.1` is a dep of the **root/legacy** app only. PostHog appears solely as a `phc_placeholder` in Mintlify `docs.json`.
- **IA-v2 (§15):** greenfield — add Vercel Web Analytics (privacy-friendly, Vercel-native) with `data-cta` event attributes. Never surface analytics numbers publicly.

## 6. Email provider

- **None wired to the site.** `apps/web/src/app/api/corporate-enquiry/route.ts` validates (zod `EnquirySchema`), rate-limits (5/window/IP via `@/lib/rate-limit`), honeypots `website`, then **only `console.log`s and returns `{ ok: true }`**. Header comment: "TODO(email): wire Resend or an apps/api endpoint." Destination noted server-side: `satelinknetwork@gmail.com`.
- A provider exists in the **backend** (`apps/api/src/admin/email.js`, `outreach_engine.js` → **Brevo** `api.brevo.com/v3/smtp/email`) but is not reachable from the website form.
- **IA-v2 (§10 corporate + contact-sales):** reuse the corporate enquiry handler; to actually deliver, wire Resend in apps/web or an authenticated apps/api endpoint. Decision needed → DECISIONS.md.

## 7. llms.txt / sitemap / robots / .well-known

- **llms.txt:** static `apps/web/public/llms.txt` (product summary, key facts, ~19 docs links, optional links). **No `/llms-full.txt`.**
- **sitemap:** `apps/web/src/app/sitemap.ts` (`MetadataRoute`), BASE `https://satelink.network`; emits marketing routes + one `/intelligence/{slug}` per metric (`getFallbackCatalog()` from `@/lib/intelligence`) + one `/docs/{slug}` per `DOCS` entry; excludes `/tasks`, `/admin`, `/satelink/os`.
- **robots:** `apps/web/src/app/robots.ts` — `allow: "/"`; disallows `/admin/`, `/ops/`, `/api/`, `/satelink/os/`, `/login`, `/tasks`, `/checkout`, `/styleguide`, `/machine-console`, `/design`; sitemap → `https://satelink.network/sitemap.xml`.
- **.well-known:** none (no handler, no `public/.well-known`).
- **IA-v2 (§12):** move llms generation into `packages/seo` (generate `llms.txt` + `llms-full.txt` from live catalog + docs at build; diff before replacing the existing static file). Add `.well-known/satelink.json` proxy → `rpc.satelink.network` discovery. Extend sitemap for all new routes.

## 8. Architecture enforcement

- **CI:** `.github/workflows/architecture.yml` ("Architecture", M0 harness) on PRs to main/develop: `npm run arch` (dependency-cruiser), `typecheck:libs`, `typecheck:workers`, `test:libs`, `test:arch`; + non-blocking Financial-OS integration suite (testcontainers).
- **ADR:** `docs/adr/000-architecture-enforcement.md` (Accepted, M0) — layering by dependency-cruiser, all rules `severity: error`, rules themselves tested.
- **Guard tests:** `tools/architecture-tests/guard.test.ts`, `forbid-database-url.test.ts` (run via `npm run test:arch` = `vitest run --project tools`).
- **Rules:** `.dependency-cruiser.cjs` — path/dir-based: `libs/kernel` imports nothing; libs no-node-core/no-io; no aggregate-to-aggregate; no cross-context financial↔commerce; services application-not-to-infrastructure; `libs-not-to-services`; `services-not-to-deployables`; no-circular; no-orphans.
- **Key fact:** `"arch": "depcruise ... libs tools workers"` — **does NOT cruise `apps/` or `packages/`.** New `apps/cms`, `apps/corporate`, `packages/{web-ui,content,seo}` are auto-workspaces (globs already match), sit at top-of-stack (compliant by default), and there is no name allowlist to update. Only failure mode: importing upward into libs/services.

## 9. Design system — TWO distinct systems

- **(A) "Satelink Signal" — PUBLIC website system, in `apps/web/src`:** tokens `apps/web/src/styles/tokens.css` (`--sl-*`), globals `apps/web/src/app/globals.css`, components `apps/web/src/components/ui/` (Badge, Button, Card, CodeBlock, ComparisonTable, Disclosure, Field, Icon, MetricCard, PriceCard, SectionHeader, StatTile, Stepper, TerminalWindow, ThemeToggle, Toast). Site chrome in `apps/web/src/components/site/`.
- **(B) `@satelink/ui` (`packages/ui`) — admin/OS dashboard system** ("Satelink Design System v2", shadcn + Radix, `.satelink-os` scope). Source of truth for OS + Admin dashboards, consumed by apps/web only in console areas. Own tokens/theme under `packages/ui/src/tokens|styles`. Exports DashboardShell, KPIGrid, DataTable, charts, Grafana panels, etc.
- **IA-v2 (§16):** the system to share across `apps/web` + `apps/corporate` is **(A) Signal**. Since `packages/ui` is taken by (B), extract Signal into a **new package** (proposed `packages/web-ui`) — never overwrite `@satelink/ui`. Decision → DECISIONS.md.

## 10. Live catalog API

- Endpoint **`https://rpc.satelink.network/v1/intelligence`** (+ per-slug `/v1/intelligence/{slug}`). Configured in `apps/web/src/lib/intelligence.ts`: `API_BASE = process.env.NEXT_PUBLIC_API_BASE || "https://rpc.satelink.network"`, `fetch(\`${API_BASE}/v1/intelligence\`)` with 4s timeout + ISR revalidate, zod-validated (`MetricSchema`/`CatalogSchema`), defensive field mapping (`price_usdt`→`priceUsd`), fallback to `apps/web/data/catalog.fallback.json` (`getFallbackCatalog()`).
- Consumers: `sitemap.ts`, `/intelligence`, `/intelligence/[metric]`, `/pricing`, `/machine`, home, styleguide.
- **IA-v2 (§2, §12):** this is the single source for `pricing-parity` CI, `/pricing.json`, `/products/*.json`, and the machine-readable panels. All prices generated from this catalog — never hand-typed.

---

## Open decisions for DECISIONS.md (Phase 2)

1. **Shared UI package name** — `packages/ui` is taken by `@satelink/ui` (dashboards). Propose `packages/web-ui` for Signal.
2. **Corporate site as separate app vs. route group** — spec wants `apps/corporate` (jakuraa.com); confirm separate Vercel project.
3. **CMS DB** — new `satelink_cms` Postgres on the existing provider (do NOT touch the app DB); confirm Payload 3 + Postgres adapter + Vercel Blob.
4. **Docs: Mintlify vs in-app portal** — two competing sources; pick one, write `DOCS_MIGRATION.md`.
5. **Email delivery** — Resend in apps/web vs. authenticated apps/api endpoint reusing Brevo.
6. **`/admin` currently inside apps/web** — spec's "admin is a separate app" is a future move; scope it or defer.
7. **pnpm→npm** — all spec `pnpm ...` script references become npm scripts.
8. **Analytics** — Vercel Web Analytics, greenfield.
