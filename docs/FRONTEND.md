# Satelink Frontend
Last verified: 2026-06-26. Next.js (App Router), `apps/web`, Vercel, `app.satelink.network`.

## Page inventory (audit §4.1 — 40 `page.tsx`)
Two parallel admin UIs coexist:
- **`(admin)/admin/*`** — page, abuse, diagnostics/{incidents,self-tests}, ledger, nodes,
  revenue, revenue/events, rewards/epochs, security, security/audit, settings, users.
- **`satelink/os/(metering)/*`** — overview, mission-control, revenue-ops, settlement-lifecycle,
  billing, deposit, keys, usage, nodes, monitoring, customer-zero, agent-fleet.
- Plus `(builder)/*`, `(node)/*`, `(distributor)/*`, `/admin/command-center`, `/login`, `/docs`, `/`.
> Exact static-page count is produced by `next build`; verify in a clean checkout (the main
> working tree carries in-progress UI work — NOC charts, metering pages — not on this branch).

## Admin wiring pattern
All admin pages call **`/api/admin-proxy`** (Next.js route handler) which injects
`ADMIN_TOKEN` server-side and forwards to `${API_BASE}/admin/*`. The browser never sees the
token. SSE via `new EventSource('/api/admin-proxy?stream=live/feed')`. See `docs/ADMIN_DASHBOARD.md`.

## Security fix on this branch (Phase 9b)
`apps/web/src/app/api/admin-proxy/route.js` previously logged the admin token prefix
(`token?.substring(0,6)`) in two `console.log`s — **removed**. Two non-credential debug logs
remain (one logs the full upstream admin response) — flagged for follow-up in `docs/SECURITY.md`.

## Base URLs
`NEXT_PUBLIC_API_BASE` / `NEXT_PUBLIC_API_URL` → `rpc.satelink.network` (== `api.`).
The admin-proxy defaults to `https://rpc.satelink.network`.

## Tooling
- shadcn/studio MCP installed (2026-06-26): `shadcn-studio-mcp` connected; commands `/cui` `/rui`.
- `apps/web/components.json` registries: `@ss-components`, `@ss-themes`, `@ss-blocks`.
- `next.config.ts`: `images.unsplash.com` allowed.

## Build / deploy
- `next build` (run from `apps/web`). No root `vercel.json`; build config lives in the web app.
- Deploys on merge to `main` (Vercel auto-deploy). Auth: `/satelink/os/*` login flow works
  (Vercel catch-all rewrite removed).
