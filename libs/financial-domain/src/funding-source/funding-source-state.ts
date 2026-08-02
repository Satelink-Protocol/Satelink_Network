/**
 * FundingSourceState — lifecycle:
 *   registered -> verified -> active <-> degraded -> revoked(terminal)
 *
 * `degraded` is first-class: a rail whose facilitator is unreachable is NOT
 * active, and the domain says so without deleting the source. Transition
 * legality lives in the aggregate.
 */

import type { Result } from '@satelink/kernel';
import { ok, err } from '@satelink/kernel';

export type FundingSourceStateValue = 'registered' | 'verified' | 'active' | 'degraded' | 'revoked';

const VALUES: readonly FundingSourceStateValue[] = [
  'registered',
  'verified',
  'active',
  'degraded',
  'revoked',
];

export class InvalidFundingSourceStateError {
  readonly tag = 'InvalidFundingSourceStateError' as const;
  constructor(readonly value: string) {}
  toString(): string {
    return `InvalidFundingSourceStateError: "${this.value}" is not a valid funding source state`;
  }
}

export class FundingSourceState {
  private constructor(readonly value: FundingSourceStateValue) {
    Object.freeze(this);
  }

  static readonly REGISTERED: FundingSourceState = new FundingSourceState('registered');
  static readonly VERIFIED: FundingSourceState = new FundingSourceState('verified');
  static readonly ACTIVE: FundingSourceState = new FundingSourceState('active');
  static readonly DEGRADED: FundingSourceState = new FundingSourceState('degraded');
  static readonly REVOKED: FundingSourceState = new FundingSourceState('revoked');

  static of(raw: string): Result<FundingSourceState, InvalidFundingSourceStateError> {
    if ((VALUES as readonly string[]).includes(raw)) {
      return ok(new FundingSourceState(raw as FundingSourceStateValue));
    }
    return err(new InvalidFundingSourceStateError(raw));
  }

  isTerminal(): boolean {
    return this.value === 'revoked';
  }

  equals(other: FundingSourceState): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
