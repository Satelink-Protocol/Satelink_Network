/**
 * Draw + Settlement domain errors. Each is a plain class (not extends Error)
 * so they compose cleanly in Result<T, E> without stack trace overhead.
 */

export class IllegalDrawTransitionError {
  readonly tag = 'IllegalDrawTransitionError' as const;
  constructor(
    readonly from: string,
    readonly action: string,
  ) {}
  toString(): string {
    return `IllegalDrawTransitionError: cannot ${this.action} from state "${this.from}"`;
  }
}

export class IllegalSettlementTransitionError {
  readonly tag = 'IllegalSettlementTransitionError' as const;
  constructor(
    readonly from: string,
    readonly action: string,
  ) {}
  toString(): string {
    return `IllegalSettlementTransitionError: cannot ${this.action} from settlement state "${this.from}"`;
  }
}

export class InsufficientConfirmationsError {
  readonly tag = 'InsufficientConfirmationsError' as const;
  constructor(
    readonly actual: number,
    readonly required: number,
  ) {}
  toString(): string {
    return `InsufficientConfirmationsError: ${this.actual} confirmations < ${this.required} required`;
  }
}

export class DrawAlreadySettledError {
  readonly tag = 'DrawAlreadySettledError' as const;
  constructor(readonly drawId: string) {}
  toString(): string {
    return `DrawAlreadySettledError: draw "${this.drawId}" is already settled`;
  }
}

export type DrawError =
  | IllegalDrawTransitionError
  | IllegalSettlementTransitionError
  | InsufficientConfirmationsError
  | DrawAlreadySettledError;
