# Customer Zero — P0 Recovery Sprint Plan

> **STATUS: ARCHITECTURE REVIEW — DO NOT IMPLEMENT UNTIL APPROVED.**
> No `apps/` code is modified by this document. It is the design to approve before
> the fix sprint. Scope is **backend money-path only** — no UI, no Grafana, no
> Design System work.
> Companion: [`CUSTOMER_ZERO_READINESS.md`](CUSTOMER_ZERO_READINESS.md).

---

## 1. Complete path trace (Create Key → Settlement)

Each step: what runs today, which store it touches, and the break.

| Step | Code (file:line) | Store touched today | Break |
|---|---|---|---|
| **Create Key** | `api_keys_route.mjs:58` → `createApiKeyWithCredits` (`credit_system.mjs:64`) | **`api_credits`** (Postgres) | none — works (live-verified) |
| **Deposit (manual)** | `api_keys_route.mjs:137` `POST /deposit` (tx_hash) | **`api_credits`** + `api_deposits` | **404 in prod (undeployed)**; even so credits a store serving never reads |
| **Deposit (on-chain auto)** | `deposit_listener.js` (DepositListener) | **`credit_balances`** + `credit_deposits` | credits a *different* store (wallet, system C) than the key (system A) |
| **Credits check/deduct** | serving `credit_gate.js:44` | **`credit_balances`** (wallet) — only if `x-wallet-address` present | API-key callers skip it entirely; `api_credits.credits_usdt` never read/decremented |
| **Usage / rate-limit** | serving `rate_limiter.js:106` `checkRateLimit` | **Redis `rpc:apikey:*` / `rpc:usage:*`** (system B) | Postgres key absent from Redis → anonymous IP tier; paid `daily_limit` never enforced |
| **Usage metering** | `incrementDailyUsage` (`credit_system.mjs:121`) | **`api_usage_daily`** | never called on serving path → always 0 |
| **Billing** | `rpc_billing.js:73` `recordRpcRevenue` | **`revenue_events_v2`** | fires unconditionally at list price on free traffic → phantom |
| **Epoch** | `epoch_scheduler.js` / `epoch_aggregator.js` | `epoch_ledger` | works; aggregates phantom revenue |
| **Settlement** | `settlement_anchor_job.js:100` | `epoch_ledger` → chain | dust-gated (`>=1.0` USDT vs ~0.0025/epoch, no rollup) → never fires |

**The fracture:** the customer authenticates and pays into **system A (`api_credits`)**;
the serving path authorizes and meters against **system B (Redis) + system C
(`credit_balances`)**. A is never read on the hot path (`credit_system.mjs` is
imported by exactly one file — `api_keys_route.mjs`).

---

## 2. All stores (full inventory)

### On the customer pay-per-use path (in scope)
| Store | Type | Identity | Holds | Written by | Read by serving? |
|---|---|---|---|---|---|
| **`api_credits`** (A) | Postgres | api_key (+ optional wallet) | balance, tier, daily_limit, total_deposited/spent | `/api/keys` create + `/deposit` | **NO** |
| **`api_usage_daily`** (A) | Postgres | api_key | per-day request_count, usdt_spent | `incrementDailyUsage` (never called by serving) | NO |
| **`api_deposits`** (A) | Postgres | api_key | manual tx_hash deposit ledger | `/api/keys/deposit` | n/a |
| **`credit_balances`** (C) | Postgres | wallet | balance, total_deposited/spent | `/credits` + DepositListener | **YES** (`credit_gate`) |
| **`credit_deposits`** (C) | Postgres | wallet | on-chain deposit ledger | DepositListener | n/a |
| **Redis `rpc:apikey:*`** (B) | Redis | api_key | tier + status (cache) | `rate_limiter.js` / `gateway/routes/api_keys.js` | **YES** (`checkRateLimit`) |
| **Redis `rpc:usage:*` / `sdk:usage:*` / `ft:<ip>`** (B) | Redis | api_key / ip | hot usage + free-tier counters | serving `incrementUsage`, `free_tier_gate` | YES |
| **`revenue_events_v2`** | Postgres | client_id (api_key/'public') | immutable billing event log | `recordRpcRevenue` | n/a (downstream) |
| **`rpc_usage_hourly`** | Postgres | aggregate | rollup for retention | aggregation job | n/a |

