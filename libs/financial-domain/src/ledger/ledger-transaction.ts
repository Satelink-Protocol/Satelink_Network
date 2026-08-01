/**
 * LedgerTransaction — the aggregate root. THE BALANCED SET IS THE AGGREGATE.
 *
 * Invariants enforced at construction (an invalid transaction is
 * UNCONSTRUCTABLE — the only way in is `create`/`reconstitute`, both of which
 * return a Result and refuse to build an invalid value):
 *
 *   - at least one entry                              (EmptyTransactionError)
 *   - every entry amount is > 0                       (NonPositiveAmountError)
 *   - every entry shares one currency                 (TransactionCurrencyMismatchError)
 *   - sum(debit amounts) === sum(credit amounts)      (UnbalancedTransactionError)
 *
 * Immutable: `reverse` returns a NEW transaction and never mutates the original
 * (invariant #5 — reversals are new entries, the original is untouched).
 */

import type { Currency, Result } from '@satelink/kernel';
import { Money, ok, err } from '@satelink/kernel';
import { LedgerEntry } from './ledger-entry.js';
import { Direction } from './direction.js';
import { EntryState } from './entry-state.js';
import type { AccountRef } from './account-ref.js';
import type { TxnId } from './txn-id.js';
import type { SourceReference } from './source-reference.js';
import type { LedgerEntryInput, LedgerEntryView } from './types.js';
import {
  EmptyTransactionError,
  NonPositiveAmountError,
  TransactionCurrencyMismatchError,
  UnbalancedTransactionError,
} from './errors.js';
import type { LedgerError } from './errors.js';

export class LedgerTransaction {
  private constructor(
    readonly txnId: TxnId,
    readonly source: SourceReference,
    readonly currency: Currency,
    private readonly _entries: readonly LedgerEntry[],
  ) {
    Object.freeze(this._entries);
    Object.freeze(this);
  }

  /**
   * Build a new, balanced transaction. Returns Err for any violated invariant;
   * never throws for expected input errors.
   */
  static create(params: {
    txnId: TxnId;
    source: SourceReference;
    entries: readonly LedgerEntryInput[];
  }): Result<LedgerTransaction, LedgerError> {
    return LedgerTransaction.build(params.txnId, params.source, params.entries);
  }

  /**
   * Rebuild a transaction from persisted rows. Identical validation to
   * `create` — a stored transaction that no longer balances is a corruption we
   * refuse to hand back. Entry ids are preserved.
   */
  static reconstitute(params: {
    txnId: TxnId;
    source: SourceReference;
    entries: readonly LedgerEntryInput[];
  }): Result<LedgerTransaction, LedgerError> {
    return LedgerTransaction.build(params.txnId, params.source, params.entries);
  }

  private static build(
    txnId: TxnId,
    source: SourceReference,
    inputs: readonly LedgerEntryInput[],
  ): Result<LedgerTransaction, LedgerError> {
    if (inputs.length === 0) {
      return err(new EmptyTransactionError());
    }

    const currency = inputs[0]!.amount.currency;
    let debitTotal = Money.fromMinorUnits(0n, currency);
    let creditTotal = Money.fromMinorUnits(0n, currency);

    for (const input of inputs) {
      if (!input.amount.currency.equals(currency)) {
        return err(
          new TransactionCurrencyMismatchError(currency.code, input.amount.currency.code),
        );
      }
      if (!input.amount.isPositive()) {
        return err(new NonPositiveAmountError(input.amount.toDecimalString()));
      }

      if (input.direction.isDebit()) {
        const sum = debitTotal.add(input.amount);
        // Same-currency was just validated; an Err here is a programmer error.
        if (sum.isErr) {
          throw new Error('unreachable: debit currency mismatch after validation');
        }
        debitTotal = sum.value;
      } else {
        const sum = creditTotal.add(input.amount);
        if (sum.isErr) {
          throw new Error('unreachable: credit currency mismatch after validation');
        }
        creditTotal = sum.value;
      }
    }

    if (!debitTotal.equals(creditTotal)) {
      return err(
        new UnbalancedTransactionError(
          debitTotal.toDecimalString(),
          creditTotal.toDecimalString(),
        ),
      );
    }

    const entries = inputs.map((input) =>
      LedgerEntry.create({
        account: input.account,
        direction: input.direction,
        amount: input.amount,
        state: input.state,
        source: input.source,
        reversesEntryId: input.reversesEntryId,
        entryId: input.entryId,
      }),
    );

    return ok(new LedgerTransaction(txnId, source, currency, entries));
  }

  /** Read-only projection of the entries. The entity itself never escapes. */
  get entries(): readonly LedgerEntryView[] {
    return this._entries.map((e) => e.toView());
  }

  get entryCount(): number {
    return this._entries.length;
  }

  totalDebits(): Money {
    return this.sumWhere((e) => e.direction.isDebit());
  }

  totalCredits(): Money {
    return this.sumWhere((e) => e.direction.isCredit());
  }

  isBalanced(): boolean {
    return this.totalDebits().equals(this.totalCredits());
  }

  private sumWhere(predicate: (e: LedgerEntry) => boolean): Money {
    let total = Money.fromMinorUnits(0n, this.currency);
    for (const e of this._entries) {
      if (predicate(e)) {
        const sum = total.add(e.amount);
        if (sum.isErr) {
          throw new Error('unreachable: entry currency differs from transaction currency');
        }
        total = sum.value;
      }
    }
    return total;
  }

  /**
   * Produce a NEW transaction that reverses this one: every entry's direction
   * is flipped, amounts and accounts preserved, state posted. Each reversal
   * entry points back at the original via reversesEntryId when the original was
   * persisted. The original transaction is not mutated.
   */
  reverse(params: {
    txnId: TxnId;
    source: SourceReference;
  }): Result<LedgerTransaction, LedgerError> {
    const reversedInputs: LedgerEntryInput[] = this._entries.map((e) => ({
      account: e.account,
      direction: e.direction.opposite(),
      amount: e.amount,
      state: EntryState.POSTED,
      source: params.source,
      reversesEntryId: e.entryId,
    }));
    return LedgerTransaction.build(params.txnId, params.source, reversedInputs);
  }

  /** Convenience for constructing a simple two-legged transfer. */
  static transfer(params: {
    txnId: TxnId;
    source: SourceReference;
    debitAccount: AccountRef;
    creditAccount: AccountRef;
    amount: Money;
    state: EntryState;
  }): Result<LedgerTransaction, LedgerError> {
    return LedgerTransaction.build(params.txnId, params.source, [
      {
        account: params.debitAccount,
        direction: Direction.DEBIT,
        amount: params.amount,
        state: params.state,
        source: params.source,
      },
      {
        account: params.creditAccount,
        direction: Direction.CREDIT,
        amount: params.amount,
        state: params.state,
        source: params.source,
      },
    ]);
  }
}
