-- 004_ledger_revoke_mutation.sql
-- M2: Defense-in-depth for the append-only invariant (#5) at the database level.
--
-- Revoke UPDATE and DELETE on ledger_entries so that a *non-superuser*
-- application role cannot mutate or delete existing ledger entries. Reversals
-- MUST be expressed as NEW entries with reverses_entry_id set.
--
-- READ THIS BEFORE TRUSTING THIS MIGRATION FOR PROTECTION:
--
--   a) Superusers bypass ALL privilege checks by design. A REVOKE has no effect
--      on any superuser role — this is standard PostgreSQL behaviour, not a bug
--      we can work around at the SQL level.
--
--   b) Production currently connects as the superuser role `postgres`
--      (see DATABASE_URL). Because of (a), this REVOKE is INERT in production
--      today: it grants ZERO actual protection until a dedicated, non-superuser
--      `satelink_app` role exists AND DATABASE_URL is repointed to connect as
--      that role. Creating that role and repointing the connection are infra
--      decisions and are intentionally NOT done here.
--
--   c) The intended primary append-only guarantee is the domain layer in libs —
--      the LedgerRepository aggregate boundary, which by design exposes no
--      update and no delete method. NOTE: that repository interface is not yet
--      implemented as of M2 (planned M3+); libs currently holds only the M1
--      Money kernel. Until it lands, append-only rests on the aggregate-boundary
--      design intent plus this migration. This migration is defense-in-depth
--      ONLY — never the sole line of defence.
--
-- We deliberately do NOT revoke from `postgres` or any superuser: doing so is
-- security theater (it does nothing, per (a)) and would falsely imply the app
-- connection is constrained when it is not.

-- Catch-all: strip mutation from PUBLIC so no unlisted role inherits it.
REVOKE UPDATE, DELETE ON ledger_entries FROM PUBLIC;

-- Least-privilege application role. Revoked only if it already exists; this
-- migration never CREATEs the role (that is an infra decision). Once a
-- non-superuser `satelink_app` exists and DATABASE_URL is repointed to it,
-- this branch makes the append-only revoke effective for the app connection.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'satelink_app') THEN
        EXECUTE 'REVOKE UPDATE, DELETE ON ledger_entries FROM satelink_app';
    END IF;
END
$$;
