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
