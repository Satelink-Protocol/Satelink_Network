-- 006_principal_account_version.sql
-- M4: Optimistic-locking version column for the Principal and Account aggregates.
--
-- ADDITIVE ONLY. Adds a monotonically-increasing `version` to principals and
-- accounts so repositories can do compare-and-set writes (UPDATE ... WHERE
-- version = $expected). No existing column, constraint, or view is changed.
--
-- Existing rows default to 0. Repository INSERTs start new rows at 1; each
-- successful UPDATE bumps version by 1. A stale write (expected != current)
-- matches zero rows and is reported as a conflict.

ALTER TABLE principals ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts   ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
