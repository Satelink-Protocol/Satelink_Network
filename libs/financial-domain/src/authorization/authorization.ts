/**
 * Authorization — aggregate root. A Principal's standing authorization to draw
 * up to a Cap against a FundingSource, spendable via single-use nonces within
 * validity windows.
 *
 * INVARIANTS enforced HERE (not in a service or the DB):
 *   - consumedAmount <= cap, ALWAYS
 *   - a nonce is consumed at most once
 *   - a nonce is consumed only within its [validAfter, validBefore]
 *   - no consumption when revoked or outside the authorization window
 *   - revoke() is ALWAYS accepted from any non-terminal state (#9)
 *
 * Money is bigint minor units — no floats. The AuthorizationNonce entity lives
 * inside this root and is never exposed (only AuthorizationNonceView). Other
 * aggregates are referenced by Id only. Immutable — every operation returns a
 * new Authorization; `version` is bumped by the repository.
 */

import type { Currency, Money, Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';
import { PrincipalId } from '../shared/principal-id.js';
import { FundingSourceId } from '../shared/funding-source-id.js';
import { AuthorizationId } from '../shared/authorization-id.js';
import { Cap } from './cap.js';
import { ConsumedAmount } from './consumed-amount.js';
import { ValidityWindow } from './validity-window.js';
import { SignatureEnvelope } from './signature-envelope.js';
import { NonceValue } from './nonce-value.js';
import { AuthorizationState } from './authorization-state.js';
import { AuthorizationNonce } from './authorization-nonce.js';
import type { AuthorizationNonceView, AuthorizationNonceInput } from './authorization-nonce.js';
import { IllegalAuthorizationTransitionError } from './errors.js';
import {
  AuthorizationRevokedError,
  NonceNotFoundError,
  NonceAlreadyConsumedError,
  OutsideValidityWindowError,
  CapExceededError,
  ConsumeCurrencyMismatchError,
  NonPositiveConsumeError,
} from './errors.js';
import type { ConsumeError } from './errors.js';

/** Reconstitution shape (repository use). Nonces are plain input data; the root
 * builds the AuthorizationNonce entities so they never leak. */
export interface AuthorizationProps {
  readonly id: AuthorizationId;
  readonly principalId: PrincipalId;
  readonly fundingSourceId: FundingSourceId;
  readonly cap: Cap;
  readonly consumed: ConsumedAmount;
  readonly window: ValidityWindow;
  readonly signature: SignatureEnvelope;
  readonly state: AuthorizationState;
  readonly version: number;
  readonly nonces: readonly AuthorizationNonceInput[];
}

interface InternalProps {
  readonly id: AuthorizationId;
  readonly principalId: PrincipalId;
  readonly fundingSourceId: FundingSourceId;
  readonly cap: Cap;
  readonly consumed: ConsumedAmount;
  readonly window: ValidityWindow;
  readonly signature: SignatureEnvelope;
  readonly state: AuthorizationState;
  readonly version: number;
  readonly nonces: readonly AuthorizationNonce[];
}

export interface ConsumeParams {
  readonly nonce: NonceValue;
  readonly amount: Money;
  readonly clockMs: number;
}

export class Authorization {
  private constructor(private readonly props: InternalProps) {
    Object.freeze(this.props.nonces);
    Object.freeze(this.props);
    Object.freeze(this);
  }

  static create(params: {
    id: AuthorizationId;
    principalId: PrincipalId;
    fundingSourceId: FundingSourceId;
    cap: Cap;
    window: ValidityWindow;
    signature: SignatureEnvelope;
    nonces: readonly AuthorizationNonceInput[];
  }): Result<Authorization, never> {
    return ok(
      new Authorization({
        id: params.id,
        principalId: params.principalId,
        fundingSourceId: params.fundingSourceId,
        cap: params.cap,
        consumed: ConsumedAmount.zero(params.cap.money.currency),
        window: params.window,
        signature: params.signature,
        state: AuthorizationState.ACTIVE,
        version: 0,
        nonces: params.nonces.map((n) => AuthorizationNonce.create(n)),
      }),
    );
  }

  static reconstitute(props: AuthorizationProps): Authorization {
    return new Authorization({
      ...props,
      nonces: props.nonces.map((n) => AuthorizationNonce.create(n)),
    });
  }

  get id(): AuthorizationId {
    return this.props.id;
  }
  get principalId(): PrincipalId {
    return this.props.principalId;
  }
  get fundingSourceId(): FundingSourceId {
    return this.props.fundingSourceId;
  }
  get cap(): Cap {
    return this.props.cap;
  }
  get consumed(): ConsumedAmount {
    return this.props.consumed;
  }
  get window(): ValidityWindow {
    return this.props.window;
  }
  get signature(): SignatureEnvelope {
    return this.props.signature;
  }
  get state(): AuthorizationState {
    return this.props.state;
  }
  get version(): number {
    return this.props.version;
  }
  get currency(): Currency {
    return this.props.cap.money.currency;
  }

  /** Read-only projection of the nonce set (entity never leaves the root). */
  get nonces(): readonly AuthorizationNonceView[] {
    return this.props.nonces.map((n) => n.toView());
  }

  /** available = cap - consumed (same currency by construction). */
  available(): Money {
    const r = this.props.cap.money.subtract(this.props.consumed.money);
    if (r.isErr) {
      throw new Error('unreachable: cap/consumed currency mismatch');
    }
    return r.value;
  }

  noncesRemaining(): number {
    return this.props.nonces.filter((n) => !n.isConsumed()).length;
  }

  /**
   * Consume `amount` against `nonce` at `clockMs`. Enforces every invariant and
   * returns a new Authorization on success. Never partially applies.
   */
  consume(params: ConsumeParams): Result<Authorization, ConsumeError> {
    if (this.props.state.isTerminal()) {
      return err(new AuthorizationRevokedError());
    }
    if (!params.amount.isPositive()) {
      return err(new NonPositiveConsumeError(params.amount.toDecimalString()));
    }
    if (!this.props.window.contains(params.clockMs)) {
      return err(new OutsideValidityWindowError(params.clockMs));
    }

    const index = this.props.nonces.findIndex((n) => n.value.equals(params.nonce));
    if (index === -1) {
      return err(new NonceNotFoundError(params.nonce.value));
    }
    const nonce = this.props.nonces[index]!;
    if (nonce.isConsumed()) {
      return err(new NonceAlreadyConsumedError(params.nonce.value));
    }
    if (!nonce.window.contains(params.clockMs)) {
      return err(new OutsideValidityWindowError(params.clockMs));
    }
    if (!params.amount.currency.equals(this.currency)) {
      return err(new ConsumeCurrencyMismatchError(this.currency.code, params.amount.currency.code));
    }

    const sum = this.props.consumed.money.add(params.amount);
    if (sum.isErr) {
      return err(new ConsumeCurrencyMismatchError(this.currency.code, params.amount.currency.code));
    }
    const gt = sum.value.greaterThan(this.props.cap.money);
    if (gt.isErr || gt.value) {
      return err(
        new CapExceededError(this.props.cap.money.toDecimalString(), sum.value.toDecimalString()),
      );
    }

    const newConsumed = ConsumedAmount.of(sum.value);
    if (newConsumed.isErr) {
      // sum is non-negative (positive + non-negative), so this is unreachable.
      throw new Error('unreachable: consumed amount negative');
    }

    const newNonces = this.props.nonces.slice();
    newNonces[index] = nonce.consume(params.amount, params.clockMs);

    return ok(
      new Authorization({
        ...this.props,
        consumed: newConsumed.value,
        nonces: newNonces,
      }),
    );
  }

  /** Safety action (#9): revoke from any non-terminal state. Terminal. */
  revoke(): Result<Authorization, IllegalAuthorizationTransitionError> {
    if (this.props.state.isTerminal()) {
      return err(new IllegalAuthorizationTransitionError(this.props.state.value, 'revoke'));
    }
    return ok(new Authorization({ ...this.props, state: AuthorizationState.REVOKED }));
  }
}
