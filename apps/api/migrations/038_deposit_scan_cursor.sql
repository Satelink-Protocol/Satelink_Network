-- 038_deposit_scan_cursor.sql
-- Persisted scan cursor for the Polygon DepositListener (A2.9: bounded catch-up).
--
-- Before this, "where to resume" was derived from MAX(block_number) in
-- credit_deposits — which only advances when a deposit actually lands. Between
-- deposits, scan progress lived only in process memory and was lost on restart,
-- and a gap larger than the lookback bound was silently skipped.
--
-- This table records the last FULLY-scanned block per chain, advanced every
-- scanned chunk (deposit or not), so the listener resumes exactly where it left
-- off and its cursor can never move past an unscanned block.
--
-- NOTE: apps/api/migrations/*.sql have no auto-runner in production. The
-- DepositListener creates this table idempotently on start() (boot DDL), the
-- same pattern the billing/Dodo schema use. This file is the canonical record.

CREATE TABLE IF NOT EXISTS deposit_scan_cursor (
  chain_id           INTEGER PRIMARY KEY,
  last_scanned_block BIGINT      NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
