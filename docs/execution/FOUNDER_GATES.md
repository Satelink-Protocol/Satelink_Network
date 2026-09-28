# FOUNDER_GATES

Protocol (contract §3): each gate lists exact commands, what is prepared, and the post-action verification.
Founder replies `APPROVE <gate-id>`. Conditional approvals are executed only when every condition is shown met.
Updated 2026-09-28 ~05:25 IST.

## 2026-09-28 session — gates opened or changed (read this first)

| Gate | Status | What you do |
|---|---|---|
| FG-PR-447 | **READY FOR FOUNDER MERGE** — pack bonuses (D-2) | review + merge #447 |
| FG-PR-448 | **READY FOR FOUNDER MERGE** — JSON-RPC errors 200 + charged (D-4) | review + merge #448 (confirm: HTTP 429 / `-32005` stay uncharged) |
| FG-PR-449 | **READY FOR FOUNDER MERGE** — TEST-mode checkout allowlist (Task 2) | merge #449 **before any money flag**, then FG-CHECKOUT-ALLOWLIST |
| FG-CHECKOUT-ALLOWLIST | PREPARED | set `DODO_TEST_CHECKOUT_ALLOWLIST` (below) |
| GATE-BACKFILL-KEY132 (FG-DODO-FENCE) | **APPROVED by founder (D-3); condition MET; apply BLOCKED by this session's permission classifier (prod write)** | run the one command below, or allow the write and reply `run key132` |
| FG-CF-TOKEN | **Variable GONE** (verified 2026-09-28); old-token check **impossible** (no copy left) | confirm in Cloudflare → My Profile → API Tokens that the old token is deleted/rolled |
| FG-ADMIN-TOKEN-ROTATE | **NEW — P1** | rotate `ADMIN_SECRET_TOKEN` (see below — exposed to this session's transcript) |
| FG-SUBS / FG-DODO-WEBHOOK / FG-PLANV2 | PREPARED (Wave 4 sequence below) | after #449 merged + allowlist set |
| FG-KEYROT | PREPARED — all 3 funded exposed keys are **founder-owned** | rotate keys 12, 29, 132 yourself; notification text below |
| FG-REDACT | **NO-OP today** — dry-run finds 0 rows | nothing to apply; keep the script |
| FG-ALCHEMY | UNVERIFIED | check Alchemy dashboard (steps below) |
| FG-REV-RECOGNITION | **NEW — DECISION** | revenue double-count on prepaid rails (below) |
| FG-TI-REGION | PREPARED — do not execute | see `docs/execution/TI_WORKER_REGION_PLAN.md` |

### GATE-BACKFILL-KEY132 — condition evidence and the command
Dry-run (READ ONLY txn, `~/satelink-private/evidence/ringfence-dryrun-2026-09-28.json`): **one candidate only, key 132**
`sk_dodo_…46a5` — credits 19.98, Dodo credited 19.98, reversed 0, fence 0 → target **19.98**.
Ownership (`evidence/key132-ownership-2026-09-28.txt`): payment_sources 349 + 350 ($9.99 each, source dodo, TEST mode) —
payer = founder email (both); key 132's own email = founder email; no wallet; **0** revenue_events_v2 rows (never used).
→ founder/test account: condition met.
```
cd ~/satelink && railway run --service Postgres-iQeW -- sh -c 'node apps/api/scripts/incidents/backfill_dodo_ringfence.mjs "$DATABASE_PUBLIC_URL" --apply'
```
Expected output: key 132 `fence_target 19.98`. Verify the split:
```
railway run --service Postgres-iQeW -- sh -c 'psql "$DATABASE_PUBLIC_URL" -c "SELECT id, credits_usdt, dodo_funded_usdt, credits_usdt - dodo_funded_usdt AS crypto_spendable FROM api_credits WHERE id = 132"'
```
Expected: `19.98 | 19.98 | 0` → key 132 can spend its $19.98 on Trading Intelligence only; RPC/x402 see $0.
Also still open: **FG-DODO-TESTDATA** — payments 349/350 are founder TEST-mode and still `is_test_data=false`.

### FG-CHECKOUT-ALLOWLIST (after #449 is merged and deployed)
```
railway variables --service Satelink-api --set 'DODO_TEST_CHECKOUT_ALLOWLIST=<your founder email>[,<second email>]'
vercel env add DODO_TEST_CHECKOUT_ALLOWLIST production   # project: web (legacy /api/dodo-checkout); paste the same list
vercel redeploy <current web production url>             # env binds per deployment
```
Verify (I run): non-allowlisted test account → `POST /v1/me/checkout` 403 `checkout_not_available`; your account → 201 with a
`test.checkout.dodopayments.com` URL; `GET /v2/plans` → every paid item `purchasable:false, availability:"soon"`.
Rollback: `railway variables --service Satelink-api --set DODO_TEST_CHECKOUT_ALLOWLIST=` (empty = nobody can check out).

### Money flags — exact order (Wave 4). Names verified in code 2026-09-28
Code reads **`SATELINK_PLAN_BILLING_V2_ENABLED`** (`pricing_v2/checkout.mjs:11`) — NOT `PLAN_BILLING_V2_ENABLED`
(the name in your message and in older rows below). Webhook secret: `DODO_WEBHOOK_SECRET`, falling back to
`DODO_WEBHOOK_SECRET_KEY` (`pricing_v2/webhooks.mjs:30`) — set the first explicitly. Mode: `DODO_MODE` (unset = test).
Dodo API key for TEST checkouts: `DODO_API_KEY_TEST` (or `DODO_TESTMODE_API_KEY`) must exist on `Satelink-api`.

Preconditions: #449 merged + deployed; FG-CHECKOUT-ALLOWLIST set; GATE-BACKFILL-KEY132 applied.
1. Webhook route on: `railway variables --service Satelink-api --set SATELINK_SUBSCRIPTIONS_ENABLED=true` (restart).
   Verify: `curl -s -o /dev/null -w '%{http_code}' -X POST https://api.satelink.network/webhooks/dodo/v2` → **401** (was 404).
2. Dodo dashboard → **Test mode** → Developer → Webhooks → Add endpoint
   URL `https://api.satelink.network/webhooks/dodo/v2`; events: `payment.succeeded`, `payment.failed`, `subscription.*`,
   `refund.*`, `dispute.*`. Copy the signing secret (`whsec_…`).
3. `railway variables --service Satelink-api --set 'DODO_WEBHOOK_SECRET=<paste whsec_…>'` (restart).
   Verify: Dodo dashboard "Send test event" → endpoint shows 2xx; `pv2_webhook_events` gains a row.
4. Checkout on: `railway variables --service Satelink-api --set SATELINK_PLAN_BILLING_V2_ENABLED=true` (restart).
   Verify: your account `POST /v1/me/checkout {"itemId":"launch"}` → 201 TEST checkout URL; any other account → 403.
5. Allowance metering (needed for "a TI call consumes the allowance"):
   `railway variables --service Satelink-api --set SATELINK_USAGE_LIMITS_V2_ENABLED=true` (FG-USAGEV2).
Rollback for each: `--set <NAME>=false` (DODO secret: leave; route unmounts when SUBS is false).

Then reply `APPROVE WAVE4-E2E` and I run: TEST checkout for **Launch** (card 4242…, in the headed browser, you complete
the Dodo page) → signed `payment.succeeded` + `subscription.active` → `pv2_entitlements` launch/active → one TI call →
`pv2_usage_ledger` row (bucket `plan`, 10 UU) → RPC with a key of the same account and no crypto credits → **402** →
replay the exact webhook (same `webhook-id`) → `payment_already_applied`, no second grant. I report the ledger row ids
(`pv2_payments`, `pv2_webhook_events`, `pv2_usage_ledger`, `revenue_events_v2`, `ledger_txns`).

### FG-ADMIN-TOKEN-ROTATE (P1, new)
At ~04:40 IST a mis-ordered shell redirect printed the first lines of `railway variables --json` for `Satelink-api`
into this Claude session's transcript, including the value of **`ADMIN_SECRET_TOKEN`**. It did not reach the repo, logs,
or any third-party service, but it is now in a model transcript → treat as exposed.
```
railway variables --service Satelink-api --set "ADMIN_SECRET_TOKEN=$(openssl rand -hex 32)"
```
Then update anything that sends `X-Admin-Token` (admin.satelink.network login secret, local scripts, Paperclip agents).
Verify: old token → 401 on `GET /admin/config`; new → 200.

### FG-KEYROT — exposed keys (evidence `~/satelink-private/evidence/funded-exposed-keys-2026-09-28.txt`)
The 3 funded exposed keys are **all founder-owned**: key 12 (live-prefix, `…135a`) ($0.599090, founder wallet), key 29
`sk_free_…5677` ($4.989160, founder wallet), key 132 `sk_dodo_…46a5` ($19.98, founder email). No external customer
funds are exposed. Of the 52 exposed keys: 51 active, 5 founder-owned, **1 external key has an email**, 15 are
wallet-only (no contact channel), the rest anonymous.
Rotate (console, signed in as you): Keys → key → **Rotate** (moves the balance, #425) — or ask me with `APPROVE FG-KEYROT`
to run a server-side rotation per key. For the other 48 active keys: rotate-on-next-use banner in console + the notice
below to the 1 reachable email (security notices are transactional — no marketing consent needed).

Customer notice (draft, send from `support@satelink.network`):
> Subject: Security notice — please rotate your Satelink API key
> Between 16 July and 27 September 2026 a Satelink internal admin snapshot stored full API keys (yours ends in `…XXXX`)
> in our own database. It was never public and we have no evidence it was accessed by anyone outside Satelink. We have
> stopped storing keys this way (fix #428) and removed the stored copies. As a precaution please rotate the key:
> console.satelink.network → Keys → Rotate (your balance moves to the new key). Questions: reply to this email.

### FG-REDACT — dry-run 2026-09-28 (`evidence/redact-dryrun-2026-09-28.txt`)
`revenue_events_v2.request_id`: **0** rows with keys · `machine_crm_snapshots.machines`: **0** rows with keys.
`--apply` would change nothing. Incident report said 1,324 snapshot rows → they are gone (snapshots rotate) or were
redacted earlier. No action; `principals.external_ref` (3 rows) remains deliberately unchanged per the incident report.

### FG-ALCHEMY
#357 (9a4c842, 2026-09-15) removed a hardcoded Alchemy key from 3 tracked files; the value is still in git history.
Code today reads `ALCHEMY_POLYGON_URL` / `ALCHEMY_POLYGON_KEY` / `ALCHEMY_API_KEY` (`rpc_gateway/providers.js:81-88`).
I did not extract the historical value to test it. You: Alchemy dashboard → Apps → delete/regenerate the key that
`git log -p -S alchemy.com/v2 -- apps/api/app_factory.mjs | head` shows; if the provider is still wanted, set the new key
as `ALCHEMY_POLYGON_KEY` on `Satelink-api`. Verify: `alchemy-polygon` appears healthy in `/rpc/stats`.

### FG-REV-RECOGNITION (decision; from the Task 4 audit)
Writes to `revenue_events_v2` did **not** stop in code. Last organic paid call 2026-08-20; the 2026-08-22 cliff is the
disk-full WS storm (#341, c1bdd00). Proof today: founder key 29 → `eth_blockNumber` → 200, charged $0.00003, **row
id 2734806** (`evidence/rev2-founder-call-2026-09-28.txt`). Two double-counts exist and are yours to decide:
1. **x402 bundle**: settlement books $0.10 (`x402/settlement.js:115`) AND each call spent from the `x402_<wallet>` key
   books $0.00003 again. 2. **Dodo-funded credits (legacy)**: payment booked (`internal_dodo.js:692`) AND TI usage booked.
Options: (a) book at payment, mark per-call rows from prepaid-alias balances `is_billable=false`; (b) book at usage,
mark the settlement/payment rows as deferred (`is_billable=false`). USDT deposits already follow (b). Recommend (b).
Also: admin revenue sums ignore `is_billable` (includes WS storm rows and negative reversals) — fix after the decision.

### Earlier gates (2026-09-27)

| Gate | Status | Blocking |
|---|---|---|
| FG-MIG-017-019 | **DONE 2026-09-27 13:39Z** — pre-approved shape (DROP CONSTRAINT re-added as superset); all conditions verified | — |
| FG-PR-438 | **DONE** — merged 07e7cb2 (founder-approved), deployed | — |
| FG-PR-439 | **DONE** — merged 35cb2b5 (founder-approved), deployed; column verified in prod | — |
| FG-PR-442 | **REVIEW** — RPC preflight on the 'new' capacity path (regression from #438: unfunded/unknown keys reached upstream) | recommended before FG-FLAG (d) |
| FG-FLAG-CONSOLE_ACCOUNTS_V1 | **FLIPPED 2026-09-27 22:16Z** (founder go). Railway ✅ `/v1/me/*` 404→401; Vercel prod `dpl_DFXLuWueftXjztdon4xobRu1Qa1U` @ 4ca6b44 ✅ (`me-migrate` 404 `accounts_disabled` → 403 `bad_origin`); smoke ✅; signed-in prod check pending founder session | D2–D14 |
| FG-RPC-REFUND | GATED | `refund_rpc_failed_charges.mjs --apply` (external $0; founder ≤ $0.00102) |
| FG-DODO-FENCE | GATED | `backfill_dodo_ringfence.mjs --apply` after #439 deploys (key 132 → $19.98) |
| FG-DODO-TESTDATA | GATED | reclassify payment_sources 349, 350 (founder TEST-mode Dodo) as `is_test_data=true` |
| FG-PRICE-LAUNCH | DECISION | Launch allowance: catalog 1,500/7,500 vs §1 300/1,500 |
| FG-PRICE-PACKS | DECISION | pack bonuses: catalog none vs §1 +5 % / +10 % |
| FG-INR | DECISION | `inr_price` values (all null) |
| FG-SUBS | GATED | SATELINK_SUBSCRIPTIONS_ENABLED |
| FG-PLANV2 | GATED | SATELINK_PLAN_BILLING_V2_ENABLED (code name) |
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
- (b) update 20:30 IST: D7 alerts merged (#441, 1bc4558) → with the flag on, `/alerts` has no V1 text
  (Simple + Advanced); accounts + simple-flows + alerts e2e 17/17 on that commit. `/trading-intelligence` still has
  its V1 note (not in the condition list; D10).
- (e) pre-flip baseline (`evidence/smoke-preflip-2026-09-27.txt`, founder keys only): RPC key 29 → 200, charged
  exactly $0.00003 (4.999280 → 4.999250) + revenue row `rpc_cc5eec8e…`; TI key 29 → 503 warming_up, **not charged**;
  unfunded founder key 134 → 402. TI cannot show a deduction: `intelligence_snapshots` has 0 rows and the refresh job
  logs `0/4 metrics updated` (upstream data sources failing from Railway) — founder to accept (e) without a TI debit.
- (d) DONE 22:16Z: Railway `CONSOLE_ACCOUNTS_V1=true` → restart SUCCESS (same commit 4ca6b44), health 200 (db ok),
  `/v1/me/alerts` + `/v1/me/keys` 404 → 401 `sign_in_required`. First-use schema created (all `account_*` incl.
  `account_alert_prefs`/`account_alert_events`), `idx_rev2_client_created` valid, no errors in logs. Then Vercel production
  env + new production deployment `dpl_DFXLuWueftXjztdon4xobRu1Qa1U` READY @ 4ca6b44.
- (e) post-flip smoke (`evidence/smoke-postflip-2026-09-28.txt`, founder keys): RPC key 29 → 200, charged exactly
  $0.00003 (4.999250 → 4.999220) through the accounts deduction path + revenue row `rpc_7125e271…`; TI → 503
  warming_up, not charged; unfunded founder key 134 → 402. TI debit not demonstrable (0 snapshots) — accepted by "flip".
- Remaining for PROD-VERIFIED of D2–D14: one signed-in Playwright pass on console.satelink.network (needs a founder
  session). Rollback (pre-written, unused):
  Railway: `railway variables --service Satelink-api --set CONSOLE_ACCOUNTS_V1=false` (restart; read at call time).
  Vercel: `vercel env rm CONSOLE_ACCOUNTS_V1 production --yes` then redeploy the current production deployment.

## Still-gated flags — exact commands (not executed)
Order (after FG-FLAG verified): FG-SUBS → FG-DODO-WEBHOOK → FG-PLANV2 → FG-USAGEV2 → FG-LEGACYSUB.
- `railway variables --service Satelink-api --set SATELINK_SUBSCRIPTIONS_ENABLED=true` → verify `POST /webhooks/dodo/v2` unsigned ≠ 404 (expect 401 `bad_signature`).
- Dodo dashboard (TEST) → Webhooks → add `https://api.satelink.network/webhooks/dodo/v2`; copy signing secret →
  `railway variables --service Satelink-api --set DODO_WEBHOOK_SECRET=<paste>` (handler falls back to another var if unset — set explicitly).
- `railway variables --service Satelink-api --set SATELINK_PLAN_BILLING_V2_ENABLED=true` → verify checkout returns a TEST checkout URL.
- `railway variables --service Satelink-api --set SATELINK_USAGE_LIMITS_V2_ENABLED=true` → verify a TI call writes a `pv2_usage_ledger` row.
- `railway variables --service Satelink-api --set DODO_LEGACY_SUB_BUCKET_ENABLED=true` → verify RPC with a plan-only key still 402s.
- Refund (after #438): `node apps/api/scripts/incidents/refund_rpc_failed_charges.mjs "<conn>" --apply` (founder keys only with `--include-founder`).
- Ring-fence (after #439 deploys): `node apps/api/scripts/incidents/backfill_dodo_ringfence.mjs "<conn>" --apply`.
- Redaction: `node apps/api/scripts/incidents/redact_exposed_keys.mjs --apply` (dry-run first) — after FG-KEYROT.
- Cloudflare: rotate token in dashboard → `railway variables --service Satelink-api --remove "cloudflare_Example Usage"` → verify absent via `railway variables --kv | cut -d= -f1`.

### FG-TI-LEGAL (new, 2026-09-28 — decide before selling Trading Intelligence)
`docs/legal/MARKET_DATA_TERMS.md` (for legal review — not legal advice): production TI refreshes from Binance, Bybit,
**OKX** and Hyperliquid. OKX's API Agreement §9.4 (verified, 28 July 2026) prohibits using Market Data — including
funding rate and open interest from **public endpoints** — to operate a "financial data aggregator … or analytics
platform", and lists **India** as a restricted location. Bybit's API terms prohibit repackaging/reselling Service Data.
Options: (a) counsel review before any paid TI sale (TI external revenue is $0 today); (b) restrict inputs to Hyperliquid
until licences exist (code change, prepared on request); (c) pursue an OKX data licence. Region move (FG-TI-REGION)
does **not** resolve this. Recommend (a)+(b).
