/**
 * Account — aggregate root for a single-currency account belonging to a
 * Principal (referenced by Id).
 *
 * DELIBERATELY DOES NOT COMPUTE BALANCE. There is no balance field and no
 * import of BalanceCalculator or the ledger. Balance is DERIVED in the
 * application layer from ledger entries (invariant #1) and passed IN when a
 * decision needs it (e.g. close()). This is what keeps invariant #1
 * structurally true and avoids an Account <-> Ledger import cycle.
 *
 * State machine: open <-> frozen -> closed(terminal). Immutable — transitions
 * return a NEW Account. `version` is for optimistic locking (bumped by the repo).
 *
 * Identity rule: an account is uniquely (principalId, kind, currency). That
 * tuple is exposed via naturalKey(); uniqueness is enforced by the repository
 * (findByPrincipalKindCurrency) and the DB unique index (002).
 */

import type { Currency, Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { AccountId } from '../shared/account-id.js';
import { AccountKind } from './account-kind.js';
import { Normality } from './normality.js';
import { BalanceInvariant } from './balance-invariant.js';
import { AccountState } from './account-state.js';
import { PrincipalId } from '../shared/principal-id.js';
import { IllegalAccountTransitionError, AccountClosePreconditionError } from './errors.js';

/** Context the aggregate needs to decide close() — supplied by the app layer. */
export interface AccountCloseContext {
  /** Whether the externally-derived balance is non-zero. */
  readonly hasNonZeroBalance: boolean;
}

/** The uniqueness tuple for an account. */
export interface AccountNaturalKey {
  readonly principalId: PrincipalId;
  readonly kind: AccountKind;
  readonly currency: Currency;
}

export interface AccountProps {
  readonly id: AccountId;
  readonly principalId: PrincipalId;
  readonly kind: AccountKind;
  readonly normality: Normality;
  readonly currency: Currency;
  readonly balanceInvariant: BalanceInvariant;
  readonly state: AccountState;
  readonly version: number;
}

export class Account {
  private constructor(private readonly props: AccountProps) {
    Object.freeze(this.props);
    Object.freeze(this);
  }

  static create(params: {
    id: AccountId;
    principalId: PrincipalId;
    kind: AccountKind;
    normality: Normality;
    currency: Currency;
    balanceInvariant?: BalanceInvariant;
  }): Result<Account, never> {
    return ok(
      new Account({
        id: params.id,
        principalId: params.principalId,
        kind: params.kind,
        normality: params.normality,
        currency: params.currency,
        balanceInvariant: params.balanceInvariant ?? BalanceInvariant.UNRESTRICTED,
        state: AccountState.OPEN,
        version: 0,
      }),
    );
  }

  static reconstitute(props: AccountProps): Account {
    return new Account(props);
  }

  get id(): AccountId {
    return this.props.id;
  }
  get principalId(): PrincipalId {
    return this.props.principalId;
  }
  get kind(): AccountKind {
    return this.props.kind;
  }
  get normality(): Normality {
    return this.props.normality;
  }
  get currency(): Currency {
    return this.props.currency;
  }
  get balanceInvariant(): BalanceInvariant {
    return this.props.balanceInvariant;
  }
  get state(): AccountState {
    return this.props.state;
  }
  get version(): number {
    return this.props.version;
  }

  /** The (principalId, kind, currency) uniqueness tuple. */
  naturalKey(): AccountNaturalKey {
    return {
      principalId: this.props.principalId,
      kind: this.props.kind,
      currency: this.props.currency,
    };
  }

  private withState(state: AccountState): Account {
    return new Account({ ...this.props, state });
  }

  /** open -> frozen. */
  freeze(): Result<Account, IllegalAccountTransitionError> {
    if (this.props.state.value !== 'open') {
      return err(new IllegalAccountTransitionError(this.props.state.value, 'freeze'));
    }
    return ok(this.withState(AccountState.FROZEN));
  }

  /** frozen -> open. */
  unfreeze(): Result<Account, IllegalAccountTransitionError> {
    if (this.props.state.value !== 'frozen') {
      return err(new IllegalAccountTransitionError(this.props.state.value, 'unfreeze'));
    }
    return ok(this.withState(AccountState.OPEN));
  }

  /**
   * frozen -> closed. Terminal. Precondition (given the externally-derived
   * balance passed in): balance must be zero.
   */
  close(
    ctx: AccountCloseContext,
  ): Result<Account, IllegalAccountTransitionError | AccountClosePreconditionError> {
    if (this.props.state.value !== 'frozen') {
      return err(new IllegalAccountTransitionError(this.props.state.value, 'close'));
    }
    if (ctx.hasNonZeroBalance) {
      return err(new AccountClosePreconditionError('cannot close: non-zero balance remains'));
    }
    return ok(this.withState(AccountState.CLOSED));
  }
}
