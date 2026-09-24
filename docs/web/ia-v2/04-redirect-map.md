# 04 — Redirect Map

Redirects drive the CMS `Redirect` collection → Next.js middleware in both public
apps (edge-cached map). §5.

## Permanent (308) redirects
| From | To | Reason |
| --- | --- | --- |
| `/platform/pricing` | `/pricing#platform` | one pricing page |
| `/dashboard` | `/satelink/os/mission-control` | existing console |
| `/intelligence` | `/products/trading-intelligence` | canonical product URL — **gated**: only after confirming no checkout/claim logic depends on `/intelligence` (verify `/api/dodo-*` + `/intelligence/success` unaffected) |
| `/rpc` | `/products/rpc` | canonical (keep old as redirect) |
| `/network` (product framing) | keep `/network`; link `/products/rpc` for the definition | — |

## Stays put (do NOT redirect)
- `/intelligence/success` — the #398 claim→key page; keep exactly as-is.
- `/checkout`, `/checkout/success`, `/checkout/cancel` — keep.
- `/status` — restyle only (apex 308s to status subdomain already; documented).

## Legacy path preservation
When a page moves (e.g. `/intelligence` → `/products/trading-intelligence`), add a
`Redirect` row so inbound links/bookmarks/SEO don't 404. Never delete a public URL
without a redirect. The `link-graph` CI check fails on any broken internal link.

## Middleware ordering
The existing `apps/web/src/middleware.ts` does host→path subdomain rewrites and is
**excluded from `/api`**. The Redirect-collection map runs as an additional check
in the same middleware, BEFORE the subdomain rewrite, matching only known
redirect sources (edge-cached, no per-request DB call).
