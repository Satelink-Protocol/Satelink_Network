# FOUNDER_GATES

Protocol (contract §3): each gate lists exact commands, what is prepared, and the post-action verification.
Founder replies `APPROVE <gate-id>`. Conditional approvals are executed only when every condition is shown met.
Updated 2026-09-27 ~19:50 IST.

| Gate | Status | Blocking |
|---|---|---|
| FG-MIG-017-019 | **DONE 2026-09-27 13:39Z** — pre-approved shape (DROP CONSTRAINT re-added as superset); all conditions verified | — |
| FG-PR-438 | **REVIEW** — merge PR #438 (RPC charge-after-success, money path) | FG-FLAG (c), B4 |
| FG-PR-439 | **REVIEW** — merge PR #439 (Dodo → RPC/x402 boundary, money path) | FG-FLAG (c), B6, C6 |
| FG-FLAG-CONSOLE_ACCOUNTS_V1 | APPROVED-CONDITIONAL → (a) ✅ met · (b) ⚠️ 2 pages fail · (c) ⏳ needs #438 + #439 merged | A5, D2–D14 |
| FG-RPC-REFUND | GATED | `refund_rpc_failed_charges.mjs --apply` (external $0; founder ≤ $0.00102) |
| FG-DODO-FENCE | GATED | `backfill_dodo_ringfence.mjs --apply` after #439 deploys (key 132 → $19.98) |
| FG-DODO-TESTDATA | GATED | reclassify payment_sources 349, 350 (founder TEST-mode Dodo) as `is_test_data=true` |
| FG-PRICE-LAUNCH | DECISION | Launch allowance: catalog 1,500/7,500 vs §1 300/1,500 |
| FG-PRICE-PACKS | DECISION | pack bonuses: catalog none vs §1 +5 % / +10 % |
| FG-INR | DECISION | `inr_price` values (all null) |
| FG-SUBS | GATED | SATELINK_SUBSCRIPTIONS_ENABLED |
| FG-PLANV2 | GATED | PLAN_BILLING_V2_ENABLED |
| FG-USAGEV2 | GATED | SATELINK_USAGE_LIMITS_V2_ENABLED (code name; contract says USAGE_LIMITS_V2) |
| FG-LEGACYSUB | GATED | DODO_LEGACY_SUB_BUCKET_ENABLED |
| FG-SETTLE | GATED | SETTLEMENT_DRY_RUN stays 1 (external metered revenue $0.20 < $0.50) |
| FG-DODO-WEBHOOK | GATED | Dodo TEST webhook registration |
| FG-REDACT | GATED | #428 redaction `--apply` |
| FG-KEYROT | GATED | rotate 3 funded + 48 active exposed keys |
| FG-CF-TOKEN | GATED | rotate Cloudflare token, then delete Railway var `cloudflare_Example Usage` |
| FG-GLM-KEY | GATED | rotate `GLM_API_KEY` (printed into an agent transcript 2026-09-27) |
| FG-SESSION-RESTART | ACTION | restart Claude Code once: this session still inherits the old prod `DATABASE_URL` from its launch environment |

---

