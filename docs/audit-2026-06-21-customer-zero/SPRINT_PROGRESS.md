# Customer Zero P0 Recovery — Implementation Progress

Sprint executing `P0_RECOVERY_PLAN.md`. Updated 2026-06-21.

## Status by phase

| Phase | Scope | Status | Evidence |
|---|---|---|---|
| **0** | Deploy hardened /api/keys surface; remove prod 404s | ✅ **DONE — deployed & verified** | PRs #166, #167 merged to main → Railway |
| **1** | Build `creditService` (canonical api_credits) | ✅ **DONE — deployed (unwired)** | PR #168; 17 unit tests green |
| **2** | Serving path authorizes via api_credits | ⏸️ **STOPPED at boundary** (live money-path change) | — |
| **3** | Usage metering per paid request | ⏸️ pending (lands with Phase 2) | — |
| **4** | Deposit integration + **credit_balances→api_credits backfill** | ⏸️ **DATA-MIGRATION STOP** | — |
| **5** | Settlement dust rollup | ⏸️ pending | — |

> Stopped per instruction ("stop after each phase if data migration risk appears").
> Phase 2 changes the production RPC serving path's authorization/deduction; Phase 4
> is the irreversible balance backfill. Both need explicit go-ahead.

## Phase 0 — deployed & verified

Hardened `/api/keys` surface live in production (was 404):

```
GET  /api/keys/usage          → 200
GET  /api/keys/deposit-info    → 200
GET  /api/keys/deposits        → 200   {"ok":true,"deposits":[]}
GET  /api/keys/usage-history   → 200
POST /api/keys/deposit (no tx) → 400   (tx_hash required — correct)
```
Includes deposit ownership binding (P0-6), 25-confirmation depth, X-API-Key header
transport (P0-3 → key no longer in URL), per-key rate limiters, generic errors.
Follow-up #167 ensures `api_deposits` at startup (fixed a `/deposits` 500).
**No serving-path change.** 19 security tests green.

## Phase 1 — creditService (deployed, unwired)

`apps/api/src/billing/credit_service.mjs` — the single module all credit
reads/writes will flow through:
- `resolveAccount(apiKey | wallet)` → one account, one balance (key & wallet both
  resolve to the same `api_credits` row).
- `authorizeAndMeter()` → daily-limit gate (429) + **atomic** balance deduct (402)
  + usage metering, in one call. Atomic `UPDATE ... WHERE credits_usdt >= cost`
  cannot go negative under concurrency.
- `creditAccount()` → shared by manual deposit **and** DepositListener; idempotent
  on `tx_hash` (no double-credit).

Deployed but **not yet called by the serving path** — zero behavior change
(verified: `/health` ok, `POST /rpc/polygon` still 200 after deploy).

### Verification evidence (Phase 1 unit tests — 17 passing)
The four sprint-required guarantees are pinned by tests:
- **credits deducted per request** — paid tier deducts exactly one call cost; 402 at zero; never negative at exact boundary.
- **usage recorded per request** — `api_usage_daily.request_count` increments on every served call (free and paid).
- **deposit increases balance** — manual + wallet-resolved deposits both raise the *same* account; same `tx_hash` credits once.
- plus: unknown key → **401** (no silent anonymous downgrade — directly fixes audit P0-2), inactive → 403, daily limit → 429.

## Before / After architecture

### BEFORE (audit finding — 3 disconnected systems)
```
customer → /api/keys → api_credits      (balance, tier, limit)   ─┐  NEVER read by serving
                                                                   │
serving  → checkRateLimit → Redis rpc:apikey:*  (unknown key → anonymous IP 500/day)
serving  → creditGate    → credit_balances (wallet only, x-wallet-address)
usage    → api_usage_daily  (never incremented by serving → always 0)
```
Result: paid limits unenforced, deposited credits never consumed, usage always 0.

### AFTER (target — api_credits is the ONLY source of truth)
```
                         ┌──────────────  api_credits  (CANONICAL)  ─────────────┐
   X-API-Key  ───────────┤  api_key · wallet_address · tier · daily_limit ·       │
   x-wallet-address ──────┤  credits_usdt · total_deposited · total_spent · status │
                         └──────────────────────┬───────────────────────────────┘
                                                │ via creditService
   serving POST /rpc/:chain ──► authorizeAndMeter() ──► 429 | 402 | ok+deduct+meter
   /api/keys/deposit ─┐
   DepositListener   ─┴──► creditAccount() ──► same balance (idempotent on tx)
   Redis rpc:apikey/usage ──► read-through CACHE of api_credits (not a store)
   credit_balances ──► migrated into api_credits, then frozen   (Phase 4)
```

## Migration results so far
- **No data migrated yet.** Phases 0–1 are additive code only.
- Schema: `api_deposits` now ensured at startup (additive, idempotent CREATE IF NOT EXISTS).
- The `credit_balances → api_credits` backfill (M3) has **not** run — it is the
  Phase 4 data-migration stop point (requires dry-run reconciliation to the cent
  before commit, per the plan's R1/R2 risk gates).

## Next actions (await go-ahead)
1. **Phase 2/3:** wire `rpc_gateway.js` POST handler to `creditService.authorizeAndMeter`
   behind `CREDIT_CANONICAL` (deploy flag-OFF = no change; flip ON to cut over).
   Live-verify on a funded test key: deduct-per-call, usage reflects, 402 at zero.
2. **Phase 4:** dry-run `credit_balances → api_credits` backfill; reconcile sums;
   then wire DepositListener → `creditAccount`.
3. **Phase 5:** settlement dust rollup + hot-wallet precheck.
