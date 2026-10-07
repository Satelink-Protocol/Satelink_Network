# Stage 15 — Deterministic risk engine

**Branch:** `trading-agent/stage-15-risk`, stacked on Stage 14 (#470).

**Principle:** *only deterministic code decides.* Every order passes 20 ordered pre-trade checks inside a fail-closed wrapper. There is no LLM anywhere in this path, and a static test enforces that.

**Code:** `apps/api/src/trading_agent/risk/` (module table in its `README.md`).

**DB:** additive migration `025_risk_engine.sql`. Its down file is `database/migrations-down/025_risk_engine.down.sql` (local/ephemeral only).

**API:** internal only. Nothing is mounted, and nothing calls `decide()` yet.

## Inspection and STOP evaluation

> STOP if: requirements conflict with existing rate-limit infra.

**Not triggered.** The existing limiters all throttle **HTTP requests**:

| Limiter | What it limits |
|---|---|
| `security/middleware/rate_limits.js` | `express-rate-limit` per IP / wallet |
| `machine-access/rate-limiter.service.js` | token buckets in Redis (`machine-access:limit:*`) or memory |
| `workloads/rpc_gateway/rate_limiter.js` | RPC tier daily quotas in shared Redis (`rpc:apikey:*`) |
| identity session / IP limits (#456) | per session / IP |

Check 20 (order rate) is a different layer. It is a **pure function over per-principal order counts in the trading snapshot**: no Redis, no HTTP middleware, no shared keys or windows. An HTTP limiter will sit in front of a future trading API; the risk check sits behind it. The two compose.

`platform_flags` (013) is a runtime switch for capacity routing only. The trading kill switch is separate (`kill_switch_events`).

**Document A Part E (the 20 checks) is still not in the repo or Downloads**, as at Stages 12 and 13. The registry below is a **proposed substitute** designed to the brief, versioned as `risk-checks/1.0`. Reconciling it with Document A is a reviewed change that bumps the version, and every decision record names the version it ran.

## The 20 ordered checks

They are evaluated in order. **The first rejection stops evaluation** (the rest are recorded as `not_evaluated`), and APPROVE requires all 20 to pass.

| # | Check | Rejects with | Reads |
|---|---|---|---|
| 1 | **Kill switches**: policy switch (missing or `true` = engaged; new policies default ON), then every engaged scope matching the order, broadest first | `POLICY_MISSING`, `POLICY_KILL_SWITCH`, `KILL_SWITCH` | policy, kill_switch_events |
| 2 | **Circuit breakers**: consecutive losses / consecutive rejects / broker errors in window. **Trips** a mandate kill switch | `BREAKER_CONSECUTIVE_LOSSES`, `…_REJECTS`, `BREAKER_BROKER_ERRORS` | policy.limits.breakers, activity |
| 3 | **Trading flags**: `TRADING_AGENT`; venue connector (`BINANCE` / `ALPACA` / `UPSTOX_COPILOT`); `LIVE_TRADING` for live (LOCKED); `AUTONOMOUS_MODE` (LOCKED, + `UPSTOX_AUTOMATED`) when no human approved the order | `FLAG_DISABLED` | flagsEnv (injected, never `process.env`) |
| 4 | **Order schema**: strict intent schema (decimal strings, no unknown fields); limit ↔ limitPrice; strategy orders carry a version; spec matches | `INVALID_ORDER` | order, instrument spec |
| 5 | **Idempotency** key unused | `DUPLICATE_IDEMPOTENCY_KEY` | activity |
| 6 | **Broker account** owned, active, environment = mode, broker = venue | `ACCOUNT_NOT_FOUND`, `ACCOUNT_INACTIVE`, `ACCOUNT_MODE_MISMATCH`, `ACCOUNT_VENUE_MISMATCH` | broker_accounts |
| 7 | **Mandate** owned, same account, active, step-up approved, in validity window, copilot needs owner approval, currency = policy | `MANDATE_*`, `APPROVAL_REQUIRED`, `CURRENCY_MISMATCH` | mandates |
| 8 | **Strategy state** (Stage 13 lifecycle): PAPER for paper, LIVE_SMALL / LIVE for live; mandate binding; instrument in the strategy universe | `STRATEGY_NOT_FOUND`, `STRATEGY_STATE`, `STRATEGY_NOT_IN_MANDATE`, `STRATEGY_UNIVERSE` | strategy |
| 9 | **Instrument allowlist** (empty = nothing allowed) | `INSTRUMENT_NOT_ALLOWED` | policy |
| 10 | **Market hours**: Stage 14 calendar (NSE, NYSE with DST, holidays) | `MARKET_CLOSED` | now |
| 11 | **Market data**: quote present, not stale (Stage 11), age ≤ `maxQuoteAgeMs`, sane (bid ≤ ask, > 0) | `NO_MARKET_DATA`, `STALE_MARKET_DATA`, `BAD_MARKET_DATA` | quote |
| 12 | **Price collar**: spread and limit price within ±`maxPriceDeviationBps` of mid | `SPREAD_TOO_WIDE`, `PRICE_COLLAR` | quote |
| 13 | **Quantity filters**: lot size, minimum quantity, tick size | `LOT_SIZE`, `MIN_QUANTITY`, `TICK_SIZE` | instrument spec |
| 14 | **Venue minimum notional** | `MIN_NOTIONAL` | instrument spec |
| 15 | **Per-order notional** ≤ policy and mandate limits (minor units, rounded up); quote currency = policy currency (no FX) | `MAX_ORDER_NOTIONAL`, `MANDATE_NOTIONAL`, `CURRENCY_MISMATCH` | policy, mandate |
| 16 | **Daily notional** (exposure-reducing orders exempt) | `MAX_DAILY_NOTIONAL` | activity |
| 17 | **Daily loss**, realised + unrealised (exposure-reducing orders exempt) | `MAX_DAILY_LOSS` | activity |
| 18 | **Positions**: reduce-only honoured; max open positions; per-instrument position notional | `REDUCE_ONLY`, `MAX_OPEN_POSITIONS`, `MAX_POSITION_NOTIONAL` | activity.openPositions |
| 19 | **Leverage / buying power**: no shorts unless `allowShort`; equity > 0; gross exposure ≤ `maxLeverage` × equity; cash for buys | `SHORT_NOT_ALLOWED`, `NO_EQUITY`, `MAX_LEVERAGE`, `INSUFFICIENT_BUYING_POWER` | account |
| 20 | **Order rate**: per minute, per day, duplicate-order window | `ORDER_RATE_MINUTE`, `ORDER_RATE_DAY`, `DUPLICATE_ORDER` | activity |

**Exposure-reducing orders** (strictly reducing an existing position, never flipping it) are exempt from checks 16–19, so a position can always be cut when daily limits are hit. They are **never** exempt from kill switches, circuit breakers, flags or validity checks.

## Fail-closed wrapper (`RiskEngine.decide`)

`decide()` never throws. It APPROVEs only if **all** of these hold:
1. the context loaded before the timeout (otherwise `CONTEXT_UNAVAILABLE`);
2. the evaluated registry is the complete canonical 20 (a partial, reordered or empty list can never approve);
3. every check returned `PASS` (a throw is `CHECK_ERROR`; a malformed result is `INVALID_CHECK_RESULT`; any missing context field throws via `need()`);
4. the decision record was persisted (otherwise `RECORD_FAILED`: an approval nobody can audit is not an approval).

**Decision record** (`audit_events`, action `risk.decision`):
- decision id, decision, failed check (n / id / code / detail);
- checks and engine versions;
- policy id, version and hash;
- order hash;
- context snapshot (hash plus a body of up to 64 KiB);
- the full 20-step trace;
- any breaker trip.

## Kill switches and circuit breakers

- **Scopes, broadest first:** `global · principal · broker_account · mandate · strategy · venue · instrument`. `principal_id NULL` means platform-wide.
- **State:** the latest event per (scope, id, principal) wins.
- **Precedence:**
  - check 1 runs before everything, so a kill switch is reported even when every other check would also fail;
  - a narrower release never overrides a broader engage;
  - the broadest engaged scope is the one reported.
- **Who may engage:** the owner (own scopes), an admin (anything), or the system / circuit breaker.
- **Who may release:** the owner or an admin. Only an admin can release an admin-engaged switch.
- **Agents can never engage or release.**
- **Breakers:** a tripped breaker (check 2) appends a `circuit_breaker` engage on the mandate. The next order stops at check 1 even after the condition clears, until a human releases it.

## Policies: versioning and who may edit

- `risk_policies` rows are **immutable versions** (025 trigger blocks UPDATE and DELETE). An edit is version n+1.
- Each version has a canonical content hash, re-verified on every read; tampering at rest is `CONFLICT`, so the context fails and the order is REJECTed.
- A mandate-specific policy takes precedence over the principal-level one.
- **Who may edit:**
  - **users**: only their own policy, within their **plan caps** (injected port; no caps means refusal);
  - **admins**: within platform **hard caps** (`maxLeverage 10`, `maxOpenPositions 100`, `maxOrdersPerMinute 120`, `maxOrdersPerDay 20 000`);
  - **agents: never.**
- **The admin role is asserted by the caller.** Until staff authentication exists (B-02), this module must not be exposed to an admin surface.

## Migration 025

1. **`kill_switch_events` (NEW).**
   - CHECKs: global ⇔ no scope id; global ⇒ platform-wide; principal scope = its principal; breakers / system only engage; user source needs a principal; reason 1–500 chars.
   - UPDATE / DELETE revoked.
2. **`risk_policies` (021), additive.**
   - New columns: `limits` JSONB, `policy_hash`, `created_by`, `created_by_role`.
   - Unique `(principal_id, COALESCE(mandate_id, ''), version)`.
   - Immutability trigger.

**Judgment call:** the brief allows migrations for these tables "if absent". `risk_policies` exists but cannot hold the limits checks 12 and 16–20 need, so it is **extended additively** rather than duplicated. No existing column changes.

**Rollback order:** 025 changes a 021 table, so the 021 round-trip test rolls back `025 → 024 → 021` (`DEPENDENT_DOWNS`).

## Blocker impact

| Blocker | Touched? | Why the stage stays inside the accepted isolation |
|---|---|---|
| B-06 (no staging) | yes (migration 025) | applied only to local ephemeral Postgres; nothing deployed |
| B-07 (migration tooling) | yes | additive 025 via the canonical runner; rollback order documented |
| B-02 (staff auth) | **constrains this stage** | admin authority is a caller-asserted role. It must not be exposed until staff auth exists, so policy and kill-switch admin stay internal |
| B-08 / B-09 (execution, KMS, scope) | no | the engine decides only; it places nothing. Live and autonomous orders are impossible because check 3 needs the LOCKED `LIVE_TRADING` / `AUTONOMOUS_MODE` |
| B-03 / B-10 | no | not mounted (the register test checks it) |
| B-01, B-04, B-05, B-11 | no | — |

No blocker changes status. The Stage 15 row is added to the acceptance log in `docs/trading-agent/BLOCKERS.md`.

## Test evidence (2026-10-04)

| Suite | Result |
|---|---|
| `apps/api/test/trading_risk_engine.test.js` (mocha) | **19 passing** |
| Integration, local Postgres 16 (guard-DB recipe): `trading-risk` (4 new) + backtests + strategy DSL + agent traces + market data + foundation (021 round trip now rolls back 025 and 024 first) | **21 passing**; temporary DBs dropped, none left behind |
| `scripts/ci-baseline-check.sh` (×2) | **701 tests / 581 pass / 2 known failures / 118 pending**, both runs clean (+19/+19 vs Stage 14) |

### Brief acceptance mapping

**100% check coverage.**
- **Positive:** the baseline order passes each of the 20 check functions individually, and APPROVEs with a 20/20 trace.
- **Boundary positives:** 14 cases exactly at a limit still pass (order and daily notional, loss, position notional, leverage, cash, quote age, collar edge, rate cap, duplicate window, min notional, NYSE in session, open-ended mandate, another principal's switch).
- **Negative:** 68 cases, each asserted to be rejected **by exactly its check number with its code**, with every earlier check passing and every later one `not_evaluated`.
- **Coverage assertion:** a test programmatically checks that every one of checks 1–20 has at least one negative case.

**Exception → REJECT.**
- **Missing context fields:** 12 cases, each `CHECK_ERROR`; a null context and an undefined order are also rejected.
- **Bad check results:** a throwing check, and checks returning `undefined`, `true`, `{ok:'yes'}`, `{ok:false}` or `null`.
- **Bad registries:** empty, partial and reordered.
- **Fuzz:** 3,000 seeded corruptions of the order or context never throw, and APPROVE only with a full-pass trace.
- **Engine:** a loader error, a loader timeout and a failed decision write all REJECT. The write-failure case is notable because the checks alone *would* have approved.

**Kill switch precedence.**
- A global switch wins over an order that fails 5 other checks (`failedCheck.n = 1`, 19 not evaluated).
- The broadest scope is reported first.
- A narrower release doesn't override a broader engage.
- The latest event wins, ordered by sequence rather than array position.
- Each scope matches only its own id.
- New policies default to halted.
- Breaker trip → next order stopped at check 1 → an agent or the platform cannot release → the owner releases → approved.

**Security (who may edit).**
- Agents can never author a policy, even when claiming `role: 'admin'`.
- A user cannot edit another user's policy or exceed plan caps (6 cases); with no plan caps, the user is refused.
- Admins can exceed plan caps but not hard caps.
- Kill-switch permissions cover 10 allow / deny cases.

**Bugs found by these tests:**
- **Fail-open (fixed):** an empty check registry APPROVEd (0 of 0 checks "all passed"). APPROVE now requires the exact canonical registry. Regression tests cover empty, partial and reordered registries.
- **Misleading error code (fixed):** a missing `policy.decimals` rejected with a misleading `CURRENCY_MISMATCH`. It is now read strictly (`CHECK_ERROR`).

**Mutation checks** (each change temporarily applied, then reverted). Every one made the suite fail:
- an exception treated as a pass;
- a missing policy kill switch treated as off;
- releases ignored;
- no reduce exemption on loss;
- live orders without `LIVE_TRADING`;
- an unrecorded approval standing;
- shorts allowed;
- stale quotes accepted.

**Static check:** `risk/**` imports no agent, LLM or provider, no network, Redis or fs, and uses no `Math.random`, `process.env` or `fetch`. The pure modules don't read the clock.

**Postgres:**
- a policy UPDATE or DELETE is blocked by the trigger, and duplicate versions are refused;
- a superuser edit (trigger disabled) is caught by the hash re-check;
- kill-switch CHECKs and revoked privileges hold;
- decision rows land in `audit_events`;
- a breaker trip lands in `kill_switch_events`;
- the down migration restores 021's shape.

## Follow-ups (not in this stage)

- **A database-backed `loadContext`** (orders, positions, PnL, activity counters from the 021 tables, Stage 11 quotes). It belongs with the execution stage; until then, missing context means REJECT.
- **Staff authentication (B-02)** before any admin surface for policies or kill switches.
- **Plan caps:** a real `planCaps` source from the subscription / plan system.
- **Reconcile the check list with Document A Part E** if it is found (new `CHECKS_VERSION`).
- **Optional:** a dedicated `risk_decisions` table if decision volume outgrows `audit_events`.

## Rollback

Revert the commit. On a local database, apply `025_risk_engine.down.sql` (before 024 / 021 downs).
