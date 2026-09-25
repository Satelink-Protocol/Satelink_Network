-- 019 — allow ledger_txns.kind = 'refund' (fix/ledger-refund-kind).
--
-- shadowReverseRevenueLedger (apps/api/src/ledger/shadow_ledger_write.js)
-- writes the header of a Dodo refund / dispute reversal as kind 'refund', but
-- 009 only allowed ('draw','settlement','deposit','adjustment','reversal'), so
-- every such write failed the CHECK and was swallowed (the writer never throws).
-- Production held 0 refund txns (only 'deposit') as of 2026-09-25.
--
-- 'refund' is kept distinct from 'reversal' on purpose: 'reversal' is the
-- domain's mechanical undo of a specific ledger transaction
-- (LedgerTransaction.reverse), 'refund' is money returned to a customer for a
-- recognised revenue event. The reconciler groups by kind, so they must not merge.
-- Additive: widens the allowed set, no row changes. FOUNDER REVIEW.
ALTER TABLE ledger_txns DROP CONSTRAINT IF EXISTS ledger_txns_kind_check;
ALTER TABLE ledger_txns ADD CONSTRAINT ledger_txns_kind_check
  CHECK (kind IN ('draw', 'settlement', 'deposit', 'adjustment', 'reversal', 'refund'));
