/**
 * Expected failures for the Account aggregate (returned via Result).
 */

import type { AccountStateValue } from './account-state.js';

export class IllegalAccountTransitionError {
  readonly tag = 'IllegalAccountTransitionError' as const;
  constructor(
    readonly from: AccountStateValue,
    readonly action: string,
  ) {}
  toString(): string {
    return `IllegalAccountTransitionError: cannot ${this.action} from state "${this.from}"`;
  }
}

export class AccountClosePreconditionError {
  readonly tag = 'AccountClosePreconditionError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `AccountClosePreconditionError: ${this.reason}`;
  }
}
