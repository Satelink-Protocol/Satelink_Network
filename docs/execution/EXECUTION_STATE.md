# EXECUTION_STATE

Updated: 2026-09-27 ~19:05 IST · Contract: `~/satelink-prompts/SATELINK_MASTER_EXECUTION.md` v2
Current wave: **1 + 2** · Current item: A5 flag gate waiting on #438/#439 merge; Wave 2 C1 PRICING_TRUTH draft (updated 2026-09-27 ~19:50 IST)

## Deployed SHA per surface (origin/main HEAD = 4b2865f, #434)
| Surface | Source dir | Serving SHA | == main | Evidence |
|---|---|---|---|---|
| Railway `Satelink-api` (api / rpc / admin.satelink.network) | repo root | 4b2865f (SUCCESS 2026-09-27T12:06Z) | yes | `railway deployment list --json` |
| Vercel `satelink-console` (console.satelink.network) | apps/console · prod branch main · no ignore cmd | 4b2865f READY | yes | Vercel API v9/projects + v6/deployments |
| Vercel `web` (satelink.network) | apps/web · prod branch main · no ignore cmd | 4b2865f READY | yes | same |
| Vercel `jakuraa-corporate` (jakuraa.com) | apps/corporate | 4b2865f READY | yes | same |
No separate docs/admin Vercel projects exist (admin.satelink.network → Railway API, 307 → /admin/command-center).

## A1 — Why production is still V1 (evidence-backed answer, Wave 0 exit)
Ruled out: (a) stale deploy / ignored build / wrong root dir, (d) old alias — every surface serves main HEAD.
Root cause = **(b) + (e): all V2 work is flag-gated and no flag is set anywhere.**
1. Every console page branches on `accountsEnabled()` = `process.env.CONSOLE_ACCOUNTS_V1 === "true"`
   (`apps/console/src/lib/account.ts:10`); the V1 branch still renders the V1 placeholder copy
   (e.g. `agents/page.tsx:56` "Scopes, spend caps, pause and rotate are coming").
2. `CONSOLE_ACCOUNTS_V1` / `CONSOLE_ONBOARDING_V1` unset on Vercel `satelink-console` (its only env var is
   `SATELINK_API_BASE`) and on Railway `Satelink-api`.
3. API: `/v1/me/*` unmounted without the flag → `GET /v1/me/account` = 404; `/webhooks/dodo/v2` = 404.
4. Schema: 039 (`account_*`) and 040 (`pv2_*`) tables do not exist in prod — created by first-use DDL only
   when the flag is on (`console_accounts/schema.mjs`).
5. `database/` runner migrations applied through 016 only → 017/018/019 pending (checksums of 001–016 match).
   `ledger_txns.kind` CHECK lacks 'refund' → #430 fix (B5) is NOT live.

(c) Build vs request time: the flag is read at **request time** in code (root layout calls `cookies()` →
every route dynamic; non-`NEXT_PUBLIC_` vars are never inlined). Vercel binds env values per deployment, so
a **redeploy is still required** after setting it.

## Findings that block the flag gate (details in CONFLICT_REGISTER / FOUNDER_GATES)
- F-1 RPC deducts BEFORE the upstream call and never refunds on 502 (`rpc_gateway.js:294` → `:435-437`, catch ~`:462`).
  Pre-existing, flag-independent. Fails FG-FLAG condition (c).
- F-2 Dodo one-time credit packs credit `api_credits.credits_usdt` (`internal_dodo.js:704` → `creditAccount`), the
  same balance RPC deducts → Dodo-funded value CAN pay RPC today. Violates §1/B6/C6. Fails FG-FLAG (c).
- F-3 2 Dodo TEST-mode payments ($9.99 ×2, founder email, key #132) are `is_test_data=false` → counted as external.
- F-4 Migration 019 contains `DROP CONSTRAINT` → FG-MIG condition (a) says stop and show founder.
- F-5 Contract flag name `USAGE_LIMITS_V2` is actually `SATELINK_USAGE_LIMITS_V2_ENABLED` in code.
- F-6 Admin `/admin/command-center` renders without login (other 12 tabs → /login); shows
  "Executive Summary fetch failed: non-JSON upstream response".

## Environment
- Git restored (Apple Git 2.39.5, CLT 16.4) at ~18:34 IST after the 17:48 CLT removal.
- `~/.zshrc` exports the PRODUCTION `DATABASE_URL` (line 66, from apps/api/.env) into every shell → tests must
  always override it (see evidence/api-test-failures-2026-09-27.txt).
- Playwright: fixed (pinned global `@playwright/mcp@0.0.82` registered as user MCP `playwright-local`; chromium 1246 installed).

## Next 3 actions
1. Founder: review/merge #438 and #439 (money path); decide FG-PRICE-LAUNCH / FG-PRICE-PACKS; restart Claude Code (FG-SESSION-RESTART).
2. Non-money: D10 TI saved-queries V2 page branch (UI PR); C8 catalog consistency test + wire /v1/pricing and /.well-known/* to the catalog.
3. D7 alerts backend (thresholds table, evaluator job, Resend sender) — required for FG-FLAG (b) "no V1 text on Alerts".

## Open PRs (2026-09-27)
- #437 test(api) prod-DB guard — non-money, CI green, awaiting review.
- #438 fix(billing) RPC charge-after-success — money-path, CI green.
- #439 fix(billing) Dodo→RPC/x402 boundary — money-path.
