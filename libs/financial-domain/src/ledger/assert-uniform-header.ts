/**
 * assertUniformLedgerHeader — persistence guard for the ledger_txns header.
 *
 * The `ledger_txns` header (migration 009) carries ONE ref_type, ref_id, and
 * state per transaction, and the Postgres writers derive those columns from
 * entries[0], assuming every entry in the transaction agrees. The
 * LedgerTransaction aggregate itself only guarantees a single currency and a
 * balanced set — it deliberately does NOT force one source/state across
 * entries (a transaction may, in principle, carry heterogeneous entry
 * sources). This guard makes the writers' silent assumption explicit: if it
 * ever fails to hold, a header would be written from entries[0] that
 * misdescribes the rest of the transaction.
 *
 * It THROWS rather than returning a Result: a violation is not an expected
 * domain outcome but a corruption of the writer's invariant, in the same
 * spirit as the `unreachable` throws inside LedgerTransaction.build.
 */

import type { LedgerEntryView } from './types.js';

export type LedgerHeaderField = 'refType' | 'refId' | 'state';

export class LedgerHeaderMismatchError extends Error {
  readonly tag = 'LedgerHeaderMismatchError' as const;
  constructor(
    readonly txnId: string,
    readonly field: LedgerHeaderField,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `ledger_txns header mismatch for txn "${txnId}": entries disagree on ` +
        `"${field}" ("${expected}" vs "${actual}") — the header is derived from ` +
        `entries[0] and every entry must agree`,
    );
    this.name = 'LedgerHeaderMismatchError';
  }
}

/**
 * Assert every entry shares entries[0]'s refType, refId, and state. Throws a
 * LedgerHeaderMismatchError naming the txn and the first field that differs.
 * A transaction with zero or one entries trivially agrees.
 */
export function assertUniformLedgerHeader(
  txnId: string,
  entries: readonly LedgerEntryView[],
): void {
  const first = entries[0];
  if (first === undefined) {
    return;
  }
  for (let i = 1; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.source.refType !== first.source.refType) {
      throw new LedgerHeaderMismatchError(
        txnId,
        'refType',
        first.source.refType,
        e.source.refType,
      );
    }
    if (e.source.refId !== first.source.refId) {
      throw new LedgerHeaderMismatchError(txnId, 'refId', first.source.refId, e.source.refId);
    }
    if (e.state.value !== first.state.value) {
      throw new LedgerHeaderMismatchError(txnId, 'state', first.state.value, e.state.value);
    }
  }
}
