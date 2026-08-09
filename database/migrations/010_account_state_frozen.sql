-- 010_account_state_frozen.sql
-- Fix: accounts_state_check (added in 009) omitted the valid 'frozen' state.
--
-- The Account aggregate's state machine is open <-> frozen -> closed
-- (libs/financial-domain/src/account/account-state.ts, AccountStateValue =
-- 'open' | 'frozen' | 'closed'). The Postgres AccountRepository persists
-- state.value directly (account-mapper: state = a.state.value), so a normal
-- freeze() transition writes 'frozen'. Migration 009's constraint only allowed
-- ('open','closed'), so freezing an account failed with:
--
--   new row for relation "accounts" violates check constraint
--   "accounts_state_check"
--
-- That is a production bug, not a test-fixture issue: the repository — not
-- just the test — writes 'frozen'. Widen the constraint to the full domain
-- vocabulary. ADDITIVE with respect to data: 'open' and 'closed' rows remain
-- valid; 'frozen' becomes valid too.

ALTER TABLE accounts DROP CONSTRAINT accounts_state_check;

ALTER TABLE accounts ADD CONSTRAINT accounts_state_check
    CHECK (state IN ('open', 'frozen', 'closed'));
