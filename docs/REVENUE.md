# Satelink Revenue — Canonical Reference
Last verified: 2026-06-26 (psql against Railway `Postgres-iQeW`). Supersedes prior revenue/
billing/settlement notes for live numbers.

## Revenue chain
```
RPC request
  → freeTierGate (apps/api/app_factory.mjs)   rate-limit free IPs; paid keys bypass
  → rpc_gateway executes call                 proxies to Polygon node(s)
  → credits.js deducts per call               $0.00003/call from api_credits
  → revenue_events_v2 row (is_test_data=false) the canonical "real billed call" record
  → epoch aggregation (epoch_scheduler.js)    rolls events into epochs (~every 10 min)
  → settlement_batches                        per-epoch rollups, on-chain when funded
  → RevenueVault 0x80AF… (Polygon 137)        USDT settlement target
```

## Current state (VERIFIED 2026-06-26)
- **Real revenue: $0.00003 total** — `revenue_events_v2` has exactly **1** non-test row
  (`amount_usdt=0.00003`, epoch 29077). Today $0; month-to-date $0.00003.
- `api_credits`: 17 keys (16 free, 1 paid). Deposited **$0.59993**, spent **$0.00006**,
  outstanding **$0.59987**. One near-Customer-Zero deposited ~$0.60 and consumed $0.00006.
- `settlement_batches` (2,053 rows): **1,954 `blocked_unfunded`** ($294.29), **98 `confirmed`**
  ($14.78, real tx hashes), **1 `pending`** ($0.15).
- `epochs`: max id 35,387; 27,933 phantom of 35,331 (phantom epochs excluded from revenue).
- **Reconciliation gap:** the $14.78 "settled" derives from internally-aggregated epoch
  rollups, NOT from `revenue_events_v2` ($0.00003). Do not present settled $ as customer revenue.
- ~14.8k req/24h from ~1,463–5,957 active IPs convert to **$0 billed** — ~100% free-tier.

## Billing rate
`$0.00003 / call` (`PRICE_PER_CALL`). Surfaced by `/admin/revenue/summary` and `/admin/config`.

## Canonical credit store
`api_credits` (keyed by `api_key`) is the source of truth for customer credit balances:
`credits_usdt` (remaining), `total_deposited`, `total_spent`, `tier`, `wallet_address`.
Deposits land in `credit_deposits` (wallet/tx) and `api_deposits` (api_key/tx).

## Settlement conditions (ALL required before `SETTLEMENT_DRY_RUN=0`)
1. Signer `0x988fb0efC0f14111511dE3481E6c066018A0cf91` funded (currently `signerBalance=null`).
2. Real revenue > `MIN_ANCHOR_REVENUE_USDT` ($0.50). Currently $0.00003 — far below.
3. Explicit human decision. **Never flip `SETTLEMENT_DRY_RUN` autonomously.**
Until then the anchor aggregates but broadcasts nothing → the 1,954 `blocked_unfunded` batches.

## Known incident — INC-013 (signer drain)
`1,878 TX` signer drain is a historical fact. It must **never** appear as a fabricated live
UI metric. The phantom-epoch filter (`is_phantom`) and `is_test_data` filtering were added to
keep test/phantom volume out of real revenue (INC-014).

## Customer Zero acquisition path
1. Identify lead from `developer_intel` (top: Rica Web Services, `38.49.212.250`).
2. Outreach (Brevo) → deposit USDT to RevenueVault → `credit_deposits` → `api_credits` credited.
3. Provision API key (`/api/keys`) so the customer can spend credits on `/rpc`.
4. Billed calls land in `revenue_events_v2`; once real revenue > $0.50 and signer funded,
   settlement can be enabled. See `docs/CUSTOMER_ZERO.md`.

## How to read real revenue (read-only)
```sql
SELECT COUNT(*) FILTER (WHERE NOT is_test_data) real_events,
       COALESCE(SUM(amount_usdt) FILTER (WHERE NOT is_test_data),0) real_usdt
FROM revenue_events_v2;
```
