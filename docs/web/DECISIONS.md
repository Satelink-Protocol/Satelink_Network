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
- (pending Phase 2/3)

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
