/**
 * LedgerKind — the classification of a ledger transaction, written to the
 * `ledger_txns.kind` header column (migration 009).
 *
 * This is a first-class property of the LedgerTransaction aggregate, NOT a
 * value invented at the persistence edge. The reconciler (M7) groups settled
 * activity by this field, so a mislabeled transaction is silently
 * misclassified downstream — there is deliberately NO default: every
 * construction site must state what kind of transaction it is building.
 *
 * The set mirrors the CHECK constraint exactly (009, widened by 019):
 *   ledger_txns.kind IN ('draw','settlement','deposit','adjustment','reversal','refund')
 * 'refund' = money returned to a customer for a recognised revenue event
 * (Dodo refund / lost dispute); 'reversal' = mechanical undo of a transaction.
 */

export const LEDGER_KINDS = [
  'draw',
  'settlement',
  'deposit',
  'adjustment',
  'reversal',
  'refund',
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

/** Runtime guard — true only for a value the CHECK constraint accepts. */
export function isLedgerKind(value: unknown): value is LedgerKind {
  return typeof value === 'string' && (LEDGER_KINDS as readonly string[]).includes(value);
}
