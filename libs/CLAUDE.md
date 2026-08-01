# Satelink Financial OS — Build Context

ARCHITECTURE IS FROZEN. Do not redesign. Do not add primitives. Do not expand scope.
If you find a contradiction: STOP, state why/where/impact/options, wait for approval.

## What this is

Non-custodial treasury. A balance means CAPACITY TO DRAW against a user-held
standing authorization. Satelink never holds customer funds. Custodial pooling was
deliberately rejected (money transmission licensing exposure).

Existing production: x402 / EIP-3009 / USDC on Base via Coinbase CDP facilitator.
One real external payment has settled. That path must never regress.

## Layers

libs/       pure domain. ZERO I/O. No pg, no axios, no ethers, no node builtins.
services/   application (ports, commands, queries) + infrastructure (repos, adapters)
gateways/   protocol edge: http-api, rpc, mcp
workers/    scheduled: settlement-poller, reconciler, refill-engine, rating-engine
apps/       UI (console)

Dependency direction: libs ← services ← gateways|workers|apps
Enforced by .dependency-cruiser.cjs. Violations fail CI.

## Hard invariants — violating any is a failed milestone

1. Balance is DERIVED from ledger entries. Never a stored mutable column.
2. Money is bigint in integer minor units. NEVER a float. NEVER a JS number.
3. Pending entries never contribute to AVAILABLE balance. A posted debit is
   settled spend and DOES reduce available.
   available = posted_credits - posted_debits - pending_debits
   (Source of truth: the shipped M2 `account_balances` view in
   database/migrations/003_ledger_entries.sql. BalanceCalculator must match it
   exactly. Corrected 2026-08-01 — the earlier `posted_credits - pending_debits`
   dropped the posted_debits term, which would let settled spend be re-spent.)
4. Ledger credits ONLY on confirmed settlement. This is the settle-before-credit
   bug that made PR #278 a NO-GO. Do not reintroduce it.
5. Ledger is append-only. No UPDATE, no DELETE. Reversals are NEW entries.
6. Every money-moving operation is idempotent on a client-supplied key.
7. Aggregates reference each other by Id ONLY, never by root class.
   Cross-aggregate logic lives in coordination/.
8. Draws are never partially applied. Insufficient capacity = clean reject.
9. Revoke is always available from any non-terminal state. Safety never fails a
   permission check.
10. Founder wallets are excluded from all external revenue metrics.

## 17 aggregate roots

Financial (12): Principal, Account, LedgerTransaction, FundingSource,
Authorization, Agreement, Reservation, Charge, Draw, Grant, SplitRule, Policy

Commerce (5): Offering, Offer, PricingRule, Acquisition, Entitlement

Entities inside roots (NOT separate aggregates):
  AuthorizationNonce -> inside Authorization
  Settlement         -> inside Draw
  LedgerEntry        -> inside LedgerTransaction
  Provisioning       -> inside Entitlement

Fact streams (append-only, not aggregates):
  UsageEvent, SplitApplication, PolicyEvaluation

## Milestones — build in order, one at a time, never skip ahead

M0  Enforcement harness              DONE
M1  Money value object               <- CURRENT
M2  Ledger schema in production
M3  Ledger in shadow (dual-write, parity >= 99.9%)
M4  Principal + Account backfill
M5  Authorization + capacity (read-only)
M6  Draw + Settlement in shadow
M7  Reconciler + settlement poller
M8  Capacity enforcement cutover
M9  Multi-nonce recurring  <- THE SHIP GATE
M10 Grants + waterfall
M11 Policy + budgets
M12 Console (4 screens)

M9 gate: a fresh non-founder wallet signs 5 nonces ONCE, makes 5000+ calls across
3+ days, never signs again, and available never exceeds confirmed settled funds.

Commerce (M13-M17) does not begin until M9 passes.

## Verification commands

npm run arch            # dependency rules, must be zero violations
npm run typecheck:libs  # strict TS
npm run test:libs       # domain tests
npm run test:arch       # guard tests (6)
npm run test:integration # docker, testcontainers

## Absolutely forbidden

- Never modify free_tier_gate.js
- Never touch apps/api/src/payments/
- Never git add -A. Stage files individually.
- Never delete or checkout branch add-satelink-polygon-rpc
- Never delete branch wip/local-attribution-mcp-2026-07-16
- Never change SETTLEMENT_DRY_RUN
- Never auto-merge. PRs only.
- Never force push.
- Never leave TODOs or placeholder implementations.

## Style

DDD. Aggregate roots. Value objects. Repository pattern. Dependency injection.
Event-driven between contexts. Pure domain, infrastructure adapters.
Result<T,E> for expected failures. Domain code does not throw for
insufficient-capacity or currency-mismatch.
