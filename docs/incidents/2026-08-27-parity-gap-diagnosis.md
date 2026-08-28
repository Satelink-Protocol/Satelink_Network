# Parity gap diagnosis (Phase 3) — DIAGNOSE ONLY, repair is STOP-2

Ledger parity is 50%: 2 real (`is_test_data=false`) revenue events, 1 ledger txn, drift 1.
The unmatched event is x402 payment `0x485035ad…` ($0.10).

## 3.1 The x402 → ledger shadow-write path (file:line)
```
apps/api/src/payments/x402/settlement.js:108  INSERT revenue_events_v2 (the payment)
apps/api/src/payments/x402/settlement.js:114  shadowWriteRevenueLedger(pool, {requestId:`x402:${txHash}`, amountUsdt, isTestData})
apps/api/src/ledger/shadow_ledger_write.js:99  return {written:false,reason:'flag_off'}   if LEDGER_SHADOW_WRITE != 1
                                        :104  return ...'test_data_excluded'            if isTestData===true (inv #10)
                                        :115  return ...'non_positive_or_invalid_amount'
                                        :127  return ...'unknown_asset'                 if the chain/asset is unmapped
                                        :152  INSERT ledger_entries (balanced debit+credit) against acct_platform_* (migration 005)
```

## 3.2 Field-by-field — the two rows are identical except TIME
| field | 0x4850… (unmatched) | 0x7bc6… (matched) |
|---|---|---|
| amount_usdt | 0.10 | 0.10 |
| chain | eip155:8453 (Base) | eip155:8453 (Base) |
| is_test_data | false | false |
| source | x402 | x402 |
| **created_at** | **2026-07-26 19:58:36** | **2026-08-01 21:28:31** |
| ledgered | **no** | yes |

**The only divergence is the date — 6 days.** Same amount, same chain, same test flag.

## 3.3 Root cause + is it still live? — HISTORICAL, not live
`0x4850…` predates the shadow-ledger infrastructure:
- `003_ledger_entries.sql` (the ledger table) applied **2026-08-01 07:32**.
- `005_system_accounts.sql` (`acct_platform_revenue`/`_suspense`, the accounts the shadow
  writer books against) applied **2026-08-01 21:00**.
- `0x4850…` was created **2026-07-26** — five days before the ledger table existed and before
  the accounts existed. There was literally no ledger to write to.
- `0x7bc6…` (2026-08-01 21:28) came **after** both migrations and with `LEDGER_SHADOW_WRITE`
  on → it was ledgered.

**Could a payment TODAY hit the same gap? No.** `LEDGER_SHADOW_WRITE` is on, the ledger
schema and accounts exist, and the shadow writer only skips `is_test_data=true` /
non-positive / unknown-asset. **Behavioral proof: `0x7bc6…` — identical chain, amount, and
test flag — IS ledgered.** A fresh $0.10 Base x402 payment follows the `0x7bc6…` path, not
the `0x4850…` path. The gap is a one-time historical artifact of the pre-ledger era.
(A CI test asserting `shadowWriteRevenueLedger` writes for a `0x4850…`-shaped event belongs
with the shadow-writer tests; it cannot run here — Docker is unavailable — but the live
`0x7bc6…` row is the equivalent proof against the current code.)

**Caveat worth watching:** the gap only closes for chains/assets the writer's asset-mapper
recognizes. If a real customer pays on a chain the mapper doesn't map → `unknown_asset` →
revenue event with no ledger txn, silently, the day dry-run flips off. That mapper coverage
should be an explicit test per supported x402 chain.

## 3.4 Time-unit bug (scope only, do NOT fix here)
`ledger_parity.js` returns, in the SAME response:
- `oldest_unmatched.created_at` = `revenue_events_v2.created_at` — bigint **SECONDS** (e.g. 1785095916), line 67.
- `ts` = `Date.now()` — **MILLISECONDS**, line 87.
Consumers comparing the two are off by 1000×. Same mixing pattern exists wherever a handler
returns a raw `revenue_events_v2.created_at` (seconds) next to `ts: Date.now()`. Grep hits to
review (not fixed in this PR): `internal/ledger_parity.js`, `ledger/draw_parity.js`,
`admin/admin_router.js`, `workloads/mev_relay/index.js`. Fix = normalize `created_at` to ms
(`created_at * 1000`) at the response boundary, in a dedicated PR.

## 3.5 Proposed repair — COMPENSATING ENTRY (STOP-2, do NOT execute)
The ledger is append-only (inv #5); we do NOT backfill or UPDATE. To reconcile `0x4850…`,
append a NEW balanced ledger transaction booked against the same system accounts:
```
ledger_txns:  txn_id='shadow:x402:0x4850…', kind='deposit', ref_type='revenue_event',
              ref_id='x402:0x485035ad…', currency='USDC'
ledger_entries: debit  acct_platform_suspense  100000 (minor, USDC 6dp = $0.10)
                credit acct_platform_revenue   100000
```
This is a compensating APPEND (the payment really happened on-chain), not a rewrite — it
makes parity 2/2 while preserving append-only. It must be driven through the shadow-writer /
domain path (like the revocation ops script), not raw SQL. **STOP-2: do not execute; await
the decision on whether to reconcile a $0.10 founder payment vs leave the drift documented.**
