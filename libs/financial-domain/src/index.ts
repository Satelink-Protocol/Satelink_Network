/**
 * @satelink/financial-domain
 *
 * Pure financial domain. Imports only @satelink/kernel. Zero I/O — no pg, no
 * axios, no ethers, no node builtins. Enforced by .dependency-cruiser.cjs.
 *
 * M3 surface: the append-only ledger aggregate.
 *
 * NOTE: LedgerEntry (the entity) is deliberately NOT exported. It lives inside
 * LedgerTransaction; the outside world only sees LedgerEntryView.
 */

export { TxnId, InvalidTxnIdError } from './ledger/txn-id.js';
export { AccountRef, InvalidAccountRefError } from './ledger/account-ref.js';
export { Direction, InvalidDirectionError } from './ledger/direction.js';
export type { DirectionValue } from './ledger/direction.js';
export { EntryState, InvalidEntryStateError } from './ledger/entry-state.js';
export type { EntryStateValue } from './ledger/entry-state.js';
export { SourceReference, InvalidSourceReferenceError } from './ledger/source-reference.js';

export { LedgerTransaction } from './ledger/ledger-transaction.js';
export type { LedgerEntryView, LedgerEntryInput } from './ledger/types.js';

export { BalanceCalculator } from './ledger/balance-calculator.js';
export type { AccountBalance } from './ledger/balance-calculator.js';

export {
  EmptyTransactionError,
  NonPositiveAmountError,
  TransactionCurrencyMismatchError,
  UnbalancedTransactionError,
  BalanceCurrencyMismatchError,
} from './ledger/errors.js';
export type { LedgerError, BalanceError } from './ledger/errors.js';
