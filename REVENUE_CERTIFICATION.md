# SATELINK — REVENUE CERTIFICATION

Date: 2026-06-21 · Method: production database reads (Postgres-iQeW, read-only) +
live API calls against `rpc.satelink.network`. All numbers are exact production
values. No estimates.

## VERDICT: ❌ FAIL

The chain **Deposit → Credits → Usage → Deduction → Revenue Event → Settlement
Candidate is NOT proven on production data.** The Credits→Deduction link has
**never executed** (zero deductions, ever), and revenue/settlement records are
**phantom** — disconnected from any deduction.

---

## Gating constraint (Task 1)

A real USDT deposit could **not** be performed: I have no funded wallet, no USDT,
and no private key to sign a Polygon transaction. Sending real money is outside
what I can do. The only funded balance in production is a **pre-existing migrated
record**, not a deposit made for this certification. Tasks 1–4 and 8 depend on a
fresh paid transaction that could not be created; Tasks 5–7 were verified against
existing production data.

---

## Exact production numbers (read from the live DB)

| Layer | Source | Value |
|---|---|---|
| RevenueVault deposited | `/api/treasury/status` | **$0.60** (1 wallet) |
| Legacy credit deposits | `credit_deposits` | 2 rows, **$0.600000** (real, SAT-240) |
| Keyed deposits | `api_deposits` | 1 row, **MIGRATED** (`migration_0x966e1ae2…`), **0 on-chain listener events** |
| Funded accounts | `api_credits` | 16 accounts |
| Credits deposited | `api_credits.total_deposited` | **$0.59993** |
| Credits remaining | `api_credits.credits_usdt` | **$0.59993** |
| **Credit deductions (all-time)** | `api_credits.total_spent` | **$0.00000000** |
| Paid usage rows | `api_usage_daily` (usdt_spent>0) | **0 rows** |
| Usage charges (all-time) | `api_usage_daily.usdt_spent` | **$0.00** (482 requests, all free) |
| Revenue events | `revenue_events_v2` | **40,748 events = $1.222440** (all 2026-06-21) |
| Epoch revenue (cumulative) | `epoch_ledger.total_revenue` | **$57.846390** (28,524 epochs) |
| Epochs anchored on-chain | `epoch_ledger.tx_hash` | **0** |
| Settlement batches | `settlement_batches` | **0** |
| Flags | Railway `Satelink-api` | `CREDIT_CANONICAL=true`, `SETTLEMENT_DRY_RUN=1`, `POLYGON_SIGNER_KEY` set |

---

## Task-by-task

**Task 1 — Real deposit:** ❌ Not performed (no wallet/funds/keys). Existing $0.60 is a
migrated record, not a live deposit.

**Task 2 — DepositListener:** ⚪ Unverifiable for a new deposit (none made).
`api_deposits` shows **1 migrated** row, **0 on-chain listener** events — the live
listen→credit path has no production evidence.

**Task 3 — Funded API key:** ◑ A funded key already exists
(`sk_live_f6d9…`, tier basic, **$0.599930** credits). A Billing page would render
this balance. But see Task 4 — the balance is **unspendable**.

**Task 4 — Generate paid traffic:** ❌ **FAILED.** One authenticated call with the
funded key returned **HTTP 402 `FREE_TIER_LIMIT_REACHED`** — the request was routed
through the **free-tier path, not credit deduction**, despite the key holding $0.60
and `CREDIT_CANONICAL=true`. No credits were consumed (balance unchanged). The DB
confirms this is systemic: **0 deductions across all 16 accounts, all-time.**
(Caveat: the gateway free-tier gate also rate-limits by IP; a funded key should
bypass it and deduct — it did not. Independent of IP, the all-time deduction total
is $0.)

**Task 5 — Accounting identity:** ❌ **BROKEN.** The required equality does not hold:
```
credit deductions   = $0.000000
usage charges        = $0.000000
revenue_events_v2    = $1.222440   (40,748 events)
epoch_ledger revenue = $57.846390
vault deposited      = $0.600000
```
Five layers that must reconcile disagree by orders of magnitude. Revenue events and
epoch revenue exist with **zero** underlying deductions or paid usage → phantom
revenue (the issue PR #171 targeted; the historical rows remain and the identity
still fails).

**Task 6 — Settlement candidate:** ❌ `epoch_ledger` holds **$57.85** cumulative
"revenue" across 28,524 epochs, but **0 anchored** (no `tx_hash`), **0
settlement_batches**, and `SETTLEMENT_DRY_RUN=1`. No revenue event traces to a real
deduction, so no legitimate settlement candidate exists. Epoch / candidate amount /
batch: **28,524 epochs / $0 real / 0 batches.**

**Task 7 — Treasury verification:** ❌ Do **not** agree:
RevenueVault/treasury **$0.60** vs revenue_events **$1.22** vs epoch revenue **$57.85**
vs settled on-chain **$0.00**. Collected (vault) ≠ recorded (events) ≠ aggregated
(epochs) ≠ settled (batches).

**Task 8 — 402 on funded account:** ◑ The funded account **does** 402 — but with the
**wrong reason** (`FREE_TIER_LIMIT_REACHED` while holding $0.60 credits; it should
deduct, not free-tier-block). The recovery payload is correct and live: vault
address, `minimum_deposit_usdt`, and `deposit_page → app.satelink.network/satelink/os/deposit`
(200). Recovery UX is sound; the trigger condition is wrong.

---

## Why FAIL (production truth)

1. **No real deposit could be made** (no funds/keys) — and none exists in the live
   listener path (`api_deposits` = 1 migrated, 0 on-chain).
2. **No credit deduction has ever occurred** — `total_spent = $0` across all 16
   accounts; the one funded key is free-tier-402'd instead of deducting.
3. **Revenue is phantom** — 40,748 events ($1.22) and $57.85 of epoch revenue with
   **zero** backing deductions or paid usage.
4. **Nothing settles** — 0 epochs anchored, 0 settlement batches, dry-run on.

The money path is wired (flags on, funded account, 402 recovery correct) but has
**never carried a single real billed transaction end-to-end** in production.
