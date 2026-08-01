/**
 * Expected failures for the Principal aggregate (returned via Result).
 */

import type { PrincipalStateValue } from './principal-state.js';

export class IllegalPrincipalTransitionError {
  readonly tag = 'IllegalPrincipalTransitionError' as const;
  constructor(
    readonly from: PrincipalStateValue,
    readonly action: string,
  ) {}
  toString(): string {
    return `IllegalPrincipalTransitionError: cannot ${this.action} from state "${this.from}"`;
  }
}

export class PrincipalClosePreconditionError {
  readonly tag = 'PrincipalClosePreconditionError' as const;
  constructor(readonly reason: string) {}
  toString(): string {
    return `PrincipalClosePreconditionError: ${this.reason}`;
  }
}

export class ChildCapacityExceedsParentError {
  readonly tag = 'ChildCapacityExceedsParentError' as const;
  constructor(
    readonly parentHeld: string,
    readonly childRequested: string,
  ) {}
  toString(): string {
    return `ChildCapacityExceedsParentError: child ${this.childRequested} exceeds parent ${this.parentHeld}`;
  }
}
