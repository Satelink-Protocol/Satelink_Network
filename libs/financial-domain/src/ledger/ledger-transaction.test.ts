import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Money, USDT, USDC } from '@satelink/kernel';
import { LedgerTransaction } from './ledger-transaction.js';
import { TxnId } from './txn-id.js';
import { AccountRef } from './account-ref.js';
import { Direction } from './direction.js';
import { EntryState } from './entry-state.js';
import { SourceReference } from './source-reference.js';
import type { LedgerEntryInput } from './types.js';

// ---------------------------------------------------------------------------
// Test helpers — unwrap Result value objects, failing loudly on Err.
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
const SRC = src('revenue_event', 'ev_1');

// ---------------------------------------------------------------------------
// Construction invariants
// ---------------------------------------------------------------------------

describe('LedgerTransaction — construction', () => {
  it('constructs a balanced two-legged transfer', () => {
    const r = LedgerTransaction.transfer({
      txnId: txnId('txn_1'),
      source: SRC,
      debitAccount: acc('acct_a'),
      creditAccount: acc('acct_b'),
      amount: Money.fromMinorUnits(1000n, USDT),
      state: EntryState.POSTED,
    });
    expect(r.isOk).toBe(true);
    if (r.isOk) {
      expect(r.value.isBalanced()).toBe(true);
      expect(r.value.entryCount).toBe(2);
      expect(r.value.totalDebits().equals(r.value.totalCredits())).toBe(true);
    }
  });

  it('rejects an empty transaction', () => {
    const r = LedgerTransaction.create({ txnId: txnId('txn_empty'), source: SRC, entries: [] });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('EmptyTransactionError');
  });

  it('rejects a non-positive amount', () => {
    const r = LedgerTransaction.create({
      txnId: txnId('txn_zero'),
      source: SRC,
      entries: [
        { account: acc('acct_a'), direction: Direction.DEBIT, amount: Money.fromMinorUnits(0n, USDT), state: EntryState.POSTED, source: SRC },
        { account: acc('acct_b'), direction: Direction.CREDIT, amount: Money.fromMinorUnits(0n, USDT), state: EntryState.POSTED, source: SRC },
      ],
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('NonPositiveAmountError');
  });

  it('rejects mixed currencies across entries', () => {
    const r = LedgerTransaction.create({
      txnId: txnId('txn_mixed'),
      source: SRC,
      entries: [
        { account: acc('acct_a'), direction: Direction.DEBIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.POSTED, source: SRC },
        { account: acc('acct_b'), direction: Direction.CREDIT, amount: Money.fromMinorUnits(1000n, USDC), state: EntryState.POSTED, source: SRC },
      ],
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('TransactionCurrencyMismatchError');
  });

  it('rejects an unbalanced transaction (debits != credits)', () => {
    const r = LedgerTransaction.create({
      txnId: txnId('txn_unbal'),
      source: SRC,
      entries: [
        { account: acc('acct_a'), direction: Direction.DEBIT, amount: Money.fromMinorUnits(1000n, USDT), state: EntryState.POSTED, source: SRC },
        { account: acc('acct_b'), direction: Direction.CREDIT, amount: Money.fromMinorUnits(999n, USDT), state: EntryState.POSTED, source: SRC },
      ],
    });
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('UnbalancedTransactionError');
  });
});

// ---------------------------------------------------------------------------
// PROPERTY: unbalanced construction is ALWAYS rejected (never yields a value).
// The frozen design uses Result for expected failures, so "throws" is realised
// as an Err — there is no code path that returns an unbalanced LedgerTransaction.
// ---------------------------------------------------------------------------

describe('LedgerTransaction — property: balance is unconstructable when unequal', () => {
  const entryArb = fc.record({
    isDebit: fc.boolean(),
    amount: fc.bigInt({ min: 1n, max: 10n ** 15n }),
  });

  it('sum(debits) !== sum(credits) => Err; equal => Ok balanced [10000 runs]', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 8 }), (rows) => {
        const entries: LedgerEntryInput[] = rows.map((row, i) => ({
          account: acc(row.isDebit ? 'acct_debit' : 'acct_credit'),
          direction: row.isDebit ? Direction.DEBIT : Direction.CREDIT,
          amount: Money.fromMinorUnits(row.amount, USDT),
          state: EntryState.POSTED,
          source: src('revenue_event', `ev_${i}`),
        }));

        let debitSum = 0n;
        let creditSum = 0n;
        for (const row of rows) {
          if (row.isDebit) debitSum += row.amount;
          else creditSum += row.amount;
        }

        const r = LedgerTransaction.create({ txnId: txnId('txn_prop'), source: SRC, entries });

        if (debitSum === creditSum) {
          expect(r.isOk).toBe(true);
          if (r.isOk) expect(r.value.isBalanced()).toBe(true);
        } else {
          expect(r.isErr).toBe(true);
          if (r.isErr) expect(r.error.tag).toBe('UnbalancedTransactionError');
        }
      }),
      { numRuns: 10_000 },
    );
  });
});

// ---------------------------------------------------------------------------
// Reversal — a NEW transaction; the original is untouched (invariant #5).
// ---------------------------------------------------------------------------

describe('LedgerTransaction — reversal', () => {
  it('creates a new transaction with flipped directions; original unmodified', () => {
    const original = LedgerTransaction.transfer({
      txnId: txnId('txn_orig'),
      source: SRC,
      debitAccount: acc('acct_a'),
      creditAccount: acc('acct_b'),
      amount: Money.fromMinorUnits(1000n, USDT),
      state: EntryState.POSTED,
    });
    expect(original.isOk).toBe(true);
    if (!original.isOk) return;

    const beforeEntries = original.value.entries;
    const origDebit = beforeEntries.find((e) => e.direction.isDebit());
    expect(origDebit?.account.value).toBe('acct_a');

    const rev = original.value.reverse({ txnId: txnId('txn_rev'), source: src('reversal', 'txn_orig') });
    expect(rev.isOk).toBe(true);
    if (!rev.isOk) return;

    // New transaction, balanced, opposite legs.
    expect(rev.value.txnId.value).toBe('txn_rev');
    expect(rev.value.isBalanced()).toBe(true);
    const revDebit = rev.value.entries.find((e) => e.direction.isDebit());
    expect(revDebit?.account.value).toBe('acct_b'); // credit side of original became debit

    // Original object is unchanged — same entries, same directions.
    const afterEntries = original.value.entries;
    expect(afterEntries.length).toBe(beforeEntries.length);
    const stillDebit = afterEntries.find((e) => e.direction.isDebit());
    expect(stillDebit?.account.value).toBe('acct_a');
  });
});