### Adjacent stores — explicitly OUT of scope (do not touch this sprint)
| Store | Purpose | Why excluded |
|---|---|---|
| `api_keys`, `enterprise_api_keys` | dashboard/session auth + enterprise keys | separate auth surface, not the RPC pay path |
| `rpc_api_keys` | Postgres mirror of Redis B keys | folds into the Redis-as-cache decision, not a new balance |
| `sla_credits` | enterprise SLA credit | enterprise contract path, post-Customer-Zero |
| `economic_account_balances`, `economic_ledger_*` | double-entry accounting/audit | reporting layer; consumes events, not the gate |

> Note: `api_keys`/`enterprise_api_keys` being a *third* key namespace is real tech
> debt (P1-2 in the audit) but is not required for the first paying customer. The
> canonical model below reserves room to absorb it later without rework.

---

## 3. Canonical architecture — ONE source of truth

**Decision: `api_credits` is the single source of truth for account identity,
balance, tier, limits, and usage.** Everything else becomes a feeder, a cache, or a
downstream log.

### 3.1 The account model
Treat `api_credits` as an **account** keyed by `api_key`, with an optional **bound
wallet**. Both authentication methods resolve to the same account and the same
balance:

```
                       ┌──────────────────────────────────────────┐
                       │   api_credits  = THE ACCOUNT (canonical)   │
                       │   api_key (PK) · wallet_address (unique?)  │
                       │   tier · daily_limit · balance_usdt        │
                       │   total_deposited · total_spent · status   │
                       └──────────────────────────────────────────┘
        resolve by api_key ▲                          ▲ resolve by wallet
                           │                          │
   X-API-Key caller ───────┘                          └─────── x-wallet-address caller
                           │                          │
                           ▼                          ▼
                ┌───────────────────────────────────────────────┐
                │   creditService  (NEW single module)           │
                │   resolveAccount(apiKey | wallet)              │
                │   authorizeAndDeduct(account, method) → ok|402 │
                │   recordUsage(account)  → api_usage_daily       │
                └───────────────────────────────────────────────┘
   feeders ─────────────────────────────────────────────────────────── downstream
   • /api/keys/deposit (manual tx)  ─┐                         ┌─ revenue_events_v2 (PAID only)
   • DepositListener (on-chain) ─────┼─► credit account        │     └─► epoch_ledger ─► settlement
     (resolve wallet → account)      │   (balance += amount)   │
   • Redis rpc:apikey/usage  ◄───────┘ read-through CACHE of    └─ rpc_usage_hourly (rollup)
                                        api_credits (not a store)
```

### 3.2 Role of each store after canonicalization
| Store | New role |
|---|---|
| **`api_credits`** | **canonical account + balance + tier + limit** (source of truth) |
| **`api_usage_daily`** | **canonical usage** (incremented per served request) |
| **`api_deposits`** | canonical deposit ledger (both manual + on-chain auto write here) |
| **`credit_balances`** | **deprecated as a balance store** → migrated into `api_credits`; kept read-only during cutover, then frozen |
| **Redis `rpc:apikey:*` / `rpc:usage:*`** | **cache only** — populated from `api_credits`; authoritative limit/balance always reconciles to Postgres |
| **DepositListener** | resolves `wallet → api_credits` account and credits the account (no longer a separate balance) |
| **`revenue_events_v2`** | records **paid** calls only (or flags paid vs free) → clean epoch input |

### 3.3 Two non-negotiable invariants
1. **One balance per account, deducted exactly once per request**, regardless of
   whether the caller used `X-API-Key` or `x-wallet-address`.
2. **The serving path reads `api_credits` (via cache) for authorization** — never an
   independent store that the customer can't see.

---

## 4. Migration plan (Current → Canonical)

Phased, each step reversible, no balance lost or double-counted.

### M1 — Schema reconcile (additive only)
- Ensure `api_credits` has: `balance_usdt` (alias of/keep `credits_usdt`),
  `wallet_address` UNIQUE (nullable), `status`. Add `source_wallet` to `api_deposits`.
