# Pricing V2 on Dodo — build (test mode) · 2026-09-25

Branch `feat/pricing-v2-dodo`, stacked on `feat/console-accounts-v1` (#425) because entitlements
are per **account**. **Money path → founder review. Every flag defaults OFF; live mode is not
touched.**

## What exists now
| Piece | Where |
|---|---|
| **PlanCatalog** (versioned config, never hard-coded): Free · Launch ($5 first month → $19, = Pro allowance) · Pro $19 · Max $79 · packs $10 / $50 / $200; UU allowances (session 5 h rolling + weekly in the account's timezone), key/machine limits, Dodo product ids per mode, INR placeholders | `apps/api/config/plan_catalog.v2.json`, `src/pricing_v2/catalog.mjs` |
| Public catalog for console Billing + `/pricing` (parity source) | `GET /v2/plans` |
| **Dodo test-mode products**, created by API and read back | `scripts/dodo/sync_catalog_products.mjs` (dry-run default; refuses live) |
| **Worst-case economics gate** (real Dodo fees; negative ⇒ not purchasable, checkout refuses) | `src/pricing_v2/economics.mjs`, `docs/pricing-economics.md` (generated; drift-tested) |
| **UU metering** in the live path for Trading Intelligence: plan UU → pack UU → crypto credits (auto-use) → hard stop with wait / enable-credits / upgrade; per-account advisory lock; native meter + UU + pricing version per event; 70/85/95/100 % notices | `src/pricing_v2/metering.mjs` via `console_accounts/limits.mjs` |
| **Webhooks** (Standard Webhooks HMAC, 5-min window; idempotent on webhook-id + Dodo ids): payment.succeeded/failed, subscription.active/renewed/on_hold/failed/cancelled/expired/plan_changed, refund.*, dispute.* → entitlement grant/hold/revoke, pack grant/reversal, `revenue_events_v2` (+/−), `payment_sources`, Financial OS shadow ledger write/reverse | `src/pricing_v2/webhooks.mjs`, `POST /webhooks/dodo/v2` |
| **Checkout** (V2 metadata: `satelink_checkout=v2`, `satelink_user_id`, `satelink_product_id`, `satelink_plan_version`) | `src/pricing_v2/checkout.mjs`, `POST /v1/me/checkout` |
| Current plan / windows / pack balance for the console | `GET /v1/me/plan` |
| **Daily reconciliation**: Dodo payments API vs `pv2_payments` vs revenue rows vs entitlements/grants → `pv2_reconciliation_runs` | `src/pricing_v2/reconcile.mjs` |
| Schema (additive; `api_credits` / `plans` / `plan_entitlements` untouched) | `migrations/040_pricing_v2.sql`, ensured at first use |

### Dodo test-mode products (created 2026-09-25, verified by read-back)
| Catalog id | Dodo product | Verified |
|---|---|---|
| launch | `pdt_0NoMERVal8bc4as1QxBFh` | $19.00/month recurring, `trial_period_days` 30, `trial_amount` 500 |
| pro | `pdt_0NoLWYJyptwAdEZCsc3ui` | existing (founder-created) — matched, metadata stamped |
| max | `pdt_0NoMERbmVHn5d2jlpAAZX` | $79.00/month |
| pack_10 / pack_50 / pack_200 | `pdt_0NoMEReibUHWGhnHdJBfK` / `pdt_0NoMERgL454CfiHbnYgdh` / `pdt_0NoMERhtlswnoRgwYjJ1f` | one-time $10 / $50 / $200 |
All carry `metadata.satelink_product_id` + `satelink_plan_version = 2026-09-25.1`.

## Flags (all OFF by default)
| Flag | Effect |
|---|---|
| `SATELINK_USAGE_LIMITS_V2_ENABLED` | UU metering for Trading Intelligence on account-linked keys (requires `CONSOLE_ACCOUNTS_V1`) |
| `SATELINK_SUBSCRIPTIONS_ENABLED` | mounts `/webhooks/dodo/v2`, starts the daily reconciliation |
| `SATELINK_PLAN_BILLING_V2_ENABLED` | enables `POST /v1/me/checkout` |
| `DODO_MODE` | `test` (default) · `live` only by founder decision |
Env names read: `DODO_API_KEY_TEST ?? DODO_TESTMODE_API_KEY`, `DODO_API_KEY_LIVE`, `DODO_WEBHOOK_SECRET ?? DODO_WEBHOOK_SECRET_KEY`.

## Verification
- `test/pricing_v2_lifecycle.test.js` — **13/13**, real Postgres, events signed exactly as Dodo signs them, shipped handler: bad/stale signature 401 · legacy events ignored · **Launch intro → renewal to Pro → failed renewal (on hold) → recovery → refund → dispute opened/lost → cancellation → duplicate webhook (same id, and Dodo retry under a new id)** · pack purchase pays Trading Intelligence and never RPC · checkout metadata/guards · reconciliation mismatch kinds.
- `test/pricing_v2_metering.test.js` — **8/8**: plan → credits, hard stop + actions, pack before credits, **session cap exact under 30 concurrent requests**, weekly window, on-hold → Free, RPC boundary, notices once per window.
- `test/pricing_v2_catalog.test.js` — **5/5**: validation, economics gate flips a plan off, Launch = Pro + intro, generated doc has no drift.
- Real Dodo **test mode**: products created and read back; a Launch checkout session created (`test.checkout.dodopayments.com`); payments list read for reconciliation.
- Full API suite: 326 pass / 19 fail — the 19 are the pre-existing failures on `main` (0 new).

**Not done, on purpose:** completing a real test-mode payment. Dodo would deliver its webhook to the
endpoint configured today (satelink.network → legacy `/internal/dodo`), which writes to the production
DB. Register the V2 endpoint first (founder action 2).

## Founder actions (in order)
1. Review + merge #425 (accounts), then this PR.
2. Dodo **test** dashboard → Webhooks → add endpoint `https://api.satelink.network/webhooks/dodo/v2`; put its signing secret in Railway `DODO_WEBHOOK_SECRET` (the current `DODO_WEBHOOK_SECRET_KEY` belongs to the web endpoint).
3. Railway: `CONSOLE_ACCOUNTS_V1=true`, then `SATELINK_SUBSCRIPTIONS_ENABLED=true`, `SATELINK_PLAN_BILLING_V2_ENABLED=true`, `SATELINK_USAGE_LIMITS_V2_ENABLED=true` (test mode).
4. Buy Launch + a pack with a Dodo test card from the console; check `pv2_reconciliation_runs` the next day.
5. Set INR prices (round rupees) in the catalog; decide on Launch dispute mitigations (§59).
6. Live: after Dodo business verification — create live products (`sync_catalog_products.mjs` refuses live today by design), set `DODO_MODE=live`, `DODO_API_KEY_LIVE`.

## Known issues found (not changed here)
- **Legacy webhook grants fungible USD credits for subscription payments** (violates the payments boundary; `internal_dodo.js`). V2 checkouts never reach it; retire it once V2 is live.
- Legacy subscription events read `metadata.api_key` but checkout sets `satelink_account_id` — legacy subscriptions cannot be matched to accounts.
- `shadowReverseRevenueLedger` inserts `ledger_txns.kind='refund'`, which `database/migrations/009_ledger_txn_header.sql` does not allow (`draw, settlement, deposit, adjustment, reversal`) — refund ledger writes (legacy **and** V2) likely fail silently. Fix = allow `'refund'` or use `'reversal'` (Financial OS decision).
- Trading Intelligence charges before reading the metric and does not refund a `warming_up` / `read_failed` 503.
- Three pack catalogs remain on the legacy path (web `CREDIT_PACKS`, `NEXT_PUBLIC_DODO_CREDIT_PACKS`, API `DODO_CREDIT_PACK_USD_VALUES`); V2 reads only the PlanCatalog.
