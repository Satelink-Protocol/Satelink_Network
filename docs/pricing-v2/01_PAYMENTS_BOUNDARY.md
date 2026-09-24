# A2 — Payments boundary (Dodo compliance) — audit

**Context:** Dodo is reviewing Satelink as a SaaS analytics product and
explicitly excluded infrastructure/crypto from that review. This overrides
§3/§12 of the master prompt with the rule below. This file audits what's
already built (Track B, PR #403) against that rule and records the one open
question.

## The rule
1. **Feature access stays broad.** Every plan sees and can use Trading
   Intelligence, RPC, x402, machine identities, and the dashboard. Plans don't
   gate *visibility* of the platform.
2. **Money received through Dodo may only be consumed by Trading Intelligence
   usage.** A plan's Usage Unit allowance is a Trading-Intelligence allowance,
   full stop.
3. **RPC, x402, and machine-payment usage on any plan is paid through the
   crypto rail** (x402 / USDT-funded credits), exactly as today, shown in the
   same dashboard with a "crypto rail" label.
4. **Free-tier RPC gets a small daily request quota funded as a cost, not from
   Dodo money.**
5. **One unified usage view, two funding sources, never merged in the ledger.**

## Audit against what already exists

| Rule | Status | Evidence |
|---|---|---|
| (2) Dodo money → TI only | **Matches by design** | `apps/api/src/plans/entitlement_service.mjs` (PR #403): the `plan_entitlements` bucket is documented and structured as "consumed BEFORE credits, spendable ONLY on Trading Intelligence." `SUB_PLAN_MAP`/`reconcileEntitlements` already implement "subscriptions grant the monthly included-call entitlement bucket... not fungible USD credits" (founder-confirmed 2026-09-23, recorded in `docs/web/DECISIONS.md`). |
| (3) RPC/x402 → crypto rail only | **Matches, pre-existing** | `credit_service.mjs`'s `api_credits.credits_usdt` balance (the crypto-funded balance) is what `authorizeAndMeter` actually deducts for RPC and machine calls today; nothing in Track B changes that path — `consumeEntitlement` is explicitly NOT wired into it (per instruction: "Keep consumeEntitlement NOT wired into the live billing path"). |
| (4) Free-tier RPC funded as a cost, not Dodo money | **Verified, already true** | `src/middleware/free_tier_gate.js` is a pure per-IP counter (`FREE_TIER_DAILY_LIMIT`, default 500/day) with **zero reference to `api_credits`, `credits_usdt`, or Dodo** anywhere in the gate logic — confirmed by direct code read. It is not drawn from any balance; it is simply unmetered infrastructure cost absorbed up to the daily cap. |
| (5) One dashboard, two ledgers, never merged | **Matches by design** | `GET /v1/console/summary` (PR #403, `src/routes/console.js`) returns `balanceUsd` (the `api_credits.credits_usdt` crypto-funded balance) and `entitlement` (the Dodo-funded TI bucket) as **separate fields in one response** — the console UI (web PR #402) renders both in one page without summing them into a single number. |
| (1) Feature access stays broad | **Matches, nothing gates it** | No plan-based route guard exists anywhere in `app_factory.mjs` restricting RPC/x402/machine-identity routes by plan tier. Every plan's account can call every endpoint; the only gate is which *balance* pays for the call. |

## The one thing worth double-checking before Pricing V2 build
**Existing subscription behavior on `main` today is NOT yet the target model.**
`internal_dodo.js` (the live Dodo webhook, unmodified by Track B or this audit)
currently credits **fungible USD** into `api_credits.credits_usdt` on a
subscription payment — i.e., today, in production, a Dodo subscription
technically *does* fund the same balance that pays for RPC/x402, which is the
opposite of rule (2)/(3). This is flagged, not silently accepted:
`docs/web/DECISIONS.md` and `apps/api/src/plans/README.md` (both written during
this session) already record that **migrating the live webhook to grant the
entitlement bucket instead of fungible credits is real money-path surgery and
is explicitly deferred to a separate, later, founder-approved PR** — it is not
bundled into Track B and must not be silently left as "already handled." Until
that migration ships, the payments-boundary rule above describes the *target*
state, and the live webhook still needs that follow-up PR to actually enforce
it.

## Conclusion
The plan/entitlement architecture built in Track B (#403) is **already
consistent with A2's boundary rule** as a target design. The one real gap is
that the **existing, unmodified Dodo webhook** doesn't yet enforce it — that's
a known, tracked, separate PR, not something to build as part of Pricing V2's
UI/pricing-model work.
