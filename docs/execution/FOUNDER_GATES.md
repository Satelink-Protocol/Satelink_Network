# FOUNDER_GATES

Protocol (contract §3): each gate lists exact commands, what is prepared, and the post-action verification.
Founder replies `APPROVE <gate-id>`. Conditional approvals are executed only when every condition is shown met.

| Gate | Status | Blocking |
|---|---|---|
| FG-MIG-017-019 | APPROVED-CONDITIONAL → **STOPPED at condition (a)**: 019 contains `DROP CONSTRAINT` | B5, FG-FLAG |
| FG-FLAG-CONSOLE_ACCOUNTS_V1 | APPROVED-CONDITIONAL → **cannot proceed**: (a) unmet; (c) fails (F-1, F-2) | A5, D2–D14 |
| FG-SUBS | GATED | SATELINK_SUBSCRIPTIONS_ENABLED |
| FG-PLANV2 | GATED | PLAN_BILLING_V2_ENABLED |
| FG-USAGEV2 | GATED | SATELINK_USAGE_LIMITS_V2_ENABLED (contract spelling USAGE_LIMITS_V2 is not what code reads) |
| FG-LEGACYSUB | GATED | DODO_LEGACY_SUB_BUCKET_ENABLED |
| FG-SETTLE | GATED | SETTLEMENT_DRY_RUN (stays 1) |
| FG-DODO-WEBHOOK | GATED | Dodo TEST webhook registration |
| FG-REDACT | GATED | #428 redaction `--apply` |
| FG-KEYROT | GATED | rotation of 3 funded + 48 active exposed keys |
| FG-CF-TOKEN | GATED | rotate Cloudflare token, then delete Railway var `cloudflare_Example Usage` |
| FG-GLM-KEY | NEW | `GLM_API_KEY` in `~/.zshrc` was printed into an agent transcript on 2026-09-27 → rotate at provider |
| FG-DODO-TESTDATA | NEW | reclassify payment_sources 349, 350 (founder TEST-mode Dodo) as `is_test_data=true` |

---

## FG-MIG-017-019 — apply `database/migrations` 017, 018, 019
**Condition (a) result — STOP.** Full SQL reviewed (017: 62 lines, 018: 50, 019: 16):
- 017 `satelink_app_role`: CREATE ROLE (no password, inert while prod connects as `postgres`), GRANTs, `REVOKE UPDATE, DELETE ON ledger_entries FROM satelink_app`. No DROP, no UPDATE/DELETE of data.
- 018 `subscriptions`: `CREATE TABLE subscriptions` (no IF NOT EXISTS) + 3 indexes. Preconditions verified in prod: table absent, `principals`/`accounts` exist, `api_credits.api_key` unique.
- 019 `ledger_kind_refund`: **`ALTER TABLE ledger_txns DROP CONSTRAINT IF EXISTS ledger_txns_kind_check;`** then `ADD CONSTRAINT … CHECK (kind IN (…,'refund'))`. No rows changed; it widens the allowed set. It is nonetheless a DROP → your condition says stop and show you.
Risk notes for your decision: the runner wraps each migration in BEGIN/COMMIT (`database/runner.ts:163-173`), so DROP+ADD is atomic — if ADD fails the old constraint is restored. ADD CONSTRAINT validates 345,655 rows under an ACCESS EXCLUSIVE lock on `ledger_txns` (all current rows are kind='deposit', so it will pass); expect a lock of seconds. Also `ledger_txns` writers block during that window.
Alternative with no DROP (if you prefer): a new migration that adds `ledger_txns_kind_check_v2 … NOT VALID`, `VALIDATE CONSTRAINT`, then drops the old one — still a DROP, just later. There is no DROP-free way to widen a CHECK in Postgres.
**Condition (b) — done (read-only):** `docs/execution/evidence/db-snapshot-before-2026-09-27.txt`
(schema_migrations 1–16; api_credits 55 · ledger_entries 691,310 · ledger_txns 345,655 · revenue_events_v2 345,887 · api_deposits 8; DB 681 MB).
**To approve despite the DROP, reply:** `APPROVE FG-MIG-017-019 incl-019-drop-constraint`
Command (from worktree on main, connection string passed as argument, never printed):
`npx tsx database/runner.ts migrate "$(railway variables --service Postgres-iQeW --kv | grep ^DATABASE_PUBLIC_URL= | cut -d= -f2-)"`
Post-verify (c): schema_migrations shows 017–019; `BEGIN; INSERT INTO ledger_txns(… kind='refund' …); ROLLBACK;` succeeds; the 5 row counts unchanged.

