-- 005_system_accounts.sql
-- M3: System accounts for the shadow ledger.
--
-- ADDITIVE ONLY. This migration seeds rows; it changes NO existing table,
-- constraint, or the account_balances view. Migrations 001–004 are untouched.
--
-- WHY (DECISION 3, founder 2026-08-01):
--   ledger_entries.account_id -> accounts(id) -> principals(id) are both
--   FK-enforced. The M3 shadow writer must reference accounts that exist, but
--   per-principal Account backfill is M4 and must NOT start here. So every
--   shadow transaction is booked against a single fixed pair of platform system
--   accounts instead of per-customer accounts:
--
--       debit  acct_platform_suspense   (debit-normal)
--       credit acct_platform_revenue    (credit-normal)
--
--   Balanced by construction. Parity is measured by transaction count and
--   summed credits (= shadowed revenue), not per-customer balances. When M4
--   introduces real per-principal accounts, the shadow writer can be repointed;
--   these system accounts remain valid.
--
-- IDs are STABLE and referenced by name from the shadow writer
-- (apps/api/src/ledger/shadow_ledger_write.js) and the parity endpoint.
-- Currency USDT/6 matches revenue_events_v2.amount_usdt.
--
-- ON CONFLICT DO NOTHING keeps this safe to run against a database that already
-- has the rows (defensive; the migration runner also guarantees single-apply).

INSERT INTO principals (id, kind, display_name, state)
VALUES ('prn_platform', 'platform', 'Satelink Platform', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, principal_id, kind, normality, currency, decimals, state)
VALUES
    ('acct_platform_revenue',  'prn_platform', 'revenue',  'credit', 'USDT', 6, 'open'),
    ('acct_platform_suspense', 'prn_platform', 'suspense', 'debit',  'USDT', 6, 'open')
ON CONFLICT (id) DO NOTHING;
