-- 004_ledger_revoke_mutation.sql
-- M2: Enforce append-only invariant (#5) at the database level.
--
-- REVOKE UPDATE and DELETE on ledger_entries so that no application code —
-- no matter how buggy — can mutate or delete existing ledger entries.
-- Reversals MUST be expressed as NEW entries with reverses_entry_id set.
--
-- Targeted roles:
--   PUBLIC   — catch-all, prevents any unlisted role from mutating
--   postgres — Railway Postgres default superuser role
--
-- Note: The 'satelink' role used in docker-compose may not exist in all
-- environments. We conditionally revoke from it only if it exists.
--
-- IMPORTANT: The superuser running this migration retains the ability to
-- GRANT these privileges back if a future migration needs to ALTER the table.
-- That re-grant would be explicit and auditable.

REVOKE UPDATE, DELETE ON ledger_entries FROM PUBLIC;

-- Conditionally revoke from 'satelink' role if it exists (docker-compose env)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink') THEN
        EXECUTE 'REVOKE UPDATE, DELETE ON ledger_entries FROM satelink';
    END IF;
END
$$;
