/**
 * Expected, recoverable failures for the ledger domain. Returned via Result —
 * the domain never throws for these (they are inputs a caller can get wrong).
 * A programmer error (e.g. a currency arithmetic mismatch that "cannot happen"
 * once currency uniformity is validated) is the only thing that may throw.
 */

export class EmptyTransactionError {
  readonly tag = 'EmptyTransactionError' as const;
  constructor(readonly reason: string = 'a ledger transaction must have at least one entry') {}
  toString(): string {
    return `EmptyTransactionError: ${this.reason}`;
  }
}

export class NonPositiveAmountError {
  readonly tag = 'NonPositiveAmountError' as const;
  constructor(readonly amount: string) {}
  toString(): string {
    return `NonPositiveAmountError: entry amount must be > 0, got ${this.amount}`;
  }
}

export class TransactionCurrencyMismatchError {
  readonly tag = 'TransactionCurrencyMismatchError' as const;
  constructor(
    readonly expected: string,
    readonly found: string,
  ) {}
  toString(): string {
    return `TransactionCurrencyMismatchError: all entries must share ${this.expected}, found ${this.found}`;
  }
}

export class UnbalancedTransactionError {
  readonly tag = 'UnbalancedTransactionError' as const;
  constructor(
    readonly debitTotal: string,
    readonly creditTotal: string,
  ) {}
  toString(): string {
    return `UnbalancedTransactionError: debits ${this.debitTotal} != credits ${this.creditTotal}`;
  }
}

/** All expected ledger construction failures. */
export type LedgerError =
  | EmptyTransactionError
  | NonPositiveAmountError
  | TransactionCurrencyMismatchError
  | UnbalancedTransactionError;

/** Balance computation failures. */
export class BalanceCurrencyMismatchError {
  readonly tag = 'BalanceCurrencyMismatchError' as const;
  constructor(
    readonly expected: string,
    readonly found: string,
  ) {}
  toString(): string {
    return `BalanceCurrencyMismatchError: expected ${this.expected}, found ${this.found}`;
  }
}

export type BalanceError = BalanceCurrencyMismatchError;
