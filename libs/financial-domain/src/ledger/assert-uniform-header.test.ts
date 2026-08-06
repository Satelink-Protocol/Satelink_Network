import { describe, it, expect } from 'vitest';
import { Money, USDT } from '@satelink/kernel';
import { LedgerTransaction } from './ledger-transaction.js';
import { TxnId } from './txn-id.js';
import { AccountRef } from './account-ref.js';
import { Direction } from './direction.js';
import { EntryState } from './entry-state.js';
import { SourceReference } from './source-reference.js';
import type { LedgerEntryInput, LedgerEntryView } from './types.js';
import {
  assertUniformLedgerHeader,
  LedgerHeaderMismatchError,
} from './assert-uniform-header.js';

// ---------------------------------------------------------------------------
// Helpers — unwrap Result value objects, failing loudly on Err.
// ---------------------------------------------------------------------------

function txnId(v: string): TxnId {
  const r = TxnId.of(v);
  if (r.isErr) throw new Error(`bad txnId in test: ${r.error.toString()}`);
  return r.value;
}
function acc(v: string): AccountRef {
  const r = AccountRef.of(v);
  if (r.isErr) throw new Error(`bad account in test: ${r.error.toString()}`);
  return r.value;
}
function src(refType: string, refId: string): SourceReference {
  const r = SourceReference.of(refType, refId);
  if (r.isErr) throw new Error(`bad source in test: ${r.error.toString()}`);
  return r.value;
}

/** Build the entry-view set for a balanced txn from raw entry inputs. */
function views(entries: readonly LedgerEntryInput[]): readonly LedgerEntryView[] {
  const r = LedgerTransaction.create({
    txnId: txnId('txn_guard'),
    kind: 'deposit',
    source: src('revenue_event', 'ev_1'),
    entries,
  });
  if (r.isErr) throw new Error(`unexpected Err building views: ${r.error.toString()}`);
  return r.value.entries;
}

describe('assertUniformLedgerHeader', () => {
  it('does not throw when every entry shares refType, refId, and state', () => {
    const s = src('revenue_event', 'ev_1');
    const entries: LedgerEntryInput[] = [
      { account: acc('acct_a'), direction: Direction.DEBIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.POSTED, source: s },
      { account: acc('acct_b'), direction: Direction.CREDIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.POSTED, source: s },
    ];
    expect(() => assertUniformLedgerHeader('txn_ok', views(entries))).not.toThrow();
  });

  it('tolerates a zero- or single-entry set (nothing to disagree with)', () => {
    const s = src('revenue_event', 'ev_1');
    const single: LedgerEntryView[] = [
      { account: acc('acct_a'), direction: Direction.DEBIT, amount: Money.fromMinorUnits(1n, USDT), state: EntryState.POSTED, source: s, reversesEntryId: undefined, entryId: undefined },
    ];
    expect(() => assertUniformLedgerHeader('txn_single', single)).not.toThrow();
    expect(() => assertUniformLedgerHeader('txn_empty', [])).not.toThrow();
  });

  it('throws naming the txn and the field when refId differs', () => {
    const entries: LedgerEntryInput[] = [
      { account: acc('acct_a'), direction: Direction.DEBIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.POSTED, source: src('revenue_event', 'ev_1') },
      { account: acc('acct_b'), direction: Direction.CREDIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.POSTED, source: src('revenue_event', 'ev_2') },
    ];
    let caught: unknown;
    try {
      assertUniformLedgerHeader('txn_mismatch_refid', views(entries));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LedgerHeaderMismatchError);
    const err = caught as LedgerHeaderMismatchError;
    expect(err.txnId).toBe('txn_mismatch_refid');
    expect(err.field).toBe('refId');
    expect(err.expected).toBe('ev_1');
    expect(err.actual).toBe('ev_2');
    expect(err.message).toContain('txn_mismatch_refid');
    expect(err.message).toContain('refId');
  });

  it('throws on a differing refType', () => {
    const entries: LedgerEntryInput[] = [
      { account: acc('acct_a'), direction: Direction.DEBIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.POSTED, source: src('draw', 'x') },
      { account: acc('acct_b'), direction: Direction.CREDIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.POSTED, source: src('revenue_event', 'x') },
    ];
    expect(() => assertUniformLedgerHeader('txn_rt', views(entries))).toThrowError(
      LedgerHeaderMismatchError,
    );
  });

  it('throws on a differing state', () => {
    const s = src('revenue_event', 'ev_1');
    const entries: LedgerEntryInput[] = [
      { account: acc('acct_a'), direction: Direction.DEBIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.POSTED, source: s },
      { account: acc('acct_b'), direction: Direction.CREDIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.PENDING, source: s },
    ];
    let caught: unknown;
    try {
      assertUniformLedgerHeader('txn_state', views(entries));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LedgerHeaderMismatchError);
    expect((caught as LedgerHeaderMismatchError).field).toBe('state');
  });
});
