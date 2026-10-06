# Satelink Network Status

This file tracks the operational status of the Satelink Network API, interfaces, and smart contracts.

## 🚀 Live Services
- **Backend API (RPC + Admin)**: [api.satelink.network](https://api.satelink.network) / [rpc.satelink.network](https://rpc.satelink.network) (Railway)
- **Frontend App**: [satelink.network](https://satelink.network) (Vercel)
- **Database**: PostgreSQL (Railway) & Redis

## 🔗 Polygon Mainnet (Chain ID 137)
- **Revenue Vault V2**: `0x577D3716d6Ad5b676d230f5409deF9838FABaCEF`
- **USDT Contract**: `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`

## 💳 Payment Rails
- **x402 (Base `eip155:8453`)**: Active. CDP facilitator handles settlements.
- **Credit Deposits**: Active via Revenue Vault V2.

## 🛠 Active Systems
- `freeTierGate`: Active rate-limiting on anonymous RPC traffic.
- `EpochScheduler`: Aggregates usage for on-chain settlement.
- **Settlement Anchor**: Currently running in `SETTLEMENT_DRY_RUN=1` (dry run mode). **Do not disable without founder confirmation.**

## 🚦 Launch Checklist (single source of truth)
Tagged ENGINEERING (Claude Code / eng can execute) or FOUNDER-GATED (requires a founder decision, credential, or external action).

> **Launch policy — payments:** Launch with **one-time credit packs only**. **Dodo subscriptions are DISABLED** (flag `NEXT_PUBLIC_DODO_SUBSCRIPTIONS_ENABLED`, default OFF; PR #386) **until renewal refund matching exists** — a subscription-renewal refund is keyed by a synthetic sub-id and cannot yet be linked back to the funding `payment_id`, so a renewal refund/dispute would resolve as unmatched (no clawback).

| Item | Owner |
|---|---|
| M5 human gate: Dodo test payment E2E (real sandbox checkout → webhook → entitlement) — **NOT RUN** (needs a live Dodo sandbox checkout; code paths ready) | ENGINEERING |
| M2 machine gate: real x402 payment → credits → paid intelligence call, end to end | ENGINEERING |
| Refund/dispute handling: Dodo refund/dispute webhooks claw back / freeze granted credits — **IMPLEMENTED** (PR #386: `POST /internal/dodo/reversal`, idempotent, reversal rows, migrations 033+035; clawback shortfall → `payment_hold` (402); `dispute.expired` kept frozen + alerted). Not yet exercised against a live Dodo sandbox — see M5 gate above | ENGINEERING |
| **Dodo credit-path prod schema**: `payment_sources.source` CHECK must allow `'dodo'` (migration 031/035) and the Dodo columns must exist. **CONFIRMED LIVE 2026-09-18** — see "Dodo M5 — status" section below for the actual read-only query results (the CHECK allows `'dodo'`, `frozen_usdt`/`payment_hold`/`dodo_refund_dispute_log` all exist). | FOUNDER-GATED |
| **`DODO_CREDIT_PACK_PRODUCT_IDS` not set on Railway/Vercel** — the 2026-09-18 money-leak fix (see below) fails CLOSED without it: merging/deploying it before this is set silently stops ALL Dodo one-time credit grants. | FOUNDER-GATED |
| Key rotation (JWT_SECRET, ADMIN_SECRET_TOKEN, DODO_* secrets, signer key) | FOUNDER-GATED |
| GitHub Pro + branch protection on `main` with 0 required reviewers (so solo merges stay unblocked but checks stay required) | FOUNDER-GATED |
| `satelink_app` least-privilege DB role: create in prod and repoint `DATABASE_URL` to it (see `audit/CONSOLIDATION_REPORT_2026-09-16.md` P1) | FOUNDER-GATED |
| Settlement rail decision + EIP-3009 ADR (broadcast path off `SETTLEMENT_DRY_RUN=1`) | FOUNDER-GATED |
| MCP live E2E (intelligence tools against real payment-gated calls) | ENGINEERING |
| Path-aware x402 (per-resource pricing instead of wildcard `/rpc/:var1`) | ENGINEERING |
| Node-operator dashboard (post-launch) | ENGINEERING |

---

## 🚀 Dodo M5 — status (PR #386 MERGED & LIVE, verified 2026-09-18)

**⚠️ GOVERNANCE NOTE**: PR #386 was merged to `main` (merge commit
`8d468c6e2bf8570c5fe9ef35b5bcda48937337f1`, merged by `Satelink-Protocol` at
2026-09-17T11:47:44Z) and is now the LIVE deployment on both Railway
(`Satelink-api`, deployed 2026-09-17T15:19:54Z) and Vercel (`web`, deployment
`dpl_AdRtACDfT9dKUaUusVNJ1nzbZG8j`) — **despite this session's explicit
instruction not to merge it.** This was already merged before this session's
first action; neither this session nor "Antigravity" (which separately set the
Dodo env vars and ran `vercel redeploy` today) performed the merge itself.
**Founder: please confirm who/what merged #386 and whether that was intended**
— local `main` was 12 commits behind `origin/main` at session start, which is
how this went unnoticed until checked here.

The Dodo-rail schema (migrations 031/033/035, applied by `ensureDodoRailSchema`
at boot) is confirmed live in prod:

**Read-only prod SQL, run 2026-09-18 via the sanctioned `scripts/ops/sat-db.ts`
runner** (same tool `scripts/ops/m2-gate.sh` uses; SELECT-only, nothing written):

- **Query 1 (CHECK)**: `payment_sources_source_check` =
  `CHECK ((source = ANY (ARRAY['polygon_usdt_vault','x402','dodo','marketplace','other']))) NOT VALID`
  — allows `'dodo'`. Still `NOT VALID` (existing rows never re-validated against
  it) — run `apps/api/migrations/035_dodo_source_check.sql`'s `VALIDATE
  CONSTRAINT` step manually when convenient; harmless to defer, only affects
  historical-row validation, not new inserts.
- **Query 2 (sources)**: `x402` = 7 rows, no other sources. `dodo` = 0 rows —
  expected, since no real Dodo payment has happened yet; this does **not** mean
  the schema is missing (see Query 3).
- **Query 3 (frozen_usdt/payment_hold)**: `SELECT count(*) FROM api_credits
  WHERE frozen_usdt <> 0 OR payment_hold = true` → 0 rows. **Correction to the
  original assumption that "0 rows → schema NOT in prod"**: the query executed
  successfully against both columns (it would error if they didn't exist), and
  `dodo_refund_dispute_log` independently confirmed present via
  `to_regclass('dodo_refund_dispute_log')`. 0 matching rows just means no
  account has been frozen/held yet — **the #386 schema IS in prod.**
- **`payment_sources` columns**: `id bigint, source text, amount_usd numeric,
  token text, network text, tx_hash text, payer text, credited_api_key text,
  is_test_data boolean, created_at timestamptz`.

**Post-deploy smoke** (ran 2026-09-18): `POST
https://api.satelink.network/internal/dodo/reversal` with no secret → **401**
`{"ok":false,"error":"invalid_dodo_internal_secret"}`, not 404 — confirms the
route (and therefore #386) is live.

**Rollback** (if the founder decides the merge needs undoing): redeploy the
previous Git deployment from the Railway dashboard for `Satelink-api`, and the
prior deployment for `web` on Vercel. Safe because every schema change in #386
is additive (ADD COLUMN IF NOT EXISTS, a widened CHECK, a new table) — the
older image simply ignores the extra column/table/values.

### External config verification (Task 1)

- Vercel prod (`web`) Dodo env var **names**: `DODO_PAYMENTS_WEBHOOK_KEY`,
  `DODO_INTERNAL_SECRET` (both added ~4h before this check — consistent with
  "Antigravity set Dodo env vars today").
- Railway `Satelink-api` Dodo env var **names**: `DODO_INTERNAL_SECRET` only.
  Not set there (by design — consumed only in `apps/web`/Vercel):
  `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PRODUCT_PRO_ID`, `DODO_PRODUCT_STARTER_ID`,
  `DODO_SUBSCRIPTIONS_ENABLED`, `DODO_CHECKOUT_LINK`, `DODO_CHECKOUT_PRO_URL`,
  `DODO_CHECKOUT_STARTER_URL`, `DODO_INR_USD_RATE_APPROX`.

---

## 🔒 Dodo credit-path money-leak fix (2026-09-18, follow-up to #386)

apps/web's `dodo-webhook` route (`apps/web/src/app/api/dodo-webhook/route.ts:235-269`)
already discriminates task-commerce vs. `/intelligence` subscription payments by
`metadata.order_ref` — but that file's own comment flags this as an unconfirmed,
soft signal ("static-link metadata pass-through may not be reaching webhooks as
documented"). There was no hard, server-side gate at apps/api stopping a stray
payment (e.g. a `/tasks` lead-gen purchase whose `order_ref` metadata got lost
in transit) from being credited as `api_credits`:
`planFromProductId()` (`apps/api/src/routes/internal_dodo.js:87-90`) defaults
any unrecognized product id to the `starter` tier rather than refusing to
credit, and the credited amount is computed straight from the payment's own
amount (`toUsdApprox`, `internal_dodo.js:367`, fed by `settlement_amount ??
total_amount` in `dodo-webhook/route.ts:287-288`) — not a fixed per-product map.

**Fix shipped on this branch** (pushed, held for founder review — not merged):
- `apps/api/src/routes/internal_dodo.js`: new `DODO_CREDIT_PACK_PRODUCT_IDS`
  (comma-separated) allowlist, checked before crediting any `payment.succeeded`
  event. Fails **CLOSED** — unset or empty allowlist credits nothing. A
  rejected product logs and returns 200 (`entitled:false,
  reason:'product_not_allowlisted'`) so Dodo doesn't retry forever.
  `subscription.renewed` is unaffected (already gated separately by
  `DODO_PRODUCT_PRO_ID`/`DODO_PRODUCT_STARTER_ID`).
- `apps/web/src/app/api/dodo-webhook/route.ts`: now forwards the SDK-verified
  `product_cart[0].product_id` (authoritative, from `@dodopayments/core`'s
  `PaymentSchema`) ahead of the old `metadata.plan_product_id` (soft signal) as
  `planProductId`.
- Tests added to `apps/api/test/internal_dodo.test.js`: allowlisted product
  credits; a non-allowlisted (tasks-shaped) product doesn't; no product id
  doesn't; unset allowlist fails closed; empty-string allowlist fails closed.
  Full `apps/api` suite: 259 passing / 22 failing (all pre-existing,
  DB-dependent — zero new failures; Dodo-specific tests 23/23 passing).

**⚠️ FOUNDER ACTION REQUIRED before merging this**: `DODO_CREDIT_PACK_PRODUCT_IDS`
is not currently set on Railway or Vercel. Because the gate fails closed,
merging without setting it will silently stop **all** Dodo `/intelligence`
one-time credit grants (subscription renewals are unaffected). Set it to
whichever Dodo product id(s) should grant credits.

**Product founder should create for M5** (one-time, USD): a single
"Intelligence credit pack" product, **one-time** (not subscription), suggested
test price **$5.00 USD** (large enough to be visibly distinct from the $0.10
x402-scale test rows in the ledger). Expected credit granted = the paid amount
1:1, no bundle discount (same as every other deposit path —
`internal_dodo.js:392` comment). Its Dodo product id goes into
`DODO_CREDIT_PACK_PRODUCT_IDS`, and into `DODO_PRODUCT_STARTER_ID` /
`DODO_PRODUCT_PRO_ID` too if it should also select a specific tier/daily-limit.

---

## 🔍 x402 `payment_sources` — 7-row explainer (read-only, run 2026-09-18)

Query (safe to re-run any time — SELECT only, no writes):

```sql
SELECT
  created_at,
  amount_usd AS amount,
  network || '/' || token AS network_asset,
  left(tx_hash, 10)  AS tx_hash_prefix,
  left(payer, 10)    AS payer_prefix,
  is_test_data,
  lower(payer) IN (
    '0x5cbda3a1c0f1b28fecea1d919785321e88f9fa97',
    '0x966e1ae22996545015b1414b35234b10719d7ad4',
    '0x175727a8486a7eb3ac4bcf2a1a89fd2d58ca0dfd',
    '0x55691946766f4666c786ea8ee2bea176ecc3a841'
  ) AS payer_is_founder_wallet
FROM payment_sources
WHERE source = 'x402'
ORDER BY created_at ASC;
```

| created_at (UTC) | amount | is_test_data | founder wallet? | classification |
|---|---|---|---|---|
| 2026-07-09 02:12 | $0.001 | true | yes | **TEST** |
| 2026-07-09 23:27 | $0.001 | true | yes | **TEST** |
| 2026-07-09 23:57 | $0.001 | true | yes | **TEST** |
| 2026-07-10 22:56 | $0.10 | true | yes | **TEST** |
| 2026-07-10 23:16 | $0.10 | true | yes | **TEST** |
| 2026-07-26 19:58 (tx `0x485035ad…`) | $0.10 | false | no | **POSSIBLY REAL** |
| 2026-08-01 21:28 (tx `0x7bc61296…`) | $0.10 | false | no | **POSSIBLY REAL** |

5 of 7 rows pay from a wallet in `FOUNDER_WALLETS`
(`apps/api/src/payments/founder_wallets.js`) and are already correctly flagged
`is_test_data=true` — definitively test traffic.

The remaining 2 (`0x485035ad…`, `0x7bc61296…`) are both documented elsewhere in
this repo: `scripts/ops/OPS_LOG.md:20` labels `0x7bc61296…` a "Real x402 txn",
and `audit/PROGRESS.md`'s GATE M2 section describes it as the one payment made
**from an external wallet the founder funded specifically to validate the
pipeline** (2026-08-01) — real on-chain funds movement, correctly not
founder-wallet-flagged, but deliberately founder-initiated for pipeline
validation rather than confirmed organic customer discovery.
`docs/incidents/2026-08-27-parity-gap-diagnosis.md` independently corroborates
both rows as `is_test_data=false`, calling them "2 real revenue events" while
diagnosing an unrelated shadow-ledger parity gap — it doesn't characterize
either as organic customer revenue either.

**Classification: POSSIBLY REAL** for both — real fund movement, not
founder-wallet-flagged, but the surrounding docs' own language points to
deliberate validation rather than confirmed organic revenue. **M2 status is
NOT changed here**, per instruction — that's the founder's call after
reviewing this.
