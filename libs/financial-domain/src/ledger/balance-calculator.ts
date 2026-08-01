/**
 * BalanceCalculator — pure domain service that derives an account's balance
 * from its ledger entries (invariant #1: balance is derived, never stored).
 *
 * DECISION 1 (founder, 2026-08-01) — formula matches the shipped M2
 * `account_balances` view EXACTLY:
 *
 *   posted_balance = posted_credits - posted_debits
 *   available      = posted_credits - posted_debits - pending_debits
 *
 * A posted debit is settled spend and reduces available. Pending debits are
 * holds and reduce available but not posted_balance. Pending credits never
 * raise available (invariant #3). Voided entries are excluded entirely
 * (mirrors `state != 'voided'` in the view).
 */

import type { AccountRef } from './account-ref.js';
import type { LedgerEntryView } from './types.js';
import { BalanceCurrencyMismatchError } from './errors.js';
import type { BalanceError } from './errors.js';
import type { Currency, Money, Result } from '@satelink/kernel';
import { Money as MoneyVO, ok, err } from '@satelink/kernel';

export interface AccountBalance {
  readonly account: AccountRef;
  readonly currency: Currency;
  readonly postedCredits: Money;
  readonly postedDebits: Money;
  readonly pendingCredits: Money;
  readonly pendingDebits: Money;
  /** posted_credits - posted_debits */
  readonly postedBalance: Money;
  /** posted_credits - posted_debits - pending_debits */
  readonly available: Money;
}

export class BalanceCalculator {
  /**
   * Compute the balance for `account` in `currency` from `entries`. Entries for
   * other accounts are ignored; voided entries are ignored. An entry whose
   * currency differs from `currency` is an explicit failure, never a silently
   * wrong sum.
   */
  static compute(
    account: AccountRef,
    currency: Currency,
    entries: readonly LedgerEntryView[],
  ): Result<AccountBalance, BalanceError> {
    let postedCredits = MoneyVO.fromMinorUnits(0n, currency);
    let postedDebits = MoneyVO.fromMinorUnits(0n, currency);
    let pendingCredits = MoneyVO.fromMinorUnits(0n, currency);
    let pendingDebits = MoneyVO.fromMinorUnits(0n, currency);

    for (const entry of entries) {
      if (!entry.account.equals(account)) {
        continue;
      }
      if (entry.state.isVoided()) {
        continue;
      }
      if (!entry.amount.currency.equals(currency)) {
        return err(
          new BalanceCurrencyMismatchError(currency.code, entry.amount.currency.code),
        );
      }

      const isPosted = entry.state.isPosted();
      const isCredit = entry.direction.isCredit();

      if (isPosted && isCredit) {
        postedCredits = BalanceCalculator.addOrThrow(postedCredits, entry.amount);
      } else if (isPosted && !isCredit) {
        postedDebits = BalanceCalculator.addOrThrow(postedDebits, entry.amount);
      } else if (!isPosted && isCredit) {
        pendingCredits = BalanceCalculator.addOrThrow(pendingCredits, entry.amount);
      } else {
        pendingDebits = BalanceCalculator.addOrThrow(pendingDebits, entry.amount);
      }
    }

    const postedBalance = BalanceCalculator.subOrThrow(postedCredits, postedDebits);
    const available = BalanceCalculator.subOrThrow(postedBalance, pendingDebits);

    return ok({
      account,
      currency,
      postedCredits,
      postedDebits,
      pendingCredits,
      pendingDebits,
      postedBalance,
      available,
    });
  }

  // Same-currency is guaranteed by the checks above, so an Err from add/subtract
  // is a programmer error and may throw (per the domain error policy).
  private static addOrThrow(a: Money, b: Money): Money {
    const r = a.add(b);
    if (r.isErr) {
      throw new Error('unreachable: currency mismatch after validation');
    }
    return r.value;
  }

  private static subOrThrow(a: Money, b: Money): Money {
    const r = a.subtract(b);
    if (r.isErr) {
      throw new Error('unreachable: currency mismatch after validation');
    }
    return r.value;
  }
}
