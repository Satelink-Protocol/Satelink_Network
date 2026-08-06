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
