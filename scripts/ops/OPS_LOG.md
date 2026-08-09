# Ops Log

## 2026-08-06 — M6.5 production fixture cleanup

Deleted 20 integration-fixture rows from production.

Cause: integration suite read DATABASE_URL instead of TEST_DATABASE_URL,
writing fixture data into the production database.

Rows deleted:
- ledger_entries: 2 (txn_id = 'txn_uow_1')
- settlements: 4 (draw_id IN draw_uow_1, draw_s1, draw_s2, draw_s3)
- draws: 4 (draw_uow_1, draw_s1, draw_s2, draw_s3)
- authorization_nonces: 0 (none existed for fixture auths)
- authorizations: 2 (auth_uow, auth_d)
- funding_sources: 2 (fs_uow, fs_d)
- accounts: 3 (acct_d, acct_uow, acct_revenue)
- principals: 3 (prn_d, prn_uow, sys_root)

Real x402 txn 0x7bc61296168bbd5ef3f8e1ca9b86ce845d73f15219f915680dd58d6e6ddc1f63
unaffected. Two shadow ledger entries on acct_platform_suspense (debit 100000)
and acct_platform_revenue (credit 100000) confirmed intact.

Ledger append-only is absolute from this point.

## 2026-08-10 — Anonymous free-tier RPC cut to 402-challenge-only

Anonymous free-tier RPC cut to 402-challenge-only. Anonymous = a request
carrying NONE of x-api-key, authorization, x-admin-key, x-admin-token,
x-enterprise-key, x-payer-address, x-wallet-address, payment-signature,
x-payment (headers) or api_key, token (query). Such callers now get 0 free
calls (default) — the existing x402 402 payment challenge on the first
request. Challenge body unchanged. Gate only on /rpc; /health and all
liveness endpoints are ungated and unaffected. Only free_tier_gate.js
touched (anonymous branch); no payments/ changes.

Rollback: set FREE_TIER_ANON_CALLS=<n> in Railway (read at request time →
takes effect on the restart the env change triggers, no code redeploy).
FREE_TIER_ANON_CALLS=500 restores the prior per-IP behavior exactly.

Baseline before: 238 GB/mo, $12.07, ~8 GB/day. Funnel issued=35,578,746
attempts=7 settlements=4. Re-measure 2026-08-12.

Known consequence: chainlist.org / erpc public-RPC listings will begin
failing health checks (their anonymous probes to /rpc now 402); the free
public-RPC distribution surface is being retired.
