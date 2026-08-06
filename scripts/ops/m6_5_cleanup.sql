-- m6_5_cleanup.sql
-- M6.5: Delete integration-fixture rows leaked into production.
--
-- Cause: integration suite read DATABASE_URL instead of TEST_DATABASE_URL.
-- Delete order derived from FK graph (children before parents):
--
--   settlements → draws
--   draws → authorizations, funding_sources, accounts, principals
--   ledger_entries → accounts
--   authorization_nonces → authorizations
--   authorizations → funding_sources, principals
--   funding_sources → principals
--   accounts → principals
--   principals (self-ref via parent_id)
--
-- REAL DATA preserved: the shadow:x402:0x7bc61296… ledger entries on
-- acct_platform_suspense and acct_platform_revenue (amount 100000 each).
--
-- Run with ROLLBACK first. Only change to COMMIT after verifying counts.

BEGIN;

-- 1. Ledger entries for fixture txn
DELETE FROM ledger_entries WHERE txn_id = 'txn_uow_1';

-- 2. Settlements referencing fixture draws
DELETE FROM settlements WHERE draw_id IN ('draw_uow_1','draw_s1','draw_s2','draw_s3');

-- 3. Draws
DELETE FROM draws WHERE id IN ('draw_uow_1','draw_s1','draw_s2','draw_s3');

-- 4. Authorization nonces (FK child of authorizations)
DELETE FROM authorization_nonces WHERE authorization_id IN ('auth_uow','auth_d');

-- 5. Authorizations
DELETE FROM authorizations WHERE id IN ('auth_uow','auth_d');

-- 6. Funding sources
DELETE FROM funding_sources WHERE id IN ('fs_uow','fs_d');

-- 7. Accounts (fixture only — NOT platform system accounts)
DELETE FROM accounts WHERE id IN ('acct_d','acct_uow','acct_revenue');

-- 8. Principals (fixture only — NOT prn_platform)
DELETE FROM principals WHERE id IN ('prn_d','prn_uow','sys_root');

-- ───────────────────────────────────────────────────────
-- VERIFICATION BLOCK
-- Expected after cleanup:
--   principals      10
--   accounts        11
--   draws            0
--   authorizations   0
--   funding_sources  0
--   settlements      0
--   ledger_entries   2
-- The 2 remaining ledger_entries must be the real x402 shadow entries.
-- ───────────────────────────────────────────────────────

SELECT 'principals'      AS tbl, count(*) FROM principals
UNION ALL
SELECT 'accounts'        AS tbl, count(*) FROM accounts
UNION ALL
SELECT 'draws'           AS tbl, count(*) FROM draws
UNION ALL
SELECT 'authorizations'  AS tbl, count(*) FROM authorizations
UNION ALL
SELECT 'funding_sources' AS tbl, count(*) FROM funding_sources
UNION ALL
SELECT 'settlements'     AS tbl, count(*) FROM settlements
UNION ALL
SELECT 'ledger_entries'  AS tbl, count(*) FROM ledger_entries;

-- Show the surviving ledger entries (should be shadow:x402 pair)
SELECT id, txn_id, account_id, direction, amount, currency, state, ref_type, ref_id, idem_key
FROM ledger_entries
ORDER BY id;

COMMIT;
