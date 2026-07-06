# Public Site & Documentation Audit — 2026-07-07

Phase 1 report for the website/documentation transformation (branch
`site/website-docs-transformation`, stacked on PR #236). Everything below was
verified against the repository, production endpoints, and the live GitHub Wiki.

## 1. Existing public surface

| Route | State |
|---|---|
| `/` (homepage, 1,535-line client page) | Live; approved canvas/scroll animation base; content defects below |
| `/docs` | Thin link-hub → GitHub Wiki (4 external links) — not a docs portal |
| `/status` | Live, honest (used by status.satelink.network rewrite) |
| `/machine` | Machine-economy landing — no fabricated claims found |
| `/node`, `/node/setup`, `/node/earnings`, `/node/claim` | Node operator portal (exists) |
| `/satelink/os/*` | Developer portal (PR #236 surface) |
| `public/*.html` ×11 | Legacy static site (about, blog, careers, press, compare, calculator, wiki, privacy, terms, index, landing-page) — duplicate/outdated content |

## 2. Defects found (pre-change)

**Fabrications (must remove — violate "no fake metrics / no fake testimonials"):**
- Homepage hardcoded `99.8%` uptime + `85ms` latency in 3 places (hero metrics, social-proof stats, live-stats section) — while a live `/api/status` fetch exists on the same page.
- Two fake testimonials ("Anonymous Developer — DeFi Protocol Team", "Node Operator — Singapore") with invented quotes ("40% cheaper", "Setup took 10 minutes").
- "Coming Soon" webhooks product card claims a "99.9% delivery guarantee" for a product that does not exist.
- GitHub Wiki: "Yes. 99.8% uptime currently" (FAQ), "SLA guarantee 99.9%" (Pricing).

**Broken navigation:**
- `Login`, `Launch Console` (×4) → `/satelink/os/overview` — **route does not exist** (also referenced by `vercel.json` app-subdomain redirect and `/docs` page).
- `Node Operators` nav (×2) → `/satelink/os/nodes` — **route does not exist**.
- Mobile menu button renders but has **no click handler** — navigation is dead on mobile.
- Footer links to `about/blog/press/careers/compare/calculator/wiki .html` legacy pages.
- Social links `discord.gg/satelink`, `twitter.com/satelinknet` — unverified/unclaimed handles.

**Outdated facts:**
- On-chain "proof" links (×3 homepage, ×4 wiki) point to `0x6987921e…1CC9` ("ClaimsContract") — the current production vault is **RevenueVaultV2 `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`** (PR #234/#235), USDT `0xc2132D…8e8F`, chain 137.
- Wiki "Dashboard → app.satelink.network" — dead Vercel domain (memory: confirmed dead); real portal is `/satelink/os` (developer subdomain planned).
- docs.satelink.network was planned to CNAME to Mintlify (middleware comment) — never done; currently the "docs" experience is the GitHub Wiki.

**SEO / AI-readiness gaps:**
- No `sitemap`, no `robots`, no `llms.txt`, no JSON-LD, no canonical URLs, no per-page metadata beyond root layout, no 404 page, no breadcrumbs.
- `public/index.html` + `landing-page.html` are full duplicate copies of the homepage (duplicate content).

**Docs duplication:** `docs/API_REFERENCE.md` vs `docs/api-reference.md`, wiki vs `docs/` drift (wiki says ClaimsContract; repo says RevenueVaultV2).

## 3. What is REAL (safe to state publicly)
- RPC gateway on Polygon PoS 137, $0.00003/call metering, free tier 500 calls/day/IP.
- USDT credit system: permissionless deposits to RevenueVaultV2, on-chain confirmed (real external deposit of 5 USDT on 2026-07-05).
- Epoch-based revenue ledger + settlement batches (settlement broadcasting currently in DRY_RUN — honest label: "settlement automation in final verification").
- Wallet (MetaMask sign-to-create) + API-key authentication; machine onboarding via HTTP 402 flow (`/v1/machine/register`).
- Admin command center, node portal, developer portal, status page; `@satelink/sdk` v0.2.0 (JS) exists in-repo.
- 50/30/20 revenue split model. 1 active node (self-operated) — public copy must not imply a large node fleet.

## 4. Plan of record
- Homepage: remove fabrications, live-wire all metrics to `/api/status` (— when absent), fix all routes, honest roadmap (Completed / In Progress / Next), functional mobile menu, real contract addresses.
- `/docs`: real portal (sidebar, categories per spec) rendered from markdown in `apps/web/src/content/docs/`, served for docs.satelink.network via middleware host-map. Wiki becomes a thin mirror pointing at the portal.
- SEO/AI: sitemap.ts, robots.ts, llms.txt, JSON-LD, per-page metadata, canonical, OG/Twitter, 404, breadcrumbs.
- Legacy `public/*.html` (except `privacy.html`, `terms.html`) removed; footer rebuilt to real routes.

**Manual/DNS blockers (cannot be done from the repo):** point
`docs.satelink.network` CNAME → `cname.vercel-dns.com` and add the domain to the
Vercel project (Settings → Domains). Until then the portal is reachable at
`satelink.network/docs`.