## FG-FLAG-CONSOLE_ACCOUNTS_V1
- (a) blocked on FG-MIG.
- (b) Preview proof: a Vercel preview of `satelink-console` with the flag ON needs an API that serves `/v1/me/*`;
  Railway has only a production environment, so the preview can only show V2 UI against a 404ing API until the
  Railway flag is on. Options: (1) accept a Railway-first flip with rollback, (2) create a Railway `staging` env
  (new infra — your call).
- (c) **FAILS** as the code stands:
  - Deduction path (flag ON): `rpc_gateway.js:294 enforceCapacity` → `credit_service.mjs:120 authorizeAndMeter`
    → `:175-194 deductWithAccountLimits` (`console_accounts/limits.mjs:72`) — one transaction: pause/scope/auto-use/
    per-agent daily cap/monthly cap, then conditional `UPDATE api_credits … WHERE credits_usdt >= cost`.
    Flag OFF: `:195-213` single conditional UPDATE. **Both run BEFORE the upstream call.** Upstream failure returns
    502 at `rpc_gateway.js:435-437` / catch ~`:462` with **no refund** → a paid key is charged for 5xx.
    (Trading Intelligence already charges after data since #429 — RPC does not.)
  - Dodo boundary: plan/pack UU is drawn only for `product === 'intelligence'` (`limits.mjs:100`, `credit_service.mjs:170`),
    BUT one-time Dodo credit packs are credited into `api_credits.credits_usdt` via `/internal/dodo/credit`
    (`internal_dodo.js:704` → `creditAccount`) — the same balance RPC deducts. Dodo-funded value can pay RPC today
    (flag-independent). Prod holds 2 such payments ($19.98, founder TEST mode).
  - Fix PRs to be prepared (money path → your merge): refund-or-charge-after-success for RPC; separate Dodo-funded
    balance (or source-tagged credits) excluded from RPC/x402 deduction.
- Rollback (pre-written, used if any post-flip check fails):
  Railway: `railway variables --service Satelink-api --set CONSOLE_ACCOUNTS_V1=false` (triggers restart; flag read at call time).
  Vercel: `vercel env rm CONSOLE_ACCOUNTS_V1 production --yes && vercel redeploy <current-prod-deployment-url> --prod` (from apps/console link).
  Note: first-use DDL (`account_*` tables) is additive and stays; it is inert with the flag off.

## Still-gated flags — exact commands (not executed)
Order (after FG-FLAG verified): FG-SUBS → FG-DODO-WEBHOOK → FG-PLANV2 → FG-USAGEV2 → FG-LEGACYSUB.
- `railway variables --service Satelink-api --set SATELINK_SUBSCRIPTIONS_ENABLED=true` → verify `curl -s -o /dev/null -w '%{http_code}' -X POST https://api.satelink.network/webhooks/dodo/v2` ≠ 404 (expect 400/401 unsigned).
- Dodo dashboard (TEST mode) → Webhooks → add `https://api.satelink.network/webhooks/dodo/v2`; copy signing secret →
  `railway variables --service Satelink-api --set DODO_WEBHOOK_SECRET=<paste>` (handler falls back to another var if unset — set explicitly).
- `railway variables --service Satelink-api --set PLAN_BILLING_V2_ENABLED=true` → verify checkout endpoint returns a TEST checkout URL.
- `railway variables --service Satelink-api --set SATELINK_USAGE_LIMITS_V2_ENABLED=true` → verify TI call writes a `pv2_usage_ledger` row.
- `railway variables --service Satelink-api --set DODO_LEGACY_SUB_BUCKET_ENABLED=true` → verify RPC with a plan-only key still 402s.
- SETTLEMENT_DRY_RUN stays `1` (condition: external metered revenue > $0.50 from a non-founder wallet — currently $0.20).
- Redaction: `node apps/api/scripts/incidents/redact_exposed_keys.mjs --apply` (dry-run output first) — after FG-KEYROT.
- Cloudflare: rotate token in dashboard → `railway variables --service Satelink-api --remove "cloudflare_Example Usage"` → verify absent via `railway variables --kv | cut -d= -f1`.
