# Stage 27 — Subscriptions billing (Razorpay, test mode)

**Branch:** `trading-agent/stage-27-billing` (PR #482), stacked on Stage 26 (#481).

**State:** built and tested behind **`SUBSCRIPTIONS`**. The flag is off; with it off every route returns 404. Nothing is registered in `app_factory.mjs` (founder Option A).

**Code:**
- `apps/api/src/trading_agent/billing/` (module table in its `README.md`);
- migration `database/migrations/030_billing_subscriptions.sql` and its down file.

**Tests:**
- `apps/api/test/trading_billing.test.js`;
- the opt-in `apps/api/test/trading_billing_sandbox.test.js`;
- `database/__tests__/trading-billing.integration.test.ts`;
- three dependent integration tests updated so rollbacks run in order.

## Inspection and STOP evaluation

> STOP if: live keys requested; GST invoice format needs professional input (mark RPrC).

- **Live keys: not requested, and refused in code.** `RazorpayGateway` throws `FORBIDDEN` for any `rzp_live_…` key id and accepts only `rzp_test_…`.
  - The key-id prefix convention is the documented dashboard format. The API authentication page I checked describes test vs live mode, but not the prefixes.
  - A **draft** catalog (`assertCatalogUsable`) can never start a live subscription.
  - No Razorpay keys exist in this environment (names checked only).
- **GST: marked RPrC, not invented.** Invoices carry GST **metadata fields** only: supplier GSTIN, customer GSTIN, place of supply, SAC code, tax breakdown and a review status.
  - No tax is computed.
  - `sac_code` and `tax_breakdown` stay null.
  - `gst_review_status = 'rprc_pending'`, with the note: *"RPrC — GST invoice format, numbering, SAC code and tax treatment require professional review before any invoice is issued to a customer."*

### Audit 04: existing billing

- **Dodo:** the card/UPI rail runs through Pricing V2 (`apps/api/src/pricing_v2/*`, `POST /webhooks/dodo/v2`). It is HMAC-verified, idempotent and transactional, and audit 04 classifies it **REUSE**.
- **Plan catalogues differ:** Pricing V2 sells Trading Intelligence usage units, not Trading Agent plans.
- **Decision:** a `PaymentGateway` abstraction in which **Razorpay** is the new implementation and **Dodo** is registered as the existing external path, **not wrapped or changed**. Legacy customers keep today's behaviour.
- There is no `/billing` or `/webhooks/razorpay` route today (audit 02 inventory), so no prefix collision.

### Audit 07: DB mapping

| Audit 07 says | Done here | Why |
|---|---|---|
| invoices: **NEW** (`invoices`, `invoice_lines` → `ledger_txns.txn_id`) | **as proposed**: `invoices` + `invoice_lines`; `invoice_lines.ledger_txn_id REFERENCES ledger_txns(txn_id)`, nullable and stays NULL (no real-book posting yet) | |
| subscriptions: **MAP** `pv2_subscriptions` | **deviation**: new gateway-neutral `billing_subscriptions` (+ `billing_payments`, `billing_webhook_events`) | `pv2_subscriptions` is keyed by `dodo_subscription_id`, and `pv2_entitlements` drives live Trading Intelligence metering. Reusing them would alter a live Dodo table and change existing billing for legacy customers, which the brief forbids. Audit 07 itself says the stores are "consolidated into pv2 later". **Founder review** before any consolidation |

### Dependency on Stage 20

**Stage 20 is STOPPED** (U2 = PARTIAL; new `ledger_txns.kind` values unapproved).
- The brief's acceptance needs only the **simulated** book for test mode, which this stage does.
- The live-mode **real-book** posting path is `RealBookPosting`, which **refuses** with `LEDGER_NOT_APPROVED`. The whole webhook transaction rolls back (nothing recorded), so Razorpay's retry can apply it after approval.
- Nothing in the module imports ledger, credit or revenue code (static test).
- The real ledger has zero entries after the Postgres lifecycle test.

## Razorpay facts used (verified 2026-10-06, Razorpay docs)

- **Subscriptions API:**
  - `POST /v1/plans`; `POST /v1/subscriptions` (`plan_id`, `total_count`, `quantity`, `customer_notify`, `notes`);
  - `PATCH /v1/subscriptions/:id` (`plan_id`, `schedule_change_at` = `now` | `cycle_end`);
  - `POST /v1/subscriptions/:id/cancel`;
  - Basic auth `key_id:key_secret`.
- **States:**
  - `created`, `authenticated`, `active`;
  - `pending` (auto-charge failed, retrying), `halted` (all retries failed);
  - `paused`, `cancelled`, `completed`, `expired`.
- **Webhooks:**
  - `X-Razorpay-Signature` = HMAC-SHA256 over the **raw** body with the webhook secret ("do not parse or cast the body");
  - `x-razorpay-event-id` is unique per event (duplicate detection);
  - events `subscription.{authenticated, activated, charged, completed, updated, pending, halted, cancelled, paused, resumed}`;
  - `subscription.charged` carries the subscription and payment entities (`amount` in paise, `status`, `invoice_id`).
- **Proration** (immediate change):
  - daily rate = plan amount × quantity ÷ cycle days;
  - an upgrade invoices the difference and a downgrade issues a credit note;
  - a difference under 50 subunits is refused;
  - `cycle_end` changes have no proration;
  - only active subscriptions can change.

## Design

- **Plans and entitlements from config:**
  - The catalog `ta-2026-10-draft` (Free / Pro / Team) has entitlements for paper trading, max strategies, broker accounts and agent suggestions per day, with **live trading false everywhere**.
  - Its amounts are **test-mode fixtures**, not public prices: pricing is a founder decision, and the Stage 26 pricing page says no price exists.
  - A draft catalog can't be used in live mode.
- **Lifecycle** (Razorpay → Satelink): created → `pending_authentication`, authenticated → `authenticated`, active → `active`, pending → **`past_due` + grace**, halted → `suspended`, paused → `paused`, cancelled / completed / expired → `ended`. Entitlements are the paid plan while `active` or `past_due` (grace), and Free otherwise.
- **Webhooks are the source of truth:**
  - API calls only ask Razorpay to act; status, plan and period change when the verified webhook arrives. The plan switches on `subscription.updated`, not when the API call returns.
  - The subscription row is written before the gateway call, and Razorpay `notes` carry our id, so an early webhook still finds it.
- **Idempotency:**
  - `x-razorpay-event-id` is recorded **in the same transaction** as everything the event causes; a replay or concurrent duplicate is a no-op.
  - Payments are unique per gateway payment id, so a payment re-sent under a new event id is counted once.
  - Invoices are unique per payment and kind.
  - Stale events (older `created_at`) never move state backwards, but a payment they carry is still recorded once.
- **Dunning and grace:**
  - `pending` → `past_due` with `grace_until` = failure + 7 days. A second failure doesn't extend it.
  - Reminders go out on days 0, 3 and 6, once each (notifier port).
  - After the grace period the subscription is `suspended` (back to Free). `halted` suspends at once.
  - A successful `charged` / `activated` restores `active` and clears grace.
- **Invoices:** one per captured INR payment (append-only; corrections would be credit notes). The total is the captured amount, with one line and GST metadata (RPrC).
- **Simulated book:** test-mode payments become balanced pairs, debit `sim:gateway:razorpay:clearing` and credit `sim:platform:subscription_revenue`. They are idempotent by payment id and marked `simulated`.
- **HTTP:**
  - `/billing/plans`, `/billing/subscription`, `POST /billing/subscriptions`, `/billing/subscription/{preview-change, change-plan, cancel}`, `/billing/invoices`.
  - These reuse the Stage 24 middleware: auth with tenant checks, CSRF, human-only mutations, rate limits, Idempotency-Key.
  - `POST /webhooks/razorpay` uses the raw body: 401 on a bad signature; 200 on applied, duplicate or ignored; 503 on `LEDGER_NOT_APPROVED`, so Razorpay retries.
- **Database (migration 030):**
  - **Tables:** `billing_subscriptions`, `billing_webhook_events`, `billing_payments`, `invoices`, `invoice_lines`.
  - **Constraints:** one open subscription per principal and mode; `past_due` ⇔ a grace end; gateway in an allow-list.
  - **Append-only:** `billing_webhook_events`, `billing_payments`, `invoices` and `invoice_lines`, via 029's `trading_append_only_guard()` (UPDATE / DELETE / TRUNCATE refused for every role).
  - **Grants:** `satelink_app` gets INSERT and SELECT only on those four tables.

## Test evidence (2026-10-06)

| Suite | Result |
|---|---|
| `apps/api/test/trading_billing.test.js` | **26 passing**: keys (live refused), signatures (raw body, tamper, wrong secret, re-serialised body), the acceptance lifecycle with a balanced sim posting, early webhook via notes, one open subscription, replay, **5 concurrent duplicates → 1**, same payment under a new event id, out-of-order, unknown subscription, **failed payment → grace → reminders 0/3/6 → suspended**, halted → recovery, cancel via webhook, **proration** (charge / credit / quantity / half-even / cycle_end / < 50 subunits / outside cycle), plan change applied only on webhook, live mode (draft catalog refused; live payment refused with nothing recorded), invoice rules, HTTP (flag off → 404, Idempotency-Key replay → one gateway subscription, agents refused, webhook 401/200/duplicate), static (no env, no ledger / existing-billing imports, no floats) |
| `database/__tests__/trading-billing.integration.test.ts` (local Postgres 16, guard-DB recipe) | **5 passing**: lifecycle in Postgres (invoice + line + GST metadata pending review; real `ledger_entries` = 0), **6 concurrent duplicate deliveries → 1 payment, 1 invoice**, append-only + constraints, past_due/grace round trip, down migration (029 and the ledger remain) |
| All trading integration suites (11 files) | **43 passing**; the 021 round trip now rolls back 030 first; the 029 test rolls back 030 before 029; no leftover databases |
| `database/__tests__/migrations.integration.test.ts` | **not run locally** (needs Docker / testcontainers); only its expected-file list gained `030_billing_subscriptions.sql`; CI runs it |
| Mutation checks (16) | all caught: live key accepted, signature unchecked, loose compare, no event idempotency, no payment idempotency, state going backwards, grace extended on repeat failure, no grace, dunning never suspends, duplicate reminders, live posting to the sim book, draft catalog usable live, float proration (survived at first, so a half-even case was added), min-difference rule dropped, plan switched before the webhook, invoice for a failed payment |
| All `trading_*` mocha suites | **387 passing, 4 pending** (opt-in live tests) |
| `scripts/ci-baseline-check.sh` | **896 tests / 772 pass / 2 known failures / 122 pending**, no new failures, on 2 consecutive runs |

### Running the Razorpay test-mode check (founder, local shell only, never committed)

```sh
cd apps/api
export RAZORPAY_TEST_KEY_ID=rzp_test_…  RAZORPAY_TEST_KEY_SECRET=…
npx mocha --no-config --exit test/trading_billing_sandbox.test.js
```

It creates one test plan and subscription, prints the authentication link, and cancels it. The full charge cycle in test mode also needs a webhook endpoint (registration, a Stage 24-style founder decision) and a person completing Razorpay's test checkout.

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| Stage 20 (revenue / U2) | dependency **not met**, worked around | sim book only; real-book posting refuses; `invoice_lines.ledger_txn_id` stays NULL |
| B-03 / B-06 / B-10 | yes (new routes) | not registered (Option A); migration 030 only on local ephemeral databases |
| B-07 (roles) | yes | append-only via triggers (the 029 pattern); `satelink_app` gets INSERT/SELECT only on the immutable tables; the superuser can still disable triggers (same residual risk as 029) |
| B-08 (KMS) | yes | gateway secrets via injected loaders; nothing stored |
| B-09 (scope / legal) | yes, **not resolved** | GST format RPrC; prices are test fixtures; the pricing decision is the founder's |

No blocker changes status. The Stage 27 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Follow-ups (not in this stage)

- **Professional (RPrC):** GST invoice format, numbering series, SAC code, CGST/SGST/IGST treatment, place-of-supply rules, credit notes.
- **Founder:** Trading Agent pricing (replace the draft catalog with a published one); a Razorpay merchant account (test keys for the sandbox run); webhook registration (with the Stage 24 registration decision).
- **Stage 20:** approve the ledger kinds and U2 prerequisites, then implement `RealBookPosting` in the same transaction and link `invoice_lines.ledger_txn_id`.
- **Refunds / disputes** (credit notes) and `payment.failed` details (failure reasons in dunning emails).
- **Consolidation with Pricing V2** (audit 07 MAP), founder-reviewed.

## Rollback

Flag off (`SUBSCRIPTIONS`): every route returns 404. On a local database, apply `030_billing_subscriptions.down.sql` before 029's down. Or revert the commit; nothing existing changed.
