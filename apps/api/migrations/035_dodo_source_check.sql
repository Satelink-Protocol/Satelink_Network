-- 035_dodo_source_check.sql
-- FIX (PR #386): guarantee payment_sources.source allows 'dodo'.
--
-- 027_x402_payment_rail.sql and apps/api/src/db/migrate.js both create
-- payment_sources with an inline column CHECK that OMITS 'dodo' (auto-named
-- payment_sources_source_check). 031_dodo_payment_source.sql adds 'dodo', but
-- apps/api/migrations/*.sql have NO auto-runner — they are applied manually —
-- so a prod DB where 031 was never run would REJECT every Dodo payment_sources
-- insert (CHECK violation → the /internal/dodo/credit transaction rolls back →
-- the customer pays and gets nothing). This migration is idempotent and re-adds
-- the constraint with EVERY value currently allowed plus 'dodo', so it is safe
-- whether or not 031 was ever applied.
--
-- 034 is intentionally skipped: it is already used logically by
-- ensureBillingTables (034_revenue_source_validation — is_test_data /
-- source_validated columns), so 035 is the next free number.
--
-- Note: the same idempotent DDL is also ensured at boot in
-- apps/api/server.js ensureBillingTables(), which IS the prod entrypoint's
-- schema path, so this fix reaches prod on the next deploy even without a
-- manual run.

ALTER TABLE payment_sources DROP CONSTRAINT IF EXISTS payment_sources_source_check;
ALTER TABLE payment_sources ADD CONSTRAINT payment_sources_source_check
  CHECK (source IN ('polygon_usdt_vault', 'x402', 'dodo', 'marketplace', 'other'));
