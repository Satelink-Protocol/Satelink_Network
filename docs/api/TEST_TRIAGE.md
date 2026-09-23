# apps/api test triage — the 22 pre-existing failures

Triage of every failing test on `main` (baseline, before Track B / `feat/api-auth-and-plans`),
run with `npx mocha --no-config --exit --reporter min --no-colors 'test/**/*.test.js'` in this
sandbox. **Result on `main`: 273 passing / 22 failing / 3 pending.** Track B added 21 new tests
on top and left this exact 22-failure set byte-identical (see PR #403) — no regressions.

This is a **report only**. No money-path production code (billing, credits, x402, the Dodo
webhook, deposits, settlement, or the #398 claim path) was changed to produce this table or to
fix anything below it. Pure test-harness/env fixes (no production code touched) are applied
separately on `fix/api-test-harness` (see §"Harness fixes applied" below) — 21 of the 22 are
resolved or made to skip safely there; the remaining one (`#12`) needs a founder/dev decision on
real production behaviour and is deliberately left failing.

## Root causes (grouped)

| # | Root cause | Failures | Fixable in `fix/api-test-harness`? |
|---|---|---|---|
| A | `DATABASE_URL` is set to a live Railway Postgres whose credentials don't authenticate in this sandbox (`password authentication failed for user "postgres"`) — the tests' own `if (!process.env.DATABASE_URL) this.skip()` guard only handles the *unset* case, not *set-but-unreachable* | 1, 2, 17, 18, 20, 21, 22 (8 of 22, incl. 2 cascading `after` hooks) | **Yes** — wrap the connect call in try/catch and skip, matching the existing repo pattern already used in `test/vnext_kernel_router.test.js` etc. |
| B | Test signs a JWT with `process.env.JWT_SECRET`, which is unset in this sandbox; the router's own `verifyJWT` middleware reads the *same* unset var, so both the test's signer and the real code throw `secretOrPrivateKey must have a value` | 3–11 (9 of 22) | **Yes** — set a fixed `process.env.JWT_SECRET` for the test file's lifetime (restored after), so both sides agree |
| C | Shared, module-level singleton rate limiter (`apiKeyCreateLimiter` in `src/security/middleware/rate_limits.js`, keyed by `req.ip`, **not** `X-Forwarded-For`) is deliberately exhausted to 30/30 by `test/api_keys_security.test.js`'s own limiter test, then never reset — poisoning every later file in the same mocha process that also creates keys through it, including `instant_key.test.js` | 14, 15, 16 (3 of 22) | **Yes** — `apiKeyCreateLimiter.resetKey(...)` in an `after()` hook in the *polluting* file (`api_keys_security.test.js`), not in `instant_key.test.js` |
| D | Mock pool in the test is stale relative to real code: `epoch_scheduler.js` legitimately issues an `UPDATE revenue_events_v2 SET epoch_id = …` the test's mock never anticipated | 13 (1 of 22) | **Yes** — add the missing mock handler (test-file-only; the real `epoch_scheduler.js` — settlement code — is untouched) |
| E | Deterministic, DB-free unit test asserts a real behavioural expectation (`DepositListener` resuming a scan from its DB cursor after a restart) and gets an empty array instead of the expected credited deposit | 12 (1 of 22) | **No** — this needs a judgement call on `src/services/deposit_listener.js` (deposit money-path code), explicitly out of scope for this pass. Reported, not fixed. |
| F | Test boots the **entire** app (`createApp()`) against a real-or-real-looking `DATABASE_URL`, which per `CLAUDE.md` is unsafe (starts the epoch scheduler + settlement anchor, which **write** to whatever DB it's pointed at) | 19 (1 of 22) | **Partially** — made to skip unconditionally with a comment citing the guardrail, rather than "fixed" to actually connect (which would risk exactly the forbidden full-app-boot-against-a-real-DB scenario in some other environment). Not a real fix; a safety stop. |

## Full table

| # | File | Test | Category | Touches billing/credits/x402/Dodo webhook/deposits/settlement/#398 |
|---|---|---|---|---|
| 1 | `test/c1_payer_address.test.js` | `C1: x-payer-address credit theft is closed` — `before all` hook | Missing DB/env (root cause A) | credits, x402 |
| 2 | `test/c1_payer_address.test.js` | `C1: x-payer-address credit theft is closed` — `after all` hook (cascades from #1) | Missing DB/env (root cause A) | credits, x402 |
| 3 | `test/claims_route_admin_secret.test.js` | `POST /admin/backfill-revenue` — `ADMIN_BACKFILL_SECRET unset -> 503, even with the old literal` | Missing env (root cause B) | settlement (admin endpoint gate only; mocked pool, no real money movement) |
| 4 | `test/claims_route_admin_secret.test.js` | `POST /admin/backfill-revenue` — `ADMIN_BACKFILL_SECRET set -> the old literal is rejected (403)` | Missing env (root cause B) | settlement (gate only) |
| 5 | `test/claims_route_admin_secret.test.js` | `POST /admin/backfill-revenue` — `ADMIN_BACKFILL_SECRET set -> the correct secret passes the gate` | Missing env (root cause B) | settlement (gate only) |
| 6 | `test/claims_route_admin_secret.test.js` | `POST /admin/allocate-earnings` — `ADMIN_BACKFILL_SECRET unset -> 503, even with the old literal` | Missing env (root cause B) | settlement (gate only) |
| 7 | `test/claims_route_admin_secret.test.js` | `POST /admin/allocate-earnings` — `ADMIN_BACKFILL_SECRET set -> the old literal is rejected (403)` | Missing env (root cause B) | settlement (gate only) |
| 8 | `test/claims_route_admin_secret.test.js` | `POST /admin/allocate-earnings` — `ADMIN_BACKFILL_SECRET set -> the correct secret passes the gate` | Missing env (root cause B) | settlement (gate only) |
| 9 | `test/claims_route_admin_secret.test.js` | `POST /admin/close-epoch` — `ADMIN_BACKFILL_SECRET unset -> 503, even with the old literal` | Missing env (root cause B) | settlement (gate only) |
| 10 | `test/claims_route_admin_secret.test.js` | `POST /admin/close-epoch` — `ADMIN_BACKFILL_SECRET set -> the old literal is rejected (403)` | Missing env (root cause B) | settlement (gate only) |
| 11 | `test/claims_route_admin_secret.test.js` | `POST /admin/close-epoch` — `ADMIN_BACKFILL_SECRET set -> the correct secret passes the gate` | Missing env (root cause B) | settlement (gate only) |
| 12 | `test/deposit_listener.test.js` | `DepositListener — canonical crediting + hardening` — `restart mid-block-range resumes from the DB cursor (no gap, no rescan-credit)` | **Real bug** (root cause E) — deterministic mock-pool test, no DB/env dependency, fails a real behavioural assertion | **deposits** |
| 13 | `test/epoch_scheduler.test.js` | `EpochScheduler` — `closes one OPEN epoch, aggregates revenue, applies 50/30/20 split, and opens the next epoch` | Test-harness gap — mock is stale vs. real code (root cause D) | settlement |
| 14 | `test/instant_key.test.js` | `instant trial machine key` — `t1: instant mode issues a wallet-less trial key` | Test isolation / cross-file pollution (root cause C) | billing (key issuance gate only) |
| 15 | `test/instant_key.test.js` | `instant trial machine key` — `t2: third instant mint from one IP in a day → 429` | Test isolation / cross-file pollution (root cause C) | billing (key issuance gate only) |
| 16 | `test/instant_key.test.js` | `instant trial machine key` — `t3: wallet path unchanged — missing signature returns sign_message` | Test isolation / cross-file pollution (root cause C) | billing (key issuance gate only) |
| 17 | `test/wallet_auth_billing.test.js` | `P0-wallet-auth: x-wallet-address can no longer drive billing` — `before all` hook | Missing DB/env (root cause A) | credits, billing |
| 18 | `test/wallet_auth_billing.test.js` | `P0-wallet-auth: x-wallet-address can no longer drive billing` — `after all` hook (cascades from #17) | Missing DB/env (root cause A) | credits, billing |
| 19 | `test/withdrawal_api.test.js` | `Withdrawal API` — `before all` hook for `should create a withdrawal successfully` | Missing DB/env **+** unsafe pattern (root cause F) — boots the full app via `createApp()` | **settlement** (withdrawals) |
| 20 | `test/x402_rail.test.js` | `x402 payment rail` — `t3: duplicate settlement tx_hash → 409, exactly one payment_sources row` | Missing DB/env (root cause A) | x402, deposits |
| 21 | `test/x402_rail.test.js` | `x402 payment rail` — `ledger integrity + bundle credits` — `before all` hook for `founder check: mainnet settlement from a founder wallet is is_test_data=true` | Missing DB/env (root cause A) | x402, deposits |
| 22 | `test/x402_rail.test.js` | `x402 payment rail` — `ledger integrity + bundle credits` — `after all` hook (cascades from #21) | Missing DB/env (root cause A) | x402, deposits |

None of the 22 touch the Dodo webhook (`src/routes/internal_dodo.js`) or the #398 claim-token
path directly.

## Harness fixes applied (`fix/api-test-harness`, separate PR)

Pure test-file changes only — **no production code touched**:

1. `test/c1_payer_address.test.js`, `test/wallet_auth_billing.test.js`, `test/x402_rail.test.js`
   (both `before` hooks) — wrap `await raw.connect()` in try/catch and `this.skip()` on failure,
   extending the existing `if (!process.env.DATABASE_URL) this.skip()` guard to also cover
   *set-but-unreachable*. Matches the established pattern in `test/vnext_kernel_router.test.js`,
   `test/vnext_submit_endpoint.test.js`, `test/vnext_resell_endpoint.test.js`. **Resolves #1, 2,
   17, 18, 20, 21, 22 in any environment with a real, reachable test DB; in this sandbox they now
   skip cleanly instead of failing.**
2. `test/claims_route_admin_secret.test.js` — set `process.env.JWT_SECRET` to a fixed test value
   before it's read (only if unset), restored after the suite. **Resolves #3–11.**
3. `test/api_keys_security.test.js` — after its own 30-request limiter-exhaustion test, call
   `apiKeyCreateLimiter.resetKey(...)` to stop poisoning the shared singleton for every later file
   in the same mocha process. **Resolves #14–16** (no change needed in `instant_key.test.js`
   itself — it was never the source of the bug).
4. `test/epoch_scheduler.test.js` — add the missing mock handlers for
   `UPDATE revenue_events_v2 SET epoch_id = …` (orphan-event assignment) and
   `INSERT INTO epoch_ledger …` (the epochs/epoch_ledger sync `truth.js` reads),
   both matching the real (unmodified) `src/economics/epoch_scheduler.js` — the
   first was the originally-reported gap; the second surfaced only after fixing
   the first (the mock had drifted from two separate later additions to the real
   code, not one). **Resolves #13.**
5. `test/withdrawal_api.test.js` — made to skip unconditionally, with a comment citing the
   `CLAUDE.md` guardrail ("Local full-app boot is unsafe against prod DB — it starts the epoch
   scheduler + settlement anchor, which WRITE to prod"). This is a safety stop, not a real fix:
   the test as written boots the *entire* app via `createApp()`, and making it actually pass by
   pointing at a working DB would risk starting schedulers/settlement writers against whatever
   database that connection string happens to resolve to in some other environment. **#19 is
   still reported as failing/skipped — deliberately not "fixed" to run.**

**Not touched — explicitly out of scope:**
- **#12 (`DepositListener` cursor-resume)** — a real, deterministic assertion failure in
  deposit-listener test coverage. Fixing it requires deciding whether the bug is in
  `src/services/deposit_listener.js` (deposit money-path code, forbidden here) or in the test's
  own fixture setup, which itself requires understanding the intended resume semantics closely
  enough that a wrong guess could mask a real production bug. Left failing, reported above.

**Verified result after applying the harness fixes** (same command, same sandbox, `fix/api-test-harness`):
**286 passing / 1 failing (#12, `DepositListener`) / 23 pending.**

Pending rose from 3 to 23, not because more tests were skipped than before, but because skips are
now counted correctly: previously, an uncaught connection error inside a `before`/`before all` hook
made mocha report exactly **one** failure for the whole hook, silently swallowing every `it()`
nested under it. Now that those hooks call `this.skip()` instead, mocha marks **each** `it()`
inside individually as pending (`c1_payer_address.test.js` has 4, `wallet_auth_billing.test.js` has
6, `withdrawal_api.test.js` has 3, plus the affected specs in `x402_rail.test.js`) — a more honest
count of what's actually not running, not a regression. In an environment with a reachable test
database, all of these run for real and are expected to pass (that's what they did before whatever
broke `DATABASE_URL`'s credentials in this sandbox).

`#3`–`#11` (9), `#13` (1), and `#14`–`#16` (3) — 13 tests — moved cleanly from failing to passing.
21 of the 22 original failures are resolved or made to skip safely, with **zero production-code
changes**; only #12 (`DepositListener`) remains failing, reported above for founder/dev review.
