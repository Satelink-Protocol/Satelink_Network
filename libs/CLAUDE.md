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

## Schema corrections (M6.5, 2026-08-06)

- ledger_txns is the txn header; every ledger_entries row must have a parent
  txn in ledger_txns (FK enforced: ledger_entries.txn_id → ledger_txns.txn_id).
- Balance is enforced by a deferred DB trigger (`trg_ledger_entries_balance`),
  not only by the domain-layer LedgerTransaction. At COMMIT, for each affected
  txn_id, SUM(debit) must equal SUM(credit) for non-voided entries.
- accounts.state vocabulary is 'open' | 'closed' — never 'active'.
  (principals.state uses 'active', which is correct for principals.)
- All Financial OS timestamps are timestamptz. draws.created_at was converted
  from BIGINT epoch-ms to timestamptz in migration 009.

## Domain decisions (M7, 2026-08-12)

- An x402 single-shot payment is a DEPOSIT — money arriving. It is recorded
  once, by apps/api/src/ledger/shadow_ledger_write.js, as ledger_txns.kind=
  'deposit' with ref_type='revenue_event'. It is NOT a draw.
- A DRAW is consumption against an Authorization. Draws become real in M8
  (capacity enforcement) and M9 (multi-nonce recurring). `draws` being empty
  today is CORRECT, not a gap.
- shadow_draw_write.js must NOT record x402 payments as draws — that would
  double-credit acct_platform_revenue for one on-chain event. DRAW_SHADOW_WRITE
  is 0 and must not be re-enabled in M7.
- The M7 reconciler therefore reconciles LEDGER TRANSACTIONS against chain, not
  draws: for every ledger_txns row with ref_type='revenue_event' whose ref_id
  carries an on-chain tx hash, it verifies the tx exists+confirmed, the token
  amount to the expected vault/payTo equals the ledger entry amount (minor
  units), computed from DB + chain only. drift = signed sum of mismatches.
- Known M8 prerequisite (NOT fixed in M7): shadow_draw_write.js inserts
  settlements with state='confirmed', confirmations=0, required_confirmations=0
  — asserting a confirmation it never verified. The settlement-poller should own
  the pending→confirming→confirmed transition once draws are real.

## Domain decisions (M8, 2026-08-15)

- FROZEN: nonces are SETTLEMENT events, never call events. Per-call capacity
  enforcement compares `consumed_amount + cost` against `cap_amount` and touches
  NO nonce. `Authorization.consume(nonce, amount)` is invoked only at settlement,
  when an EIP-3009 authorization is redeemed on-chain. M9 adds pre-signed nonce
  SCHEDULES for repeated settlement; it does NOT move nonce consumption into the
  request path. The M8 request-path metering that updates `consumed_amount`
  directly is CORRECT, not a bypass of the aggregate and not tech debt.
- The M8 authorization is signed with the x402 "exact" scheme = EIP-3009
  `TransferWithAuthorization` (EIP-712) on USDC/Base (chainId 8453), the only
  installed scheme a funded wallet can both sign and later redeem on-chain. The
  signature is VERIFIED (viem recoverTypedDataAddress == claimed signer ==
  message.from) before persistence, by a services/financial adapter — apps/api/
  src/payments/ is NOT touched. signature_envelope = {scheme:'exact', signature,
  signer}. cap_amount / consumed_amount are USDC minor units (6 decimals).
- The capacity account for an x402/Base authorization is currency='USDC'
  (normality='credit', balance_invariant='non_negative', state='open',
  decimals=6). The 9 legacy backfilled capacity accounts are currency='USDT'
  (the Polygon-deposit rail) — a DIFFERENT funding path. A capacity account's
  currency must equal its authorization's currency; cross-currency draws are
  forbidden by Money.
- CAPACITY_ENFORCEMENT_PATH = legacy (default) | dual | new, read at REQUEST
  time (no redeploy to flip). legacy = api_credits authorizeAndMeter unchanged.
  dual = evaluate both, SERVE LEGACY, record both, log disagreements (new-path
  eval is read-only in dual — it never decrements). new = the atomic
  consumed_amount decrement is the decision. Denial reasons are distinct and
  machine-readable: no_authorization | insufficient_capacity |
  authorization_expired. Never conflated.
  **M9 Note:** We accepted a global flip to `new` for the M9 test window. Blast
  radius is exactly 5 internal/test/free keys that have `api_credits` but no
  `authorizations`; no per-principal opt-in infrastructure will be built.
- Migration runner is `npx tsx database/runner.ts migrate|status|verify
  "<connectionString>"` (takes the connection string as an ARGUMENT, never reads
  env). `scripts/migrate.js` is a DEAD SQLite-era migrator pointed at the old
  sql/ dir; it crashes on AUTOINCREMENT — NEVER run it. (Supersedes the stale
  "there is no database/runner.ts" note in the Migration command section above.)
- Railway workspace usage shows CUMULATIVE totals over a multi-month window.
  Never compute a daily rate by differencing two dashboard readings — use
  `railway metrics --network` for a specific window.

## Domain decisions (M9, 2026-08-19)

- Refill is implicit in enforcement. `enforceNew` selects the active authorization using `ORDER BY valid_before ASC, id ASC`. There is no persisted `schedule_state` caching the "current" authorization for the request path or the `/internal/recurring` report. Both evaluate the current auth dynamically at read time using the identical query.
- The refill monitor is purely observational. It maintains a lightweight, event-diffing cursor (originally designed as `schedule_state`) strictly for edge-detection between cycles to emit `nonce_transition`, `schedule_low`, and `schedule_exhausted` events. This cursor is never read for current-state reporting.
- Never rotate `POSTGRES_PASSWORD` (or any credential referenced by multiple services) without first confirming EVERY consuming service uses a live Railway reference variable (`${{Service.VAR}}`), not a hardcoded literal. A rotation is only safe when every consumer inherits it automatically. Audit all consumers before rotating, not after a failure surfaces one.

## Domain decisions (2026-08-27, free tier removed + billing/test columns)

- `revenue_events_v2` has TWO independent boolean dimensions — never conflate them again:
  - `is_billable` (migration 014) — was a real charge COLLECTED? true = credit deducted or x402
    settled. This is the billing truth. Real revenue = `SUM(amount_usdt) WHERE is_billable AND NOT
    is_test_data`.
  - `is_test_data` — is this a founder/synthetic row excluded from EXTERNAL metrics? Orthogonal to
    billing. Historically it was overloaded to ALSO mean "non-billable free-tier traffic," which is why
    345,820 $0 free-tier rows were mis-flagged `is_test_data=false` (reclassified to true in the
    2026-08-27 backfill — see docs/incidents/2026-08-27-freetier-backfill/). Going forward, "was it
    paid?" is `is_billable`, NOT `is_test_data`.
  - Real amount column is `amount_usdt` (not `amount_minor_units`). Only real external rail is
    `source='x402'`; both current x402 depositors are founder wallets → real external revenue is $0.00.
- The free tier is REMOVED from the money path. `/rpc/*` requires `x-wallet-address` or `x-api-key`
  (or a settled x402 payment); every other caller gets a 402 on the first call and never reaches
  billing, so nothing is written to `revenue_events_v2` / `ledger_entries`. `FREE_TIER_DAILY_LIMIT` and
  `FREE_TIER_ANON_CALLS` default 0 and exist only as emergency rollback levers (read at request time,
  no redeploy). Do not reintroduce a usage counter for unauthenticated traffic — there is none to count.
