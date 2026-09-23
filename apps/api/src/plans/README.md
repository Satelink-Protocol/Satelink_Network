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

## Deliberately NOT done (founder-gated, money-path)
1. **Wiring `consumeEntitlement` into the live billing path.** "Consumed before
   credits" needs a single call inside the serving/billing path — that touches the
   money path, forbidden without explicit founder sign-off (CLAUDE.md). The
   primitive is built and tested; the integration is a separate, flagged change.
2. **Changing the existing subscription→credit behaviour.** Today `internal_dodo.js`
   credits *fungible USD* on a subscription payment. The brief's plan model grants
   an *included-call allowance* instead. These are different economics; migrating
   requires editing the existing webhook (forbidden here). `reconcileEntitlements`
   bridges by reading `subscriptions` and granting buckets, but the founder must
   confirm the `SUB_PLAN_MAP` (starter/pro → catalogue ids) and whether the webhook
   should stop granting fungible credits.
3. **Creating Dodo subscription products / running the reset+reconcile cron.** The
   jobs are exported but not auto-scheduled (auto-starting a writer against the prod
   DB from this change is out of scope); wire them into the scheduler on go.

## Tests (DB-free, mock-pool)
`test/plans_backend.test.js` and `test/plans_console_routes.test.js` — 17 tests,
run in the standard `mocha --no-config --exit 'test/**/*.test.js'` suite. Baseline
unchanged: 290 passing / 22 failing (pre-existing) / 3 pending.
