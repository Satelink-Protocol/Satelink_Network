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

## Ops: authorization revocation + detached-driver liveness (2026-08-27)

- Authorization revocation is via `tools/ops/revoke-authorization.ts`, which drives the domain
  `Authorization.revoke()` + `PostgresAuthorizationRepository.save()`. NEVER mutate `authorizations`
  with raw SQL — the domain path enforces the terminal-state guard, optimistic version lock, and the
  invariant that revocation preserves `consumed_amount` and every `ledger_entries` row (it kills
  future draws; it does not rewrite history). Dry-run is the default; mutation requires `--confirm`.
  There is no `revoked_at` column — revocation is `state='active' -> 'revoked'`; the timestamp lives
  in the script's structured audit log, not the row.
- Any detached process that writes to the prod money path MUST have a liveness alert on its evidence
  file: if the file stops advancing for >15 min while the run is marked active, page. M9's endurance
  driver died at call 64/5000 and went unnoticed for 6 days because this control does not exist. It
  belongs in `workers/reconciler` and is still unbuilt — do not re-run any such driver until it does.

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

## Edge + writer rules (2026-08-27, WS storm)

- NEVER hard-block unauthenticated /rpc/* at the Cloudflare edge. x402 payment discovery REQUIRES
  the app's 402 to reach the client — a Block rule returns 403 on the first request and kills the
  only paid path (STOP-B). Rate-limit only (first N/min reach the app; exclude x-payment,
  x-api-key, x-wallet-address). Never rate-limit /health, /internal/*, or any request carrying
  x-payment. Details: docs/ops/cloudflare-rpc-ratelimit.md.
- The Aug-2026 revenue storm (345,820 rows @ $0.000001) was the WebSocket gateway
  (ws_gateway.js, op_type='ws_subscription'), NOT operations_engine/security-billing (those wrote
  ZERO rows — dead code). WS RPC now requires the same credential as HTTP /rpc; unauthenticated WS
  upgrades are rejected. Any per-event revenue writer (WS or streaming) must be authenticated AND
  should aggregate, never write one revenue_events_v2 row per streamed event.
- DB backstop (migration 015): revenue_events_v2 CHECK — is_billable=true requires amount_usdt>0.
  A code guard can be bypassed by the next legacy writer; the constraint cannot. It does NOT catch
  micro-charge floods (amount>0) — those are a code/auth problem, not a constraint problem.

## Storm prevention rules (2026-08-27, guardrails)

- `ws_gateway.js` was the Aug-2026 revenue storm source: an UNAUTHENTICATED WS upgrade on
  `/rpc/ws/*` writing 1 revenue_events_v2 + 2 ledger_entries rows PER streamed event
  ($0.000001, `op_type='ws_subscription'`, 345,820 rows). Any new streaming/subscription
  endpoint must be BOTH authenticated AND batch-aggregated (one row per window, not per event)
  before merge. See docs/design/ws-subscription-batching.md.
- Row-growth alarms are HOURLY, not daily — the storm peaked at 111,581 ledger rows in ONE
  hour; a daily check would fire ~12h too late. Guardrails live in workers/reconciler
  (guardrails/*), thresholds behind platform_flags, alerts de-duped to one email/condition/hour.
- Ops scripts (and migrations) that mutate PRODUCTION must be ON MAIN before execution. The
  #342 revocation ran from an unmerged branch; it worked, but do not repeat it — merge first.
- Any detached process that writes to the prod money path MUST upsert `driver_heartbeats`
  (driver_name, status='active', last_heartbeat_at, calls_done/planned) on a fixed interval.
  The reconciler alarms when an active driver's heartbeat goes stale >15 min. This is the
  control whose absence let M9 die at call 64/5000 and go unnoticed for 6 days.

## Incident learnings (2026-08-27, DB volume exhaustion)

- NEVER prune `ledger_entries`, `ledger_txns`, or `revenue_events_v2` to reclaim disk. They are
  append-only money-path tables (invariant 5) and balance is DERIVED from them (invariant 1). Deleting
  rows corrupts every derived balance and is a failed milestone. When Postgres disk fills, the fix is
  RESIZE THE VOLUME (operator), not prune the ledger. See docs/incidents/2026-08-27-volume-exhaustion.md.
- `max_wal_size` must be < the Postgres volume size. The 2026-08-27 exhaustion happened because
  `max_wal_size=1024MB` on a 1 GB volume let a single-day write storm's WAL fill the whole disk. Target
  `max_wal_size=512MB`, `max_slot_wal_keep_size=256MB` (operator/Railway config — out of Claude scope).
- `revenue_events_v2.is_test_data` is UNRELIABLE: the free-tier RPC path writes `status=success`,
  empty-`source`, `is_test_data=false` rows for calls that collect $0 (345,820 such rows as of
  2026-08-27). Do not treat the non-test count as paid conversions; the only real external rail is
  `source='x402'`. The real amount column is `amount_usdt` (not `amount_minor_units`).
- Redis is load-bearing (BullMQ workload queue via `apps/api/src/queue/*`), not just rate-limiting. Do
  not propose replacing it with an in-process cache.

## Post-outage learnings (2026-08-28)

- The Railway **Compute Usage Limit is a KILL SWITCH, not a budget**. Hitting it stops EVERY service
  and database project-wide (2026-08-28: limit $11, usage $11.08 → total outage; raised to $25 and
  everything recovered, no data loss). Keep headroom ≥2× expected spend; **cut usage, never lower the
  cap toward actual spend.** Alert at 80% (see docs/ops/external-monitoring.md).
- App-layer 402 gates stop DB WRITES but NOT egress/CPU/RAM — a 402 is still a full request cycle.
  Cost control belongs at the **Cloudflare edge** (rate-limit), not the app. See
  docs/ops/2026-08-28-cost-reduction.md.
- The reconciler guardrails share the DB failure domain: they run inside the reconciler, which needs
  Postgres, so they **cannot alarm on DB-down**. The outer layer is an external uptime check on
  `/health` (UptimeRobot) + a Railway usage alert — both OUTSIDE Railway/the DB.
- `platform_flags` columns are **`key`, `value`, `updated_at`, `updated_by`** (PK on `key`). There is
  NO `name` column — read `\d platform_flags` before querying, never guess. #343's guardrail thresholds
  are NOT seeded there; they fall back to code defaults (5000 rows/h, 70/85% volume, 2:1±0.5 ratio,
  15-min driver stale). Seeding a `guardrail_*` row overrides without redeploy.
- Revenue events WITHOUT a ledger entry are EXPECTED in M3 shadow mode: `shadow_ledger_write.js` is
  fire-and-forget and gated on `LEDGER_SHADOW_WRITE`. The 62 `rpc_call` orphan rows (2026-06-22 →
  08-20, all is_test_data=true) are historical rows written while that flag was off — not a bug, not a
  writer surviving the gates. The write-amp guardrail's expected 2:1 ratio only holds while the shadow
  flag is on.
- Every PR appends to this file, so parallel PRs ALWAYS conflict here. Resolve by UNION — keep every
  section from both sides; dedupe only byte-identical lines; never drop a section.

## Cloudflare edge (2026-08-29, Free plan constraints — proven)

- Cloudflare Free **403s GitHub Actions datacenter IPs** at an IP layer the rulesets API cannot
  allowlist (custom + managed rulesets + all security-product skips all failed). Do NOT re-attempt
  IP allowlisting. The external health check therefore probes the reconciler's Cloudflare-FREE
  `.up.railway.app/readyz`, not `api.satelink.network`.
- Free plan allows exactly ONE `http_ratelimit` rule — always EDIT `satelink-rate-limit`
  (id `9c3b6ada45a24a54a954c89b35d61243`, zone `satelink.network`), never create a second
  (error `50001: 2 out of 1`).
- Free plan rate-limit expressions support **Path only** (+ Verified Bot); **request-header fields
  are Enterprise-only** — the API rejects `http.request.headers.names` with `"not entitled ...
  higher Advanced Rate Limiting plan is required"`. Period is locked to 10 s. So on Free you CANNOT
  exclude `x-payment`/`x-api-key`/`x-wallet-address` from the counter — the live `/rpc/` rule counts
  paying traffic too. Acceptable only because a single x402 client never bursts 20 req/10 s; do not
  tighten the count below what a legit agent needs. NEVER hard-Block `/rpc/*` — x402 discovery needs
  the app's 402 to reach the client; rate-limit action only.
- Rollback snapshot for the rate-limit rule: `docs/ops/cloudflare-rollback-2026-08-28.json`.
  Applied change recorded in `docs/ops/2026-08-29-cloudflare-ratelimit-applied.md`.
