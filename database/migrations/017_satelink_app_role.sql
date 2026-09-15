-- 017_satelink_app_role.sql
-- M6 (T-28): create the non-superuser `satelink_app` role that
-- 004_ledger_revoke_mutation.sql has anticipated (and revoked mutation
-- rights from, conditionally) since M2, but never created — "creating that
-- role and repointing the connection are infra decisions and are
-- intentionally NOT done" there. This migration does the CREATE ROLE + GRANT
-- half of that infra decision (schema-level, reviewable, reversible).
-- Repointing DATABASE_URL to actually connect AS this role is NOT done here
-- — that is a Railway environment change, out of this migration's scope
-- (and out of Claude Code's scope per this repo's CLAUDE.md). Until that
-- repoint happens, prod keeps connecting as the superuser `postgres`, and
-- per 004's own header comment (a), this role's restrictions stay INERT —
-- superusers bypass every privilege check. Creating the role now, ahead of
-- the repoint, lets that repoint be a pure env-var change with no migration
-- in the critical path when the founder is ready to do it.
--
-- No password is set here — CREATE ROLE with a literal password would put a
-- secret in git history. Set it out-of-band, immediately after this
-- migration runs, with a command that is NEVER committed:
--   ALTER ROLE satelink_app WITH PASSWORD '<a freshly generated secret>';
-- Then set Railway's DATABASE_URL (for apps/api) to connect as satelink_app
-- with that password, and confirm `SELECT current_user;` returns
-- 'satelink_app', not 'postgres', before trusting the append-only guarantee.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        CREATE ROLE satelink_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
END
$$;

DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO satelink_app', current_database());
END
$$;
GRANT USAGE ON SCHEMA public TO satelink_app;

-- Broad grant on EXISTING tables — the app needs ordinary CRUD everywhere
-- except the one carve-out below. Mirrors 004's own reasoning: grant widely,
-- then narrow the one sensitive table explicitly, rather than hand-listing
-- every table (this schema has ~30+ tables and grows with every migration).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO satelink_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO satelink_app;

-- Default privileges: a table created by a FUTURE migration (run as
-- postgres, the migration-runner role) automatically grants to
-- satelink_app too — this role must never silently lose access to a new
-- table and break the app after the DATABASE_URL repoint.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO satelink_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO satelink_app;

-- THE carve-out (T-28's actual point, and 004's original intent): no
-- mutation on ledger_entries. Append-only is enforced by the ledger
-- domain's aggregate boundary (no update/delete method exists) AND, once
-- DATABASE_URL is repointed, by Postgres itself refusing the app
-- connection's own UPDATE/DELETE attempts — real defense-in-depth, not the
-- inert version 004 shipped with only PUBLIC and a conditional branch.
REVOKE UPDATE, DELETE ON ledger_entries FROM satelink_app;
