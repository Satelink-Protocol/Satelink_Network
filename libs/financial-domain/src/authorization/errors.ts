/**
 * Expected failures for the Authorization aggregate (returned via Result).
 */

import type { AuthorizationStateValue } from './authorization-state.js';

export class IllegalAuthorizationTransitionError {
  readonly tag = 'IllegalAuthorizationTransitionError' as const;
  constructor(
    readonly from: AuthorizationStateValue,
    readonly action: string,
  ) {}
  toString(): string {
    return `IllegalAuthorizationTransitionError: cannot ${this.action} from state "${this.from}"`;
  }
}

export class AuthorizationRevokedError {
  readonly tag = 'AuthorizationRevokedError' as const;
  toString(): string {
    return 'AuthorizationRevokedError: cannot consume a revoked authorization';
  }
}

export class NonceNotFoundError {
  readonly tag = 'NonceNotFoundError' as const;
  constructor(readonly nonce: string) {}
  toString(): string {
    return `NonceNotFoundError: no nonce "${this.nonce}" on this authorization`;
  }
}

export class NonceAlreadyConsumedError {
  readonly tag = 'NonceAlreadyConsumedError' as const;
  constructor(readonly nonce: string) {}
  toString(): string {
    return `NonceAlreadyConsumedError: nonce "${this.nonce}" was already consumed`;
  }
}

export class OutsideValidityWindowError {
  readonly tag = 'OutsideValidityWindowError' as const;
  constructor(readonly clockMs: number) {}
  toString(): string {
    return `OutsideValidityWindowError: clock ${this.clockMs} is outside the validity window`;
  }
}

export class CapExceededError {
  readonly tag = 'CapExceededError' as const;
  constructor(
    readonly cap: string,
    readonly attempted: string,
  ) {}
  toString(): string {
    return `CapExceededError: attempted total ${this.attempted} exceeds cap ${this.cap}`;
  }
}

export class ConsumeCurrencyMismatchError {
  readonly tag = 'ConsumeCurrencyMismatchError' as const;
  constructor(
    readonly expected: string,
    readonly found: string,
  ) {}
  toString(): string {
    return `ConsumeCurrencyMismatchError: expected ${this.expected}, got ${this.found}`;
  }
}

export class NonPositiveConsumeError {
  readonly tag = 'NonPositiveConsumeError' as const;
  constructor(readonly amount: string) {}
  toString(): string {
    return `NonPositiveConsumeError: consume amount must be > 0, got ${this.amount}`;
  }
}

export type ConsumeError =
  | AuthorizationRevokedError
  | NonceNotFoundError
  | NonceAlreadyConsumedError
  | OutsideValidityWindowError
  | CapExceededError
  | ConsumeCurrencyMismatchError
  | NonPositiveConsumeError;
