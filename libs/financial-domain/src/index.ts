/**
 * @satelink/financial-domain
 *
 * Pure financial domain. Imports only @satelink/kernel. Zero I/O — no pg, no
 * axios, no ethers, no node builtins. Enforced by .dependency-cruiser.cjs.
 *
 * M3 surface: the append-only ledger aggregate.
 * M4 surface: the Principal and Account aggregates.
 *
 * NOTE: LedgerEntry (the entity) is deliberately NOT exported. It lives inside
 * LedgerTransaction; the outside world only sees LedgerEntryView.
 *
 * PrincipalId lives in shared/ (not principal/) because Account references it,
 * and the no-aggregate-to-aggregate rule forbids account/ importing principal/.
 * shared/ is the arch-designated home for cross-aggregate identifiers.
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

// ---------------------------------------------------------------------------
// M4 — Principal aggregate
// ---------------------------------------------------------------------------

export { PrincipalId, InvalidPrincipalIdError } from './shared/principal-id.js';
export { Principal } from './principal/principal.js';
export type { PrincipalProps, PrincipalCloseContext } from './principal/principal.js';
export { PrincipalKind, InvalidPrincipalKindError } from './principal/principal-kind.js';
export type { PrincipalKindValue } from './principal/principal-kind.js';
export { PrincipalState, InvalidPrincipalStateError } from './principal/principal-state.js';
export type { PrincipalStateValue } from './principal/principal-state.js';
export { Hierarchy, HierarchyCycleError } from './principal/hierarchy.js';
export { ExternalRef, InvalidExternalRefError } from './principal/external-ref.js';
export {
  IllegalPrincipalTransitionError,
  PrincipalClosePreconditionError,
  ChildCapacityExceedsParentError,
} from './principal/errors.js';

// ---------------------------------------------------------------------------
// M4 — Account aggregate
// ---------------------------------------------------------------------------

export { AccountId, InvalidAccountIdError } from './account/account-id.js';
export { Account } from './account/account.js';
export type { AccountProps, AccountCloseContext, AccountNaturalKey } from './account/account.js';
export { AccountKind, InvalidAccountKindError } from './account/account-kind.js';
export { Normality, InvalidNormalityError } from './account/normality.js';
export type { NormalityValue } from './account/normality.js';
export { BalanceInvariant, InvalidBalanceInvariantError } from './account/balance-invariant.js';
export type { BalanceInvariantValue } from './account/balance-invariant.js';
export { AccountState, InvalidAccountStateError } from './account/account-state.js';
export type { AccountStateValue } from './account/account-state.js';
export {
  IllegalAccountTransitionError,
  AccountClosePreconditionError,
} from './account/errors.js';

// ---------------------------------------------------------------------------
// M5 — FundingSource aggregate
// ---------------------------------------------------------------------------

export { FundingSourceId, InvalidFundingSourceIdError } from './shared/funding-source-id.js';
export { FundingSource } from './funding-source/funding-source.js';
export type { FundingSourceProps } from './funding-source/funding-source.js';
export { RailId, InvalidRailIdError } from './funding-source/rail-id.js';
export { RailReference, InvalidRailReferenceError } from './funding-source/rail-reference.js';
export { FundingMode, InvalidFundingModeError } from './funding-source/funding-mode.js';
export type { FundingModeValue } from './funding-source/funding-mode.js';
export { Capabilities, InvalidCapabilitiesError } from './funding-source/capabilities.js';
export type { CapabilitiesProps, SettlementLatency } from './funding-source/capabilities.js';
export { FundingSourceState, InvalidFundingSourceStateError } from './funding-source/funding-source-state.js';
export type { FundingSourceStateValue } from './funding-source/funding-source-state.js';
export { IllegalFundingSourceTransitionError } from './funding-source/errors.js';

// ---------------------------------------------------------------------------
// M5 — Authorization aggregate (AuthorizationNonce entity is NOT exported)
// ---------------------------------------------------------------------------

export { AuthorizationId, InvalidAuthorizationIdError } from './authorization/authorization-id.js';
export { Authorization } from './authorization/authorization.js';
export type { AuthorizationProps, ConsumeParams } from './authorization/authorization.js';
export { AuthorizationState, InvalidAuthorizationStateError } from './authorization/authorization-state.js';
export type { AuthorizationStateValue } from './authorization/authorization-state.js';
export { Cap, InvalidCapError } from './authorization/cap.js';
export { ConsumedAmount, InvalidConsumedAmountError } from './authorization/consumed-amount.js';
export { ValidityWindow, InvalidValidityWindowError } from './authorization/validity-window.js';
export { SignatureEnvelope, InvalidSignatureEnvelopeError } from './authorization/signature-envelope.js';
export { NonceValue, InvalidNonceValueError } from './authorization/nonce-value.js';
// NOTE: the AuthorizationNonce entity is deliberately NOT exported. Callers pass
// AuthorizationNonceInput data; the root builds the entities. External code only
// ever sees AuthorizationNonceView.
export type { AuthorizationNonceView, AuthorizationNonceInput, NonceStateValue } from './authorization/authorization-nonce.js';
export { CapacitySelector } from './authorization/capacity-selector.js';
export {
  IllegalAuthorizationTransitionError,
  AuthorizationRevokedError,
  NonceNotFoundError,
  NonceAlreadyConsumedError,
  OutsideValidityWindowError,
  CapExceededError,
  ConsumeCurrencyMismatchError,
  NonPositiveConsumeError,
} from './authorization/errors.js';
export type { ConsumeError } from './authorization/errors.js';
