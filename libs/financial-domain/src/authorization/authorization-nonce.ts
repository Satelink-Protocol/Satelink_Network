/**
 * AuthorizationNonce — an ENTITY INSIDE the Authorization aggregate root.
 *
 * NOT exported from the package barrel and never loaded or mutated independently
 * of its Authorization. External code only ever sees an AuthorizationNonceView.
 * A nonce is single-use: consume() returns a new consumed instance; the original
 * is immutable.
 */

import type { Money } from '@satelink/kernel';
import { NonceValue } from './nonce-value.js';
import { ValidityWindow } from './validity-window.js';

export type NonceStateValue = 'unconsumed' | 'consumed';

/** Read-only projection — the only nonce shape that leaves the aggregate. */
export interface AuthorizationNonceView {
  readonly value: NonceValue;
  readonly window: ValidityWindow;
  readonly state: NonceStateValue;
  readonly consumedAmount: Money | undefined;
  readonly consumedAt: number | undefined;
}

export interface AuthorizationNonceInput {
  readonly value: NonceValue;
  readonly window: ValidityWindow;
  readonly state?: NonceStateValue | undefined;
  readonly consumedAmount?: Money | undefined;
  readonly consumedAt?: number | undefined;
}

export class AuthorizationNonce {
  private constructor(
    readonly value: NonceValue,
    readonly window: ValidityWindow,
    readonly state: NonceStateValue,
    readonly consumedAmount: Money | undefined,
    readonly consumedAt: number | undefined,
  ) {
    Object.freeze(this);
  }

  static create(input: AuthorizationNonceInput): AuthorizationNonce {
    return new AuthorizationNonce(
      input.value,
      input.window,
      input.state ?? 'unconsumed',
      input.consumedAmount,
      input.consumedAt,
    );
  }

  isConsumed(): boolean {
    return this.state === 'consumed';
  }

  /** Returns a NEW consumed nonce. Caller has already checked single-use + window. */
  consume(amount: Money, atMs: number): AuthorizationNonce {
    return new AuthorizationNonce(this.value, this.window, 'consumed', amount, atMs);
  }

  toView(): AuthorizationNonceView {
    return {
      value: this.value,
      window: this.window,
      state: this.state,
      consumedAmount: this.consumedAmount,
      consumedAt: this.consumedAt,
    };
  }
}