- No drops. Backfill nothing yet.

### M2 — Build `creditService` (new module, not yet wired)
- `resolveAccount({apiKey, wallet})`, `authorizeAndDeduct(account, method)` (atomic
  `UPDATE ... WHERE balance >= cost RETURNING`), `recordUsage(account)`,
  `creditAccount(accountRef, amount, txHash)`.
- Pure unit tests (mirror the existing `deposit_validation` test style).

### M3 — Backfill `credit_balances` → `api_credits`
- For each `credit_balances` wallet: find the `api_credits` row with that
  `wallet_address`; if none, mint a `sk_live` account bound to the wallet.
- `api_credits.balance += credit_balances.balance`; record a reconciling row in
  `api_deposits` (`source='migration'`). Idempotent (keyed on a migration marker).
- Dry-run report first (counts, sum of balances in vs out) — must reconcile to the
  cent before commit.

### M4 — Cut the serving path over to `creditService`
- Replace `credit_gate.js` deduction with `creditService.authorizeAndDeduct` that
  resolves **both** `X-API-Key` and `x-wallet-address` to the same account.
- Replace `rate_limiter.checkRateLimit` lookup so an unknown Redis key **falls back
  to `api_credits`** (then caches), instead of anonymous IP tier.
- Add `creditService.recordUsage` (→ `api_usage_daily`) on every served call.
- Feature-flag (`CREDIT_CANONICAL=on`) for instant rollback to old path.

### M5 — Redirect deposit feeders
- `/api/keys/deposit` and `DepositListener` both call `creditService.creditAccount`
  (DepositListener resolves wallet→account). `credit_balances` becomes read-only.

### M6 — Billing truth
- `recordRpcRevenue` records `revenue_events_v2` only when a real deduction occurred
  (or sets `paid=true/false`), so epochs aggregate **collected** revenue.

### M7 — Settlement can fire
- Implement dust-epoch **rollup**: aggregate sub-threshold epochs into a batch anchor
  once cumulative `>= MIN_ANCHOR_REVENUE_USDT`, OR lower threshold for real (paid)
  revenue. Verify hot wallet holds USDT + MATIC for the anchor tx (precheck + alert).

### M8 — Freeze deprecated stores
- After a soak window with reconciliation green, mark `credit_balances` frozen;
  Redis B is cache-only. Keep both for audit; no new writes.

---

## 5. Verification strategy (the four required checks)

Each is a concrete, runnable test (unit + live curl against staging), gated before GA.

| Requirement | How verified |
|---|---|
| **Credits deducted per request** | Unit: `authorizeAndDeduct` decrements once and returns 402 at zero. Live: fund a test account $0.01, fire N paid calls, assert `balance == 0.01 − N×price` and call N+1 → **402**. |
| **Usage recorded per request** | Live: from 0, fire N calls with `X-API-Key`, assert `api_usage_daily.request_count == N` and `/api/keys/usage` reflects N (the audit showed this is currently always 0). |
| **Deposit increases balance** | Live: submit a real (or staging-mock) tx via `/api/keys/deposit` AND simulate a DepositListener event for a bound wallet; assert **both** raise the *same* `api_credits.balance` (no double-count, no split). |
| **Settlement can trigger** | Unit: dust-rollup aggregates K sub-threshold epochs and emits one anchor when cumulative ≥ threshold. Live (staging signer): force an epoch/batch over threshold → assert an on-chain tx hash appears in `/api/settlement/history` (currently always null). |

Plus regression: existing 19-test `api_keys_security` suite stays green; curl
`/health`, `/api/status`, `/credits/deposit/initiate` still 200.

---

## 6. Deliverables

