import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Money, USDT, USDC } from '@satelink/kernel';
import { BalanceCalculator } from './balance-calculator.js';
import { AccountRef } from './account-ref.js';
import { Direction } from './direction.js';
import { EntryState } from './entry-state.js';
import { SourceReference } from './source-reference.js';
import type { LedgerEntryView } from './types.js';

function acc(v: string): AccountRef {
  const r = AccountRef.of(v);
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
}
const SRC = (() => {
  const r = SourceReference.of('revenue_event', 'ev');
  if (r.isErr) throw new Error(r.error.toString());
  return r.value;
})();
const ACCT = acc('acct_x');

function view(
  direction: Direction,
  state: EntryState,
  minor: bigint,
  account: AccountRef = ACCT,
): LedgerEntryView {
  return {
    account,
    direction,
    amount: Money.fromMinorUnits(minor, USDT),
    state,
    source: SRC,
    reversesEntryId: undefined,
    entryId: undefined,
  };
}

describe('BalanceCalculator — DECISION 1 formula', () => {
  it('a pending credit does NOT raise available', () => {
    const entries = [
      view(Direction.CREDIT, EntryState.POSTED, 500n),
      view(Direction.CREDIT, EntryState.PENDING, 9999n),
    ];
    const r = BalanceCalculator.compute(ACCT, USDT, entries);
    expect(r.isOk).toBe(true);
    if (!r.isOk) return;
    expect(r.value.available.amount).toBe(500n);
    expect(r.value.postedBalance.amount).toBe(500n);
    expect(r.value.pendingCredits.amount).toBe(9999n);
  });

  it('a posted debit DOES reduce available (guards the formula fix)', () => {
    const entries = [
      view(Direction.CREDIT, EntryState.POSTED, 1000n),
      view(Direction.DEBIT, EntryState.POSTED, 300n),
    ];
    const r = BalanceCalculator.compute(ACCT, USDT, entries);
    expect(r.isOk).toBe(true);
    if (!r.isOk) return;
    // available = 1000 - 300 - 0 = 700, NOT 1000 (the old dropped-term bug)
    expect(r.value.available.amount).toBe(700n);
    expect(r.value.postedBalance.amount).toBe(700n);
  });

  it('pending debits reduce available but not posted balance', () => {
    const entries = [
      view(Direction.CREDIT, EntryState.POSTED, 1000n),
      view(Direction.DEBIT, EntryState.POSTED, 300n),
      view(Direction.DEBIT, EntryState.PENDING, 200n),
    ];
    const r = BalanceCalculator.compute(ACCT, USDT, entries);
    expect(r.isOk).toBe(true);
    if (!r.isOk) return;
    expect(r.value.postedBalance.amount).toBe(700n); // 1000 - 300
    expect(r.value.available.amount).toBe(500n); // 1000 - 300 - 200
  });

  it('voided entries are excluded entirely', () => {
    const entries = [
      view(Direction.CREDIT, EntryState.POSTED, 1000n),
      view(Direction.CREDIT, EntryState.VOIDED, 5000n),
      view(Direction.DEBIT, EntryState.VOIDED, 4000n),
    ];
    const r = BalanceCalculator.compute(ACCT, USDT, entries);
    expect(r.isOk).toBe(true);
    if (!r.isOk) return;
    expect(r.value.postedCredits.amount).toBe(1000n);
    expect(r.value.available.amount).toBe(1000n);
  });

  it('ignores entries for other accounts', () => {
    const entries = [
      view(Direction.CREDIT, EntryState.POSTED, 1000n, ACCT),
      view(Direction.CREDIT, EntryState.POSTED, 7777n, acc('acct_other')),
    ];
    const r = BalanceCalculator.compute(ACCT, USDT, entries);
    expect(r.isOk).toBe(true);
    if (!r.isOk) return;
    expect(r.value.postedCredits.amount).toBe(1000n);
  });

  it('fails explicitly on a currency mismatch, never a wrong number', () => {
    const bad: LedgerEntryView = {
      account: ACCT,
      direction: Direction.CREDIT,
      amount: Money.fromMinorUnits(100n, USDC),
      state: EntryState.POSTED,
      source: SRC,
      reversesEntryId: undefined,
      entryId: undefined,
    };
    const r = BalanceCalculator.compute(ACCT, USDT, [bad]);
    expect(r.isErr).toBe(true);
    if (r.isErr) expect(r.error.tag).toBe('BalanceCurrencyMismatchError');
  });
});

// ---------------------------------------------------------------------------
// PROPERTY: balance recomputed from entries equals the reported balance.
// ---------------------------------------------------------------------------

describe('BalanceCalculator — property: recomputed == reported', () => {
  const entryArb = fc.record({
    dir: fc.constantFrom<'debit' | 'credit'>('debit', 'credit'),
    state: fc.constantFrom<'posted' | 'pending' | 'voided'>('posted', 'pending', 'voided'),
    amount: fc.bigInt({ min: 1n, max: 10n ** 15n }),
  });

  it('available == postedCredits - postedDebits - pendingDebits [10000 runs]', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 12 }), (rows) => {
        const entries: LedgerEntryView[] = rows.map((row) =>
          view(
            row.dir === 'debit' ? Direction.DEBIT : Direction.CREDIT,
            row.state === 'posted'
              ? EntryState.POSTED
              : row.state === 'pending'
                ? EntryState.PENDING
                : EntryState.VOIDED,
            row.amount,
          ),
        );

        // Independent recomputation (voided excluded).
        let pc = 0n;
        let pd = 0n;
        let penD = 0n;
        for (const row of rows) {
          if (row.state === 'voided') continue;
          if (row.state === 'posted' && row.dir === 'credit') pc += row.amount;
          else if (row.state === 'posted' && row.dir === 'debit') pd += row.amount;
          else if (row.state === 'pending' && row.dir === 'debit') penD += row.amount;
        }
        const expectedPosted = pc - pd;
        const expectedAvailable = pc - pd - penD;

        const r = BalanceCalculator.compute(ACCT, USDT, entries);
        expect(r.isOk).toBe(true);
        if (!r.isOk) return;
        expect(r.value.postedBalance.amount).toBe(expectedPosted);
        expect(r.value.available.amount).toBe(expectedAvailable);
      }),
      { numRuns: 10_000 },
    );
  });
});
