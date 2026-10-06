# Security hotfix — Gate 0 B-02 / B-03 (2026-10-07)

Closes the internet-reachable holes from trading-agent audit 06 (S-01, S-02,
S-05, S-06; also audits 03 §0.2 and 04 §0). Branch `hotfix/gate0-b02-b03`.
**Code alone does not resolve B-02/B-03:** the tokens that were exposed must be
rotated (founder actions below).

## Routes changed

| Audit | Route | Before | After |
|---|---|---|---|
| S-01 | `POST /api/admin-proxy` (web) | Any anonymous caller → API `/admin/*` with `ADMIN_TOKEN` injected (read customers/revenue/treasury/config; trigger jobs, Discord post, intel PATCH) | **404** for everyone. Reachable only if `ADMIN_UI_ENABLED=true` **and** a server-verified staff session (none exists, see below). Paths containing `..` (raw or %-encoded), backslashes, control chars or a scheme → 404; upstream must resolve under `/admin/` on the API origin. `ADMIN_TOKEN` is read only after the gate and path check pass. |
| S-01 | `GET /api/admin-proxy?stream=…` (SSE, web) | Same open relay for `/admin/live/feed` | **404**, same gate and path check |
| S-01 | `GET/POST /api/grafana/*` (web) | Any caller got `GRAFANA_TOKEN` injected, frame headers stripped | **404**, same gate; `..`/`.`/separator segments → 404 |
| S-02 | `/ops/*` pages (web, incl. `ops.satelink.network`) | Admitted any non-empty `ops-session` **or** `x-admin-token` cookie | **404** (middleware + layout `notFound()`); cookies are no longer read |
| S-02 | `POST /api/ops-auth` (web) | Compared to `ADMIN_TOKEN` with `!==` (guessing oracle), then set the constant cookie `ops-session=1` | **404**, same gate; no cookie is ever set |
| S-02 | `/admin/*` pages (web, incl. `admin.satelink.network`) | Client-side decode of an **unverified** localStorage JWT | **404** in middleware, same gate |
| S-05 | `POST /system/epoch-scheduler/trigger` (API) | Unauthenticated; writes `epoch_earnings` payables | `requireAdminAuth` (the same middleware as `/admin`) → **401** without a valid `x-admin-token` / `Authorization: Bearer`; **503** if `ADMIN_SECRET_TOKEN` unset; admin → unchanged |
| S-05 | `POST /system/data-retention/trigger` (API) | Unauthenticated; prunes audit logs / VACUUM | Same as above |
| S-06 | `api_phase3` router (API): `POST /node/me/withdraw`, `POST /node/me/claim`, `GET /treasury/status`, `GET /services/settlement/mode` | Mounted at `/` without auth; withdraw reached USDT transfer code with a hard-coded fallback wallet | **Unmounted** (import and `app.use` removed from `server.js`) → **404**. File `src/gateway/routes/api_phase3.js` kept. |

Not changed: the read-only `GET /system/*` status endpoints, `/api/treasury/status`
(served by `app_factory.mjs`), and every ledger, billing, x402 or RPC handler.

## Why the web admin surfaces are OFF rather than "behind auth"

apps/web has **no server-verifiable staff session**. The `ops-session` cookie is
an unsigned `"1"`, and the `(admin)` layout trusts a JWT it decodes in the browser
without verifying it. Building a real one is out of scope for this hotfix.
`src/lib/admin-ui-gate.ts` therefore has `hasVerifiedStaffSession()` return
`false`. **Setting `ADMIN_UI_ENABLED=true` does not turn anything back on** until
a signed, server-verified staff session is implemented and wired into that function.

## Known impact (no payment path affected)

- The admin and ops dashboards on the web app are unavailable. Founder operations
  continue against the API directly (`curl -H "x-admin-token: …" https://api.satelink.network/admin/...`).
- `/satelink/os/mission-control` and `/machine-console`: the executive-summary
  KPI tiles show their empty state (they read via admin-proxy and already handle `null`).
- `/satelink/os/monitoring`: embedded Grafana panels show "not configured".
- `(node)/node/claim`: `POST /node/me/claim` now 404s. It returned proofs for a
  hard-coded fallback wallet, and settlement is `SETTLEMENT_DRY_RUN=1`.
- No scheduler, workflow or script in the repo calls `/system/*/trigger`
  (searched, including `.github/`). The epoch and retention jobs run in-process and are unaffected.

## Residual risk (follow-ups, not in this PR's allowed file list)

- `requireAdminAuth` (`apps/api/src/admin/admin_router.js:45`) compares with
  `!==`, not `crypto.timingSafeEqual`. This hotfix reuses it as instructed, so the
  two triggers add no exposure beyond what every `/admin/*` route already has.
  Making it constant-time is a one-line change in `admin_router.js`. Recommended next.
- A real staff session (signed, expiring, tied to a staff identity) is needed
  before any admin or ops web UI returns.

## Founder actions (Claude Code must NOT do these)

1. **Remove `ADMIN_TOKEN` from the Vercel web project** (it is no longer needed: every reader is gated off).
2. **Rotate `ADMIN_SECRET_TOKEN` on Railway** (`Satelink-api`). It was effectively public via the open proxy.
3. **Delete and recreate the leaked Discord webhook** (B-01).
4. **Delete the Paperclip Railway service and rotate `ANTHROPIC_API_KEY`** (B-04).
5. **Switch the API's `DATABASE_URL` to the `satelink_app` role** (B-07(b)).

B-02/B-03 should be marked RESOLVED only after this PR is merged **and** items 1–2 are done.

## Tests

- `apps/web/test/gate0-admin-ui-gate.test.ts`: 70 tests. Every gated web route
  returns 404 with the gate unset **and** with `ADMIN_UI_ENABLED=true`, including the
  old forgeable cookies. `fetch` is never called, so no token is forwarded. Proxy
  and Grafana traversal returns 404. Public routes are unchanged. Each origin/main
  file fails the suite (mutation-checked).
- `apps/api/test/gate0_system_triggers_phase3.test.js`: 16 tests. Both triggers:
  no, wrong or query-param token → 401, admin header or Bearer → handler runs,
  unset secret → 503. Source pins `requireAdminAuth` on every `/system/*trigger`
  registration and the absence of `api_phase3`. origin/main's `server.js` fails 3 of them.

## Rollback

Revert the PR. No data, schema or env changes.
