/**
 * AuthorizationState — active <-> (consume, no state change) ; active -> revoked
 * (terminal). Consumption never changes the state; it changes consumedAmount and
 * nonces. revoke() is the only transition and is always available while active.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type AuthorizationStateValue = 'active' | 'revoked';

const VALUES: readonly AuthorizationStateValue[] = ['active', 'revoked'];

export class InvalidAuthorizationStateError {
  readonly tag = 'InvalidAuthorizationStateError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidAuthorizationStateError: "${this.value}" is not a valid authorization state`;
  }
}

export class AuthorizationState {
  private constructor(readonly value: AuthorizationStateValue) {
    Object.freeze(this);
  }

  static readonly ACTIVE: AuthorizationState = new AuthorizationState('active');
  static readonly REVOKED: AuthorizationState = new AuthorizationState('revoked');

  static of(raw: string): Result<AuthorizationState, InvalidAuthorizationStateError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new AuthorizationState(raw as AuthorizationStateValue));
    }
    return err(new InvalidAuthorizationStateError(raw));
  }

  isTerminal(): boolean {
    return this.value === 'revoked';
  }

  equals(other: AuthorizationState): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