## FG-MIG-017-019 — DONE
- Only DROP: `019:14 ALTER TABLE ledger_txns DROP CONSTRAINT IF EXISTS ledger_txns_kind_check;` re-added at `019:15-16` with
  `(…'reversal','refund')` ⊃ old set; runner wraps each file in BEGIN/COMMIT (`database/runner.ts:163-173`). No DROP TABLE/COLUMN,
  no data UPDATE/DELETE (017's UPDATE/DELETE tokens are GRANT/REVOKE privileges).
- Pre-proof: prod constraint name matches; 0 rows violate the new set; 019 executed in a rolled-back prod transaction
  (`lock_timeout 3s`) → new definition in-txn, old definition after ROLLBACK.
- Applied: `evidence/mig-017-019-run.txt` — Applied 017, 018, 019; 001–016 skipped (checksums match).
- Verified (`evidence/mig-017-019-after.txt`): schema_migrations 17–19 present; constraint includes 'refund';
  `INSERT … kind='refund'` succeeds in a rolled-back txn (0 rows persisted); 5/5 row counts identical to
  `evidence/mig-017-019-before.txt`; `api.satelink.network/health` 200.

## FG-FLAG-CONSOLE_ACCOUNTS_V1 — condition status
- (a) ✅ migrations 017–019 applied (above).
- (b) Preview proof:
  - Vercel preview `dpl_57k1UPuEUZbJ5CGizbUiiJtwKV1G` READY from branch `preview/console-v2-flags` @ 51b2c88 with
    `CONSOLE_ACCOUNTS_V1=true`, `CONSOLE_ONBOARDING_V1=true` scoped to that branch + preview target only. It is behind
    Vercel SSO and calls the production API, where `/v1/me/*` is 404 until the Railway flag is on — so signed-in
    verification on the Vercel preview is structurally impossible before (d).
  - Same commit, built with both flags, against the repo's local harness API (real `/v1/me`, `/v2/plans`,
    intelligence routers on local Postgres; real Dodo TEST checkout):
    - `e2e/onboarding.spec.ts` **6/6** (desktop + 360 px; Free + Launch; Dodo TEST checkout → pending → signed webhook →
      home; resume; India INR). Optional marketing consent **unticked by default** (asserted).
    - `e2e/accounts-gate.spec.ts` + `e2e/simple-flows.spec.ts` **14/14** (account-linked keys identical across 3 browser
      profiles; Simple task flows; Advanced dashboard + mode remembered; Pricing V2 billing, no V1 plan table; mobile).
    - V1-placeholder scan, Simple + Advanced × 12 routes (`evidence/after-preview-v2-2026-09-27/`): all 200, 0 console
      errors; Agents, Keys, Requests, Usage clean. **FAIL: `/alerts` still "Alerts aren't available yet"** (no alerts
      backend exists — D7) and **`/trading-intelligence` still "Saved queries arrive…"** (API exists; page has no V2
      branch — D10 UI fix).
- (c) Deduction path with the flag on: `rpc_gateway.js` → `enforceCapacity` → `authorizeAndMeter` →
  `deductWithAccountLimits` (`console_accounts/limits.mjs`) → `deductSql(product)`. Charge-after-success = PR #438;
  Dodo value cannot pay RPC/x402 = PR #439. Both need your merge.
- (d)/(e)/(f) not started. Rollback (pre-written):
  Railway: `railway variables --service Satelink-api --set CONSOLE_ACCOUNTS_V1=false` (restart; read at call time).
  Vercel: `vercel env rm CONSOLE_ACCOUNTS_V1 production --yes` then redeploy the current production deployment.

## Still-gated flags — exact commands (not executed)
Order (after FG-FLAG verified): FG-SUBS → FG-DODO-WEBHOOK → FG-PLANV2 → FG-USAGEV2 → FG-LEGACYSUB.
- `railway variables --service Satelink-api --set SATELINK_SUBSCRIPTIONS_ENABLED=true` → verify `POST /webhooks/dodo/v2` unsigned ≠ 404 (expect 400/401).
- Dodo dashboard (TEST) → Webhooks → add `https://api.satelink.network/webhooks/dodo/v2`; copy signing secret →
  `railway variables --service Satelink-api --set DODO_WEBHOOK_SECRET=<paste>` (handler falls back to another var if unset — set explicitly).
- `railway variables --service Satelink-api --set PLAN_BILLING_V2_ENABLED=true` → verify checkout returns a TEST checkout URL.
- `railway variables --service Satelink-api --set SATELINK_USAGE_LIMITS_V2_ENABLED=true` → verify a TI call writes a `pv2_usage_ledger` row.
- `railway variables --service Satelink-api --set DODO_LEGACY_SUB_BUCKET_ENABLED=true` → verify RPC with a plan-only key still 402s.
- Refund (after #438): `node apps/api/scripts/incidents/refund_rpc_failed_charges.mjs "<conn>" --apply` (founder keys only with `--include-founder`).
- Ring-fence (after #439 deploys): `node apps/api/scripts/incidents/backfill_dodo_ringfence.mjs "<conn>" --apply`.
- Redaction: `node apps/api/scripts/incidents/redact_exposed_keys.mjs --apply` (dry-run first) — after FG-KEYROT.
- Cloudflare: rotate token in dashboard → `railway variables --service Satelink-api --remove "cloudflare_Example Usage"` → verify absent via `railway variables --kv | cut -d= -f1`.
