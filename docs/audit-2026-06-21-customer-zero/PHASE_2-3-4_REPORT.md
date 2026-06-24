# Customer Zero P0 Recovery — Phase 2/3/4 Report

Executed 2026-06-21. Companion to `SPRINT_PROGRESS.md` and `P0_RECOVERY_PLAN.md`.

---

## GATE SUMMARY (read first)

| Gate | Status |
|---|---|
| Phase 2/3 code deployed behind `CREDIT_CANONICAL` (flag **OFF**) | ✅ done (PR #169) |
| Deployment health verified | ✅ ok, behavior unchanged |
| Phase 2/3 verification (funded test key + wallet, real prod DB) | ✅ **all checks passed** |
| **Enable `CREDIT_CANONICAL=true`** | ⛔ **STOPPED — money-path risk** |
| Phase 4 dry-run reconciliation | ✅ done, **delta = 0** |
| **Commit Phase 4 backfill** | ⛔ **NOT RUN** (instructed dry-run only) |

> **Why the flag was NOT enabled:** the Phase 4 dry-run found **1 funded wallet
> (0.59993 USDT) with no `api_credits` account**. Enabling canonical before the
> backfill would resolve that wallet caller to "no account" → **401**, stranding a
> real funded balance. Correct order is **backfill first, then flip**. Per "stop at
> each gate if money-path risk appears," I stopped before the flip.

---

## Phase 2 Report — serving-path cutover (deployed, flag OFF)

**Change (PR #169):** `apps/api/src/workloads/rpc_gateway/rpc_gateway.js` POST
`/:chain` handler now branches on `CREDIT_CANONICAL`:

- **Flag ON + authenticated caller** (`X-API-Key` or `x-wallet-address`):
  `creditService.authorizeAndMeter(db, {apiKey, wallet})` is the single authority —
  daily-limit gate (429), atomic balance deduct (402), usage metering, in one call.
  Emits `X-Credit-Source: api_credits` + `X-Credit-Balance`. Unknown key → **401**.
- **Flag OFF, or anonymous public traffic:** the legacy Redis rate-limit path runs
  **verbatim** (preserved in the `else` branch). No behavior change.
- `credit_gate.js` (legacy wallet `credit_balances` deduction) now **steps aside**
  when the flag is on → prevents double deduction.
- Request is validated **before** any billing (an invalid request is never charged).

**Default is OFF** (env unset → false): the deploy changed nothing in production.

### Serving-path trace (POST /rpc/:chain)
```
request
 └─ freeTierGate (IP 500/day, anonymous)            [app_factory] — unchanged
 └─ creditGate middleware
       └─ if CREDIT_CANONICAL=true → next() (steps aside)   [no double deduct]
       └─ else legacy wallet credit_balances deduction       [unchanged]
 └─ POST /:chain handler
       1. validate chain + JSON-RPC body            → 400 if bad (before billing)
       2. if CANONICAL && (apiKey||wallet):
             authorizeAndMeter(api_credits)
               ├─ resolveAccount(apiKey | wallet)   → 401 if unknown
               ├─ daily-limit gate                  → 429 if over
               ├─ atomic deduct credits_usdt        → 402 if insufficient
               └─ INSERT/UPSERT api_usage_daily     → usage metered
          else:
             checkRateLimit (Redis) → 429 ; incrementUsage (Redis)   [legacy]
       3. cache → routeRpcRequest → recordRpcRevenue → respond        [unchanged]
```

### Live request trace (production, flag OFF — captured)
```
POST /rpc/polygon  -H "X-API-Key: sk_free_…"
HTTP/2 200
x-ratelimit-limit: 500          ← legacy Redis path
x-ratelimit-tier: free
(no x-credit-source header)      ← canonical path dormant, as expected
```
Anonymous `POST /rpc/polygon` → 200. `/health` → `{ok:true, db:ok}`.

---

## Phase 3 Report — usage metering + deduction (verified)

`creditService.authorizeAndMeter` performs all three per request, atomically:
1. **increment usage** — `api_usage_daily.request_count += 1` (+ `usdt_spent`).
2. **deduct credits** — `UPDATE api_credits SET credits_usdt = credits_usdt - cost
   WHERE credits_usdt >= cost RETURNING` (cannot go negative; 402 on shortfall).
3. **record usage history** — same `api_usage_daily` row per key/day powers
   `GET /api/keys/usage` & `/usage-history` (which were always 0 before — audit P0-4).

Free tier: cost 0, gated by daily_limit only. Paid tiers: pay-per-call deduction.

### Production verification evidence (real prod DB, test account, then cleaned up)
Ran the exact canonical code path via `scripts/cz_verify.mjs`:

```
Create Key → account resolvable ........................ PASS
Deposit → balance increases (0 → 1) ................... PASS
Request → usage increment (request_count=5) ........... PASS
Request → balance decrement (1 → 0.99985) ............. PASS
No double deduction (deducted = 5 × 0.00003 = 0.00015)  PASS
Wallet request → SAME account deducted ................ PASS   (no credit_balances)
Unknown key → 401 (no anonymous downgrade) ............ PASS
No credit_balances dependency (wallet never written) .. PASS
```
| Metric | Value |
|---|---|
| request count | 5 |
| usage count | 5 |
| balance before deposit | 0 |
| balance after deposit | 1.00000 |
| balance after 5 requests | 0.99985 |
| deduction per request | 0.00003 |
| total deducted | 0.00015 |

**Verified properties:** api_credits authoritative · no Redis dependency · no
credit_balances dependency · no anonymous downgrade · no double deduction.
(Test rows were deleted; production left clean.)

> NOTE — pending the flag flip: this proves the *module* on real data. The
> end-to-end HTTP path proof requires `CREDIT_CANONICAL=true`, which is gated below.

---

## Phase 4 Dry-Run Report — credit_balances → api_credits (NO commit)

Read-only reconciliation via `scripts/cz_dryrun.mjs`:

| Store | Rows | Funded balance |
|---|---|---|
| `credit_balances` | 1 | **0.59993 USDT** (1 funded wallet) |
| `api_credits` | 10 accts (4 with wallet) | 0.0 |

| Reconciliation item | Value |
|---|---|
| accounts migrated (wallet already has api_credits acct) | 0 |
| **orphan balances** (funded wallet, no acct → would mint key) | **1 ($0.59993)** |
| duplicate wallets (api_credits wallet bound to >1 key) | 1 |
| funded credit_balances total | 0.59993 |
| would migrate (matched + orphan) | 0.59993 |
| **reconciliation DELTA** | **0** |

**Verdict:** delta == 0 → the backfill *would* reconcile exactly. Per the
instruction ("run dry-run only, do not commit"), the backfill was **not executed**.

**Two items to resolve before committing the backfill:**
1. The single funded balance is an **orphan** ($0.59993, likely a real
   wallet-funded user — a Customer Zero candidate). Backfill mints a bound
   `sk_live` account for it. This must run **before** the flag flip.
2. **1 duplicate wallet** (a wallet bound to 2 api_credits keys). `resolveAccount`
   already disambiguates deterministically (oldest key, `ORDER BY created_at ASC`),
   but confirm that's the intended owner before relying on it.

---

## Rollback plan

| Layer | Rollback |
|---|---|
| **Flag (when enabled)** | set `CREDIT_CANONICAL=false` in Railway → next request uses legacy path. The flag is read per-request (`process.env` at call time); a redeploy/restart applies it. Effectively instant. |
| **Phase 2/3 code (PR #169)** | `git revert` the squash merge → redeploy. Flag-off path is already legacy-equivalent, so revert is low-risk. |
| **Phase 1 module (PR #168)** | unused unless the flag is on; revert independently. |
| **Phase 0 surface (#166/#167)** | independent; reverting would re-introduce the 404s — not recommended. |
| **Backfill (when run)** | each migrated row tagged `source='migration'` in `api_deposits`; a reversal script deletes those deposit rows and subtracts the migrated amount from `api_credits.credits_usdt`. `credit_balances` is left intact (read-only) during cutover, so it remains the fallback ledger until soak passes. |

No rollback has been needed — production behavior is unchanged (flag off).

---

## What I need to proceed (next gates)

1. **Approve backfill commit** — delta is 0; run `cz_dryrun`'s write-mode sibling to
   migrate the 1 orphan ($0.59993) into a minted `sk_live` account, then re-reconcile.
2. **Then approve `CREDIT_CANONICAL=true`** — after backfill, flip the flag and run
   live HTTP validation (funded test key → real `POST /rpc/polygon` → observe
   deduction + usage), returning the request/usage/balance numbers.

Both are held pending your explicit go (money-path gates).
