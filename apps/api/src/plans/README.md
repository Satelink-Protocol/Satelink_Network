# Plans & entitlements (Track B — P3.B)

Additive plan layer for `apps/api`. **It changes no existing money-path
behaviour** — nothing here modifies `credit_service.authorizeAndMeter`, the Dodo
webhook (`src/routes/internal_dodo.js`), `api_credits`, `revenue_events_v2`, or
`credit_balances`. All new tables are separate; all new endpoints are read-only.

## What ships
- **`plans_schema.mjs`** — idempotent DDL for `plans` (catalogue) and
  `plan_entitlements` (the monthly included-call "Dodo bucket"). Seeds Free/Pro/Max
  to match `apps/web/src/lib/plans.ts`. Ensured at boot in `server.js` (fail-safe).
- **`plans_service.mjs`** — `listPlans` / `getPlan`. Backs `GET /v1/plans`
  (`src/routes/plans.js`), the pricing-parity source for the web (§4.4).
- **`entitlement_service.mjs`** — the bucket primitives: `ensureFreeEntitlement`,
  `grantPlanAllowance`, `resetExpired` (monthly reset), `consumeEntitlement`
  (TI-only, consumed before credits), `getEntitlement`, `reconcileEntitlements`
  (reads the existing `subscriptions` table — never writes it), and the bonus-pack
  credit mapping `creditForPack` (§4.5).
- **`src/routes/console.js`** — `GET /v1/console/summary`, a read-only summary for
  the console Home, computed from existing tables (best-effort; degrades to null).

## Flags
- `PLANS_ENABLED` gates the plan model in production. Everything here is inert
  until it's on: the catalogue seeds and `GET /v1/plans` return data, but no
  entitlement is consumed and no billing changes.

## Confirmed design decision (founder, 2026-09-23)
Subscriptions grant the monthly included-call **entitlement bucket** (Trading
Intelligence only, resets monthly, consumed before credits) — **not** fungible
USD credits. `SUB_PLAN_MAP` implements the tier mapping now (`entitlement_service.mjs`);
`reconcileEntitlements` already reads the existing `subscriptions` table and grants
buckets accordingly, additively, without touching that table or `api_credits`.

This is the *target* model, confirmed. It does **not** change what
`internal_dodo.js` does *today* — that webhook still credits fungible USD on a
subscription payment, unmodified, per the money-path guardrail (CLAUDE.md).
Migrating the webhook itself to stop granting fungible credits and grant the
entitlement bucket instead is real money-path surgery and stays a **separate,
later, founder-approved PR** — not bundled here.

## Deliberately NOT done (founder-gated, money-path)
1. **Wiring `consumeEntitlement` into the live billing path.** "Consumed before
   credits" needs a single call inside the serving/billing path — that touches the
   money path, forbidden without explicit founder sign-off (CLAUDE.md). The
   primitive is built and tested; the integration is a separate, flagged change.
2. **Changing `internal_dodo.js`'s subscription→credit behaviour** to grant the
   entitlement bucket instead of fungible credits (see confirmed design above).
   Editing that webhook is forbidden in this additive pass; a separate PR will
   make the switch once the entitlement-consumption path (#1) is live and tested.
3. **Creating Dodo subscription products / running the reset+reconcile cron.** The
   jobs are exported but not auto-scheduled (auto-starting a writer against the prod
   DB from this change is out of scope); wire them into the scheduler on go.

## Tests (DB-free, mock-pool)
`test/plans_backend.test.js` and `test/plans_console_routes.test.js` — 17 tests,
run in the standard `mocha --no-config --exit 'test/**/*.test.js'` suite. Baseline
unchanged: 290 passing / 22 failing (pre-existing) / 3 pending.