### 6.1 P0 Fix Plan (maps audit P0 → fix)
| Audit P0 | Fix | Migration step |
|---|---|---|
| **P0-1** deposit/usage surface 404 (undeployed/uncommitted) | commit working tree → merge to `main` → redeploy | precedes M1; **first action** |
| **P0-2** key not honored on serving | serving resolves key via `api_credits`; Redis as cache | M4 |
| **P0-3** credits never consumed | `creditService.authorizeAndDeduct` against `api_credits` | M2 + M4 |
| **P0-4** usage never metered | `creditService.recordUsage` → `api_usage_daily` per call | M4 |
| **P0-5** settlement can't fire | dust-rollup batch anchor + hot-wallet funding precheck | M7 |
| **P0-6** live deposit hijack/reorg | ships with P0-1 (hardened router already tested) | with P0-1 |

### 6.2 Risk Analysis
| # | Risk | L×I | Mitigation |
|---|---|---|---|
| R1 | **Double-credit during backfill** (wallet balance counted in both stores) | Med×High | M3 dry-run must reconcile sum-in == sum-out to the cent; idempotent migration marker; `credit_balances` read-only after backfill |
| R2 | **Lost balance** (wallet with no matching key dropped) | Low×High | M3 mints a bound account for orphan wallets; zero-drop assertion in dry-run |
| R3 | **Double-deduction per request** (both old gate + new service run) | Med×High | M4 replaces (not adds) the gate behind `CREDIT_CANONICAL`; single deduction path; idempotency key per `request_id` |
| R4 | **Cache incoherence** (Redis says allowed, Postgres says broke) | Med×Med | Postgres is authoritative for the deduction (atomic `WHERE balance>=cost`); Redis only pre-screens; short TTL + write-through on deposit |
| R5 | **Fail-open serves unpaid calls** under DB error | Med×Med | keep fail-open for *rate-limit*, but **fail-closed (402) for balance** on paid accounts; alert on DB error |
| R6 | **Deploying P0-1 exposes the new flow before serving cutover** | Med×Med | order: P0-1 first restores the *secure* deposit surface; balance just isn't consumed yet (no worse than today); M4 follows quickly |
| R7 | **Settlement spends real gas / USDT** once unblocked | Low×High | staging signer first; hot-wallet balance precheck + low-balance alert; keep `settlement_dry_run` switch |
| R8 | **Two auth identities map to two accounts** (key + wallet not linked) | Med×Med | enforce `wallet_address` UNIQUE on `api_credits`; resolveAccount binds on first deposit; reject ambiguous binds |
| R9 | **Phantom-revenue change breaks epoch math** | Low×Med | M6 behind flag; compare epoch totals pre/post on staging before cutover |

### 6.3 Implementation Order (strict)
```
0. P0-1  Commit + merge + deploy the hardened /api/keys surface     (unblocks deposit; resolves P0-6)
1. M1    Additive schema reconcile on api_credits / api_deposits
2. M2    Build creditService + unit tests                            (no wiring yet)
3. M3    Backfill credit_balances → api_credits (dry-run → commit)   (R1/R2 gates)
4. M4    Cut serving path to creditService behind CREDIT_CANONICAL   (fixes P0-2/3/4)
         → run the four verification checks on staging
5. M5    Redirect /api/keys/deposit + DepositListener to creditService
6. M6    Billing records paid-only revenue                           (clean epochs)
7. M7    Dust-rollup settlement + hot-wallet precheck                (fixes P0-5)
8. M8    Freeze credit_balances; Redis cache-only; soak + reconcile
```

**Gate between every step:** the four verification checks + regression suite green,
and (M3/M8) balance reconciliation to the cent. Flip `CREDIT_CANONICAL` off to roll
back M4–M6 instantly.

---

## 7. Open decisions for review
1. **Canonical = `api_credits`** (recommended) vs a new unified `accounts` table.
   Approve `api_credits` to avoid a bigger migration?
2. **Wallet→account binding:** auto-mint a bound account for orphan wallets in
   backfill (recommended) vs require manual claim. Approve auto-mint?
3. **Fail-closed on balance** under DB error for paid accounts (recommended) vs
   keep global fail-open. Approve fail-closed-for-balance?
4. **Settlement unblock:** dust-rollup batch (recommended) vs lower threshold.
   Approve rollup approach + confirm `MIN_ANCHOR_REVENUE_USDT`?
5. **Redis B:** demote to cache (recommended) vs keep as parallel store. Approve
   cache-only?
